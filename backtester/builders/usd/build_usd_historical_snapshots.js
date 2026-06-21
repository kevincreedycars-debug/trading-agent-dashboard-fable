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

const DEFAULT_START = "2018-01-01";
const DEFAULT_END = "2024-12-31";
const SNAPSHOT_TABLE = "historical_usd_market_snapshots";
const LOGIC_DOCUMENT = "agent_usd_direction.md";
const COLLECTOR_VERSION = "usd_historical_snapshot_builder_v1";
const SNAPSHOT_SCHEMA_VERSION = "v1";
const RECONSTRUCTION_LOGIC_VERSION = "usd_historical_reconstruction_v1";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseLogicVersion() {
  const logicPath = path.resolve(__dirname, "../../../logic/agent_usd_direction.md");
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

function buildSeriesMap(rows, valueField = "value_numeric") {
  const byDate = new Map();
  const ordered = rows
    .map((row) => ({
      observation_date: row.observation_date,
      value: toNumber(row[valueField]),
      row
    }))
    .filter((row) => row.observation_date && row.value !== null)
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));

  ordered.forEach((entry, index) => {
    byDate.set(entry.observation_date, {
      ...entry,
      index
    });
  });

  return { ordered, byDate };
}

function previousValue(seriesState, currentDate, offset) {
  const current = seriesState.byDate.get(currentDate);
  if (!current) return null;

  const prior = seriesState.ordered[current.index - offset];
  return prior ? prior.value : null;
}

function percentDelta(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function bpsDelta(current, previous) {
  if (current === null || previous === null) return null;
  return (current - previous) * 100;
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

function computeSurpriseScore(eventRow) {
  const actual = toNumber(eventRow?.actual_numeric);
  const forecast = toNumber(eventRow?.forecast_numeric);
  if (actual === null || forecast === null || forecast === 0) return null;
  return (actual - forecast) / Math.abs(forecast);
}

function listCandidateDates(seriesCollection, startDate, endDate) {
  const dateSet = new Set();

  for (const seriesState of Object.values(seriesCollection)) {
    for (const entry of seriesState.ordered) {
      if (entry.observation_date >= startDate && entry.observation_date <= endDate) {
        dateSet.add(entry.observation_date);
      }
    }
  }

  return Array.from(dateSet).sort();
}

function buildSnapshotRow(snapshotDate, context) {
  const warnings = [];
  const missingSeries = [];

  function current(seriesKey) {
    const value = context.series[seriesKey]?.byDate.get(snapshotDate)?.value ?? null;
    if (value === null) {
      missingSeries.push(seriesKey);
    }
    return value;
  }

  const rawUs2y = current("us_2y_yield");
  const rawUs10y = current("us_10y_yield");
  const rawUs10yReal = current("us_10y_real_yield");
  const rawVix = current("vix_level");
  const rawDxy = current("dxy_level");
  const rawDe2y = current("de_2y_yield");
  const rawGold = current("gold_spot_usd");
  const rawQqq = current("qqq_nq_proxy");

  const us2yD5 = bpsDelta(rawUs2y, previousValue(context.series.us_2y_yield, snapshotDate, 5));
  const us2yD20 = bpsDelta(rawUs2y, previousValue(context.series.us_2y_yield, snapshotDate, 20));
  const us10yD5 = bpsDelta(rawUs10y, previousValue(context.series.us_10y_yield, snapshotDate, 5));
  const us10yRealD5 = bpsDelta(rawUs10yReal, previousValue(context.series.us_10y_real_yield, snapshotDate, 5));
  const us10yRealD20 = bpsDelta(rawUs10yReal, previousValue(context.series.us_10y_real_yield, snapshotDate, 20));
  const vixD1 = rawVix === null ? null : rawVix - previousValue(context.series.vix_level, snapshotDate, 1);
  const vixD5 = rawVix === null ? null : rawVix - previousValue(context.series.vix_level, snapshotDate, 5);
  const dxyD1 = percentDelta(rawDxy, previousValue(context.series.dxy_level, snapshotDate, 1));
  const dxyD5 = percentDelta(rawDxy, previousValue(context.series.dxy_level, snapshotDate, 5));
  const dxyD20 = percentDelta(rawDxy, previousValue(context.series.dxy_level, snapshotDate, 20));
  const goldD1 = percentDelta(rawGold, previousValue(context.series.gold_spot_usd, snapshotDate, 1));
  const goldD5 = percentDelta(rawGold, previousValue(context.series.gold_spot_usd, snapshotDate, 5));
  const goldD20 = percentDelta(rawGold, previousValue(context.series.gold_spot_usd, snapshotDate, 20));
  const nqD1 = percentDelta(rawQqq, previousValue(context.series.qqq_nq_proxy, snapshotDate, 1));
  const nqD5 = percentDelta(rawQqq, previousValue(context.series.qqq_nq_proxy, snapshotDate, 5));
  const nqD20 = percentDelta(rawQqq, previousValue(context.series.qqq_nq_proxy, snapshotDate, 20));

  const de2yD5 = bpsDelta(rawDe2y, previousValue(context.series.de_2y_yield, snapshotDate, 5));
  const usDeSpread = rawUs2y !== null && rawDe2y !== null ? rawUs2y - rawDe2y : null;
  const previousSpread = (() => {
    const prevUs2y = previousValue(context.series.us_2y_yield, snapshotDate, 5);
    const prevDe2y = previousValue(context.series.de_2y_yield, snapshotDate, 5);
    if (prevUs2y === null || prevDe2y === null) return null;
    return prevUs2y - prevDe2y;
  })();
  const usDeSpreadD5 = bpsDelta(usDeSpread, previousSpread);

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
  const surpriseScore = latestEvent ? computeSurpriseScore(latestEvent) : null;

  if (!context.events.length) {
    warnings.push("historical_us_events_missing");
  }

  const coverageRequiredKeys = [
    "us_2y_yield",
    "us_10y_real_yield",
    "vix_level",
    "dxy_level",
    "de_2y_yield",
    "gold_spot_usd",
    "qqq_nq_proxy"
  ];

  if (missingSeries.length) {
    warnings.push(...missingSeries.map((key) => `missing_${key}`));
  }

  const marketCoverageStatus = deriveCoverageStatus(Array.from(new Set(missingSeries)), coverageRequiredKeys);
  const eventCoverageStatus = context.events.length ? "collected" : "missing";
  const sourceStatus = marketCoverageStatus === "collected" && eventCoverageStatus === "collected"
    ? "collected"
    : marketCoverageStatus === "missing"
      ? "missing"
      : "partial";

  const reconstructableBase = (
    us2yD5 !== null &&
    us10yRealD5 !== null &&
    dxyD5 !== null &&
    goldD5 !== null &&
    nqD5 !== null &&
    usDeSpreadD5 !== null &&
    rawVix !== null
  );

  return {
    asset_code: "USD",
    observation_time: `${snapshotDate}T00:00:00Z`,
    snapshot_date: snapshotDate,
    snapshot_timezone: "UTC",
    snapshot_mode: "historical_reconstruction",

    raw_us_2y_yield: rawUs2y,
    raw_us_10y_yield: rawUs10y,
    raw_us_10y_real_yield: rawUs10yReal,
    raw_de_2y_yield: rawDe2y,
    raw_vix_level: rawVix,
    raw_dxy_level: rawDxy,
    raw_gold_price: rawGold,
    raw_nq_price: rawQqq,

    vix_level: rawVix,
    vix_d1: vixD1,
    vix_d5: vixD5,

    us_2y_yield: rawUs2y,
    us_2y_d5_bps: us2yD5,
    us_2y_d20_bps: us2yD20,

    de_2y_yield: rawDe2y,
    de_2y_d5_bps: de2yD5,

    us_de_2y_spread: usDeSpread,
    us_de_2y_spread_d5_bps: usDeSpreadD5,

    us_10y_yield: rawUs10y,
    us_10y_d5_bps: us10yD5,

    us_10y_real_yield: rawUs10yReal,
    us_10y_real_yield_d5_bps: us10yRealD5,
    us_10y_real_yield_d20_bps: us10yRealD20,

    dxy_level: rawDxy,
    dxy_d1: dxyD1,
    dxy_d5: dxyD5,
    dxy_d20: dxyD20,

    gold_price: rawGold,
    gold_d1_pct: goldD1,
    gold_d5_pct: goldD5,
    gold_d20_pct: goldD20,

    nq_price: rawQqq,
    nq_d1_pct: nqD1,
    nq_d5_pct: nqD5,
    nq_d20_pct: nqD20,

    equities_regime: deriveEquitiesRegime(rawVix),

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
    surprise_score: surpriseScore,

    collector_version: COLLECTOR_VERSION,
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    reconstruction_logic_version: RECONSTRUCTION_LOGIC_VERSION,
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: context.logicDocumentVersion,
    source_bundle_version: "historical_warehouse_v1",
    source_vendor_manifest: {},
    reconstruction_notes: "Daily observation-date reconstruction for the current USD production logic.",

    source_status: sourceStatus,
    market_data_coverage_status: marketCoverageStatus,
    event_coverage_status: eventCoverageStatus,
    missing_inputs: Array.from(new Set(missingSeries)),
    missing_raw_series: Array.from(new Set(missingSeries)),
    warnings: Array.from(new Set(warnings)),
    quality_notes: Array.from(new Set(warnings)),
    history_rows_used: {
      us_2y_yield: context.series.us_2y_yield.byDate.has(snapshotDate) ? 1 : 0,
      us_10y_yield: context.series.us_10y_yield.byDate.has(snapshotDate) ? 1 : 0,
      us_10y_real_yield: context.series.us_10y_real_yield.byDate.has(snapshotDate) ? 1 : 0,
      vix_level: context.series.vix_level.byDate.has(snapshotDate) ? 1 : 0,
      dxy_level: context.series.dxy_level.byDate.has(snapshotDate) ? 1 : 0,
      de_2y_yield: context.series.de_2y_yield.byDate.has(snapshotDate) ? 1 : 0,
      gold_spot_usd: context.series.gold_spot_usd.byDate.has(snapshotDate) ? 1 : 0,
      qqq_nq_proxy: context.series.qqq_nq_proxy.byDate.has(snapshotDate) ? 1 : 0
    },
    is_reconstructable_following_24hrs: reconstructableBase,
    is_reconstructable_3d_from_call: reconstructableBase,
    is_reconstructable_current_week: reconstructableBase && us2yD20 !== null && us10yRealD20 !== null && dxyD20 !== null,
    is_reconstructable_current_month: reconstructableBase && us2yD20 !== null && us10yRealD20 !== null && dxyD20 !== null,
    raw_event_payload: latestEvent || {},
    raw_market_payload: {
      qqq_proxy_for_nq: true
    }
  };
}

async function loadMacroSeries(supabaseUrl, serviceRoleKey, startDate, endDate) {
  const fetchStartDate = shiftDateLiteral(startDate, -60);
  const keys = [
    "us_2y_yield",
    "us_10y_yield",
    "us_10y_real_yield",
    "vix_level",
    "dxy_level",
    "de_2y_yield"
  ];

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
  const keys = ["gold_spot_usd", "qqq_nq_proxy"];

  const rows = await fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_price_series",
    (url) => {
      url.searchParams.set("select", "instrument_key,observation_date,close");
      url.searchParams.set("instrument_key", `in.(${keys.join(",")})`);
      url.searchParams.set("observation_date", `gte.${fetchStartDate}`);
      url.searchParams.append("observation_date", `lte.${endDate}`);
      url.searchParams.set("interval", "eq.daily");
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
        })),
      "value_numeric"
    );
    return accumulator;
  }, {});
}

async function loadEconomicEvents(supabaseUrl, serviceRoleKey, startDate, endDate) {
  const lookbackStart = new Date(`${startDate}T00:00:00Z`);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 7);
  const lookbackLiteral = lookbackStart.toISOString().slice(0, 10);

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
      url.searchParams.set("event_date", `gte.${lookbackLiteral}`);
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

  const candidateDates = listCandidateDates(series, startDate, endDate);
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
      row.raw_us_2y_yield === null &&
      row.raw_us_10y_real_yield === null &&
      row.raw_vix_level === null &&
      row.raw_dxy_level === null &&
      row.raw_gold_price === null &&
      row.raw_nq_price === null
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

  const summary = {
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
          us_2y_yield: rows[0].us_2y_yield,
          us_2y_d5_bps: rows[0].us_2y_d5_bps,
          dxy_level: rows[0].dxy_level,
          gold_d5_pct: rows[0].gold_d5_pct,
          nq_d5_pct: rows[0].nq_d5_pct,
          us_de_2y_spread_d5_bps: rows[0].us_de_2y_spread_d5_bps,
          latest_us_event: rows[0].latest_us_event,
          surprise_score: rows[0].surprise_score,
          warnings: rows[0].warnings
        }
      : null,
    submitted_rows: submitted
  };

  console.log(JSON.stringify(summary, null, 2));
}

module.exports = {
  bpsDelta,
  buildSeriesMap,
  buildSnapshotRow,
  deriveCoverageStatus,
  deriveEquitiesRegime,
  listCandidateDates,
  percentDelta,
  previousValue,
  run,
  shiftDateLiteral,
  toNumber
};

if (require.main === module) {
  run().catch((error) => {
    console.error("USD historical snapshot build failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
