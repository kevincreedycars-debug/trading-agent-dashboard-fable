#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  assertDateRange,
  fetchAllRows,
  maxDate,
  minDate,
  parseArgs,
  requireEnv,
  upsertRows
} = require("../../lib/historical_common");

const DEFAULT_START = "2024-01-02";
const DEFAULT_END = "2026-04-30";
const SNAPSHOT_TABLE = "historical_btc_market_snapshots";
const LOGIC_DOCUMENT = "agent_btc_direction.md";
const COLLECTOR_VERSION = "btc_historical_snapshot_builder_v1";
const SNAPSHOT_SCHEMA_VERSION = "v1";
const RECONSTRUCTION_LOGIC_VERSION = "btc_historical_reconstruction_v1";
const BTC_BENCHMARK_KEY = "btc_usd_spot";
const NQ_BENCHMARK_KEY = "qqq_nq_proxy";
const ETF_FLOW_SERIES_KEY = "btc_etf_net_flow_usd";
const FEAR_GREED_SERIES_KEY = "crypto_fear_greed";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseLogicVersion() {
  const logicPath = path.resolve(__dirname, "../../../logic/agent_btc_direction.md");
  const text = fs.readFileSync(logicPath, "utf8");
  const explicitMachineVersion = text.match(/"logic_document_version":\s*"([^"]+)"/);
  if (explicitMachineVersion) {
    return explicitMachineVersion[1];
  }

  const headlineVersion = text.match(/\*\*Version:\*\*\s*([^\r\n]+)/i);
  if (headlineVersion) {
    return String(headlineVersion[1]).trim();
  }

  return "unknown";
}

function shiftDateLiteral(dateLiteral, days) {
  const date = new Date(`${dateLiteral}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = shiftDateLiteral(cursor, 1);
  }
  return dates;
}

function buildSeriesMap(rows, valueField = "value_numeric") {
  const ordered = rows
    .map((row) => ({
      observation_date: row.observation_date,
      value: toNumber(row[valueField]),
      row
    }))
    .filter((row) => row.observation_date && row.value !== null)
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));

  const byDate = new Map(ordered.map((entry) => [entry.observation_date, entry]));

  return { ordered, byDate };
}

function valueAsOf(seriesState, snapshotDate) {
  if (!seriesState) return null;
  let value = null;
  for (const entry of seriesState.ordered) {
    if (entry.observation_date > snapshotDate) break;
    value = entry.value;
  }
  return value;
}

function exactValue(seriesState, snapshotDate) {
  return seriesState?.byDate.get(snapshotDate)?.value ?? null;
}

function percentDelta(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function bpsDelta(current, previous) {
  if (current === null || previous === null) return null;
  return (current - previous) * 100;
}

function rollingSumAsOf(seriesState, snapshotDate, count) {
  if (!seriesState) return null;
  const eligible = seriesState.ordered.filter((entry) => entry.observation_date <= snapshotDate);
  if (!eligible.length) return null;
  return eligible.slice(-count).reduce((sum, entry) => sum + entry.value, 0);
}

function deriveEquitiesRegime(vixLevel) {
  if (vixLevel === null) return null;
  if (vixLevel < 16) return "risk_on";
  if (vixLevel > 25) return "risk_off";
  return "neutral";
}

function deriveCoverageStatus(missingKeys, requiredKeys) {
  const missingRequired = requiredKeys.filter((key) => missingKeys.includes(key));
  if (!missingRequired.length) return "collected";
  if (missingRequired.length === requiredKeys.length) return "missing";
  return "partial";
}

function deriveLatestEvent(snapshotDate, events) {
  const cutoff = `${snapshotDate}T23:59:59Z`;
  let latest = null;
  for (const event of events) {
    if (event.event_time <= cutoff) {
      latest = event;
    } else {
      break;
    }
  }
  return latest;
}

function computeEventAgeHours(snapshotDate, eventTime) {
  if (!eventTime) return null;
  const snapshotTs = new Date(`${snapshotDate}T23:59:59Z`).getTime();
  const eventTs = new Date(eventTime).getTime();
  const deltaHours = (snapshotTs - eventTs) / (1000 * 60 * 60);
  return deltaHours >= 0 ? deltaHours : null;
}

function buildSnapshotRow(snapshotDate, context) {
  const warnings = [];
  const missingSeries = [];

  function current(seriesKey, options = {}) {
    const series = context.series[seriesKey];
    const value = options.exact ? exactValue(series, snapshotDate) : valueAsOf(series, snapshotDate);
    if (value === null) {
      missingSeries.push(seriesKey);
    }
    return value;
  }

  const rawVix = current("vix_level");
  const rawDxy = current("dxy_level");
  const rawRealYield = current("us_10y_real_yield");
  const rawBtc = current(BTC_BENCHMARK_KEY, { exact: true });
  const rawNq = current(NQ_BENCHMARK_KEY);
  const rawFearGreed = current(FEAR_GREED_SERIES_KEY);
  const rawEtfFlow = current(ETF_FLOW_SERIES_KEY, { exact: true });

  const vixD1 = rawVix === null ? null : rawVix - valueAsOf(context.series.vix_level, shiftDateLiteral(snapshotDate, -1));
  const vixD5 = rawVix === null ? null : rawVix - valueAsOf(context.series.vix_level, shiftDateLiteral(snapshotDate, -5));
  const dxyD1 = percentDelta(rawDxy, valueAsOf(context.series.dxy_level, shiftDateLiteral(snapshotDate, -1)));
  const dxyD5 = percentDelta(rawDxy, valueAsOf(context.series.dxy_level, shiftDateLiteral(snapshotDate, -5)));
  const dxyD20 = percentDelta(rawDxy, valueAsOf(context.series.dxy_level, shiftDateLiteral(snapshotDate, -20)));
  const realYieldD5 = bpsDelta(rawRealYield, valueAsOf(context.series.us_10y_real_yield, shiftDateLiteral(snapshotDate, -5)));
  const realYieldD20 = bpsDelta(rawRealYield, valueAsOf(context.series.us_10y_real_yield, shiftDateLiteral(snapshotDate, -20)));
  const btcD1 = percentDelta(rawBtc, valueAsOf(context.series[BTC_BENCHMARK_KEY], shiftDateLiteral(snapshotDate, -1)));
  const btcD5 = percentDelta(rawBtc, valueAsOf(context.series[BTC_BENCHMARK_KEY], shiftDateLiteral(snapshotDate, -5)));
  const btcD20 = percentDelta(rawBtc, valueAsOf(context.series[BTC_BENCHMARK_KEY], shiftDateLiteral(snapshotDate, -20)));
  const nqD1 = percentDelta(rawNq, valueAsOf(context.series[NQ_BENCHMARK_KEY], shiftDateLiteral(snapshotDate, -1)));
  const nqD5 = percentDelta(rawNq, valueAsOf(context.series[NQ_BENCHMARK_KEY], shiftDateLiteral(snapshotDate, -5)));
  const nqD20 = percentDelta(rawNq, valueAsOf(context.series[NQ_BENCHMARK_KEY], shiftDateLiteral(snapshotDate, -20)));
  const btcEtf1d = rawEtfFlow;
  const btcEtf5d = rollingSumAsOf(context.series[ETF_FLOW_SERIES_KEY], snapshotDate, 5);
  const btcEtf20d = rollingSumAsOf(context.series[ETF_FLOW_SERIES_KEY], snapshotDate, 20);

  const latestEvent = deriveLatestEvent(snapshotDate, context.events);
  const latestEventAgeHours = latestEvent ? computeEventAgeHours(snapshotDate, latestEvent.event_time) : null;
  const latestUsEvent = latestEvent
    ? {
        event: latestEvent.event_name,
        actual: toNumber(latestEvent.actual_numeric),
        forecast: toNumber(latestEvent.forecast_numeric),
        previous: toNumber(latestEvent.previous_numeric),
        surprise: latestEvent.surprise_direction || null,
        usd_signal: latestEvent.currency_signal || null,
        age_hours: latestEventAgeHours
      }
    : null;

  if (!context.events.length) {
    warnings.push("historical_us_events_missing");
  }

  if (missingSeries.length) {
    warnings.push(...missingSeries.map((key) => `missing_${key}`));
  }

  const coverageRequiredKeys = [
    BTC_BENCHMARK_KEY,
    "vix_level",
    "dxy_level",
    "us_10y_real_yield"
  ];
  const marketCoverageStatus = deriveCoverageStatus(Array.from(new Set(missingSeries)), coverageRequiredKeys);
  const eventCoverageStatus = context.events.length ? "collected" : "missing";
  const sourceStatus = marketCoverageStatus === "collected" && eventCoverageStatus === "collected"
    ? "collected"
    : marketCoverageStatus === "missing"
      ? "missing"
      : "partial";

  const reconstructable24h = (
    rawBtc !== null &&
    rawVix !== null &&
    dxyD1 !== null &&
    realYieldD5 !== null
  );
  const reconstructableLonger = reconstructable24h && dxyD5 !== null && dxyD20 !== null;

  return {
    asset_code: "BTC",
    observation_time: `${snapshotDate}T00:00:00Z`,
    snapshot_date: snapshotDate,
    snapshot_timezone: "UTC",
    snapshot_mode: "historical_reconstruction",

    raw_vix_level: rawVix,
    raw_dxy_level: rawDxy,
    raw_us_10y_real_yield: rawRealYield,
    raw_btc_price: rawBtc,
    raw_nq_price: rawNq,
    raw_crypto_fear_greed: rawFearGreed,
    raw_btc_etf_net_flow_usd: rawEtfFlow,

    vix_level: rawVix,
    vix_d1: vixD1,
    vix_d5: vixD5,

    dxy_level: rawDxy,
    dxy_d1: dxyD1,
    dxy_d5: dxyD5,
    dxy_d20: dxyD20,

    us_10y_real_yield: rawRealYield,
    us_10y_real_yield_d5_bps: realYieldD5,
    us_10y_real_yield_d20_bps: realYieldD20,

    btc_price: rawBtc,
    btc_d1_pct: btcD1,
    btc_d5_pct: btcD5,
    btc_d20_pct: btcD20,

    nq_price: rawNq,
    nq_d1_pct: nqD1,
    nq_d5_pct: nqD5,
    nq_d20_pct: nqD20,

    btc_etf_net_flow_1d_usd: btcEtf1d,
    btc_etf_net_flow_5d_usd: btcEtf5d,
    btc_etf_net_flow_20d_usd: btcEtf20d,

    crypto_fear_greed: rawFearGreed,

    btc_dominance: null,
    btc_dominance_d5: null,
    btc_dominance_d20: null,
    total_crypto_market_cap: null,
    total_crypto_market_cap_d5_pct: null,
    total_crypto_market_cap_d20_pct: null,
    stablecoin_supply: null,
    stablecoin_supply_d5_pct: null,
    stablecoin_supply_d20_pct: null,

    latest_us_event: latestUsEvent,
    latest_us_event_event: latestEvent?.event_name || null,
    latest_us_event_time: latestEvent?.event_time || null,
    latest_us_event_actual: toNumber(latestEvent?.actual_numeric),
    latest_us_event_forecast: toNumber(latestEvent?.forecast_numeric),
    latest_us_event_previous: toNumber(latestEvent?.previous_numeric),
    latest_us_event_surprise: latestEvent?.surprise_direction || null,
    latest_us_event_usd_signal: latestEvent?.currency_signal || null,
    latest_us_event_impact: latestEvent?.importance || null,
    latest_us_event_source: latestEvent?.vendor_event_id || latestEvent?.event_name || null,
    latest_us_event_age_hours: latestEventAgeHours,

    fed_bias: null,
    fed_bias_score: null,
    fed_bias_reasons: [],
    upcoming_events: [],

    equities_regime: deriveEquitiesRegime(rawVix),

    collector_version: COLLECTOR_VERSION,
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    reconstruction_logic_version: RECONSTRUCTION_LOGIC_VERSION,
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: context.logicDocumentVersion,
    source_bundle_version: "historical_warehouse_v1",
    source_vendor_manifest: {},
    reconstruction_notes: "Daily calendar-date reconstruction for the current BTC production logic using the live BTC/USD benchmark convention and forward-filled non-24/7 inputs.",

    source_status: sourceStatus,
    market_data_coverage_status: marketCoverageStatus,
    event_coverage_status: eventCoverageStatus,
    missing_inputs: Array.from(new Set(missingSeries)),
    missing_raw_series: Array.from(new Set(missingSeries)),
    warnings: Array.from(new Set(warnings)),
    quality_notes: Array.from(new Set(warnings)),
    history_rows_used: {
      vix_level: valueAsOf(context.series.vix_level, snapshotDate) !== null ? 1 : 0,
      dxy_level: valueAsOf(context.series.dxy_level, snapshotDate) !== null ? 1 : 0,
      us_10y_real_yield: valueAsOf(context.series.us_10y_real_yield, snapshotDate) !== null ? 1 : 0,
      [BTC_BENCHMARK_KEY]: exactValue(context.series[BTC_BENCHMARK_KEY], snapshotDate) !== null ? 1 : 0,
      [NQ_BENCHMARK_KEY]: valueAsOf(context.series[NQ_BENCHMARK_KEY], snapshotDate) !== null ? 1 : 0,
      [ETF_FLOW_SERIES_KEY]: exactValue(context.series[ETF_FLOW_SERIES_KEY], snapshotDate) !== null ? 1 : 0,
      [FEAR_GREED_SERIES_KEY]: valueAsOf(context.series[FEAR_GREED_SERIES_KEY], snapshotDate) !== null ? 1 : 0
    },
    is_reconstructable_following_24hrs: reconstructable24h,
    is_reconstructable_3d_from_call: reconstructableLonger,
    is_reconstructable_current_week: reconstructableLonger,
    is_reconstructable_next_week: reconstructableLonger,
    is_reconstructable_current_month: reconstructableLonger,
    raw_event_payload: latestEvent || {},
    raw_market_payload: {
      btc_benchmark_source: BTC_BENCHMARK_KEY,
      nq_benchmark_source: NQ_BENCHMARK_KEY,
      btc_etf_flow_source: ETF_FLOW_SERIES_KEY,
      crypto_fear_greed_source: FEAR_GREED_SERIES_KEY
    }
  };
}

async function loadMacroSeries(supabaseUrl, serviceRoleKey, startDate, endDate) {
  const fetchStartDate = shiftDateLiteral(startDate, -60);
  const keys = ["vix_level", "dxy_level", "us_10y_real_yield", FEAR_GREED_SERIES_KEY, ETF_FLOW_SERIES_KEY];

  const rows = await fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_macro_series",
    (url) => {
      url.searchParams.set("select", "series_key,observation_date,value_numeric");
      url.searchParams.set("series_key", `in.(${keys.join(",")})`);
      url.searchParams.set("observation_date", `gte.${fetchStartDate}`);
      url.searchParams.append("observation_date", `lte.${endDate}`);
      url.searchParams.set("order", "observation_date.asc");
    }
  );

  return keys.reduce((accumulator, key) => {
    accumulator[key] = buildSeriesMap(rows.filter((row) => row.series_key === key));
    return accumulator;
  }, {});
}

async function loadPriceSeries(supabaseUrl, serviceRoleKey, startDate, endDate) {
  const fetchStartDate = shiftDateLiteral(startDate, -60);
  const keys = [BTC_BENCHMARK_KEY, NQ_BENCHMARK_KEY];

  const rows = await fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_price_series",
    (url) => {
      url.searchParams.set("select", "instrument_key,observation_date,close");
      url.searchParams.set("instrument_key", `in.(${keys.join(",")})`);
      url.searchParams.set("interval", "eq.daily");
      url.searchParams.set("observation_date", `gte.${fetchStartDate}`);
      url.searchParams.append("observation_date", `lte.${endDate}`);
      url.searchParams.set("order", "observation_date.asc");
    }
  );

  return keys.reduce((accumulator, key) => {
    accumulator[key] = buildSeriesMap(
      rows
        .filter((row) => row.instrument_key === key)
        .map((row) => ({
          observation_date: row.observation_date,
          value_numeric: row.close
        }))
    );
    return accumulator;
  }, {});
}

async function loadEconomicEvents(supabaseUrl, serviceRoleKey, startDate, endDate) {
  const lookbackStart = shiftDateLiteral(startDate, -7);
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_economic_events",
    (url) => {
      url.searchParams.set(
        "select",
        "event_name,event_time,actual_numeric,forecast_numeric,previous_numeric,importance,surprise_direction,currency_signal,vendor_event_id"
      );
      url.searchParams.set("currency", "eq.USD");
      url.searchParams.set("event_date", `gte.${lookbackStart}`);
      url.searchParams.append("event_date", `lte.${endDate}`);
      url.searchParams.set("order", "event_time.asc");
    }
  );
}

async function loadExistingSnapshotDates(supabaseUrl, serviceRoleKey, startDate, endDate) {
  const rows = await fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    SNAPSHOT_TABLE,
    (url) => {
      url.searchParams.set("select", "snapshot_date");
      url.searchParams.set("snapshot_date", `gte.${startDate}`);
      url.searchParams.append("snapshot_date", `lte.${endDate}`);
      url.searchParams.set("order", "snapshot_date.asc");
    }
  );
  return new Set(rows.map((row) => row.snapshot_date));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || DEFAULT_START;
  const endDate = args.end || DEFAULT_END;

  assertDateRange(startDate, endDate);

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const logicDocumentVersion = parseLogicVersion();

  const macroSeries = await loadMacroSeries(supabaseUrl, serviceRoleKey, startDate, endDate);
  const priceSeries = await loadPriceSeries(supabaseUrl, serviceRoleKey, startDate, endDate);
  const events = await loadEconomicEvents(supabaseUrl, serviceRoleKey, startDate, endDate);
  const existingSnapshotDates = await loadExistingSnapshotDates(supabaseUrl, serviceRoleKey, startDate, endDate);

  const series = {
    ...macroSeries,
    ...priceSeries
  };

  const candidateDates = enumerateDates(startDate, endDate);
  const rows = [];
  let rowsSkipped = 0;
  const missingSeriesSummary = new Set();

  for (const snapshotDate of candidateDates) {
    const row = buildSnapshotRow(snapshotDate, {
      events,
      logicDocumentVersion,
      series
    });

    const noCoreData = (
      row.raw_btc_price === null &&
      row.raw_vix_level === null &&
      row.raw_dxy_level === null &&
      row.raw_us_10y_real_yield === null
    );

    if (noCoreData) {
      rowsSkipped += 1;
      continue;
    }

    row.missing_raw_series.forEach((key) => missingSeriesSummary.add(key));
    rows.push(row);
  }

  const submitted = await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    SNAPSHOT_TABLE,
    rows,
    ["asset_code", "observation_time"]
  );

  const rowsCreated = rows.filter((row) => !existingSnapshotDates.has(row.snapshot_date)).length;
  const rowsUpdated = rows.length - rowsCreated;

  console.log(JSON.stringify({
    rows_created: rowsCreated,
    rows_updated: rowsUpdated,
    rows_skipped: rowsSkipped,
    missing_series: Array.from(missingSeriesSummary).sort(),
    date_range: {
      start: minDate(rows.map((row) => row.snapshot_date)) || startDate,
      end: maxDate(rows.map((row) => row.snapshot_date)) || endDate
    },
    sample_snapshot: rows[0]
      ? {
          snapshot_date: rows[0].snapshot_date,
          btc_price: rows[0].btc_price,
          btc_d1_pct: rows[0].btc_d1_pct,
          dxy_d1: rows[0].dxy_d1,
          us_10y_real_yield_d5_bps: rows[0].us_10y_real_yield_d5_bps,
          crypto_fear_greed: rows[0].crypto_fear_greed,
          btc_etf_net_flow_1d_usd: rows[0].btc_etf_net_flow_1d_usd,
          warnings: rows[0].warnings
        }
      : null,
    submitted_rows: submitted
  }, null, 2));
}

module.exports = {
  buildSeriesMap,
  buildSnapshotRow,
  deriveCoverageStatus,
  deriveEquitiesRegime,
  enumerateDates,
  run,
  shiftDateLiteral,
  toNumber,
  valueAsOf
};

if (require.main === module) {
  run().catch((error) => {
    console.error("BTC historical snapshot build failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
