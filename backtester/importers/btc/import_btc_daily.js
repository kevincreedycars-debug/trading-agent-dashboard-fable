#!/usr/bin/env node

const {
  assertDateRange,
  ensureManifest,
  maxDate,
  minDate,
  parseArgs,
  parseDelimited,
  readOptionalEnv,
  readTextInput,
  requireEnv,
  toNullableNumber,
  upsertRows
} = require("../../lib/historical_common");

const DEFAULT_START = "2010-07-18";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const DEFAULT_MANIFEST_NAME = "BTC daily history";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "btc_daily_importer_v1";
const COINBASE_BTCUSD_SPOT_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}\n${body}`);
  }
  return response.json();
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

async function fetchCoinbaseSpotRecord(observationDate) {
  const url = new URL(COINBASE_BTCUSD_SPOT_URL);
  url.searchParams.set("date", observationDate);

  let payload;
  try {
    payload = await fetchJson(url.toString());
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("HTTP 404") || message.includes("rate not found")) {
      return null;
    }
    throw error;
  }

  const close = toNullableNumber(payload?.data?.amount);
  if (close === null || close <= 0) {
    return null;
  }

  return {
    date: observationDate,
    close: String(close),
    open: "",
    high: "",
    low: "",
    volume: "",
    instrument: "BTC/USD spot",
    source_symbol: "BTC-USD",
    source_note: "Coinbase spot price by date"
  };
}

async function fetchCoinbaseSpotRecords(startDate, endDate) {
  const dates = enumerateDates(startDate, endDate);
  const records = [];

  for (const observationDate of dates) {
    const record = await fetchCoinbaseSpotRecord(observationDate);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function buildRows(records, manifestId, options) {
  const prepared = [];
  let skippedMissing = 0;

  for (const record of records) {
    const observationDate = String(record.date || "").trim();
    const close = toNullableNumber(record.close);
    const open = toNullableNumber(record.open);
    const high = toNullableNumber(record.high);
    const low = toNullableNumber(record.low);
    const volume = toNullableNumber(record.volume);

    if (!observationDate || observationDate < options.startDate || observationDate > options.endDate) {
      continue;
    }

    if (close === null || close <= 0) {
      skippedMissing += 1;
      continue;
    }

    if (high !== null && low !== null && high < low) {
      skippedMissing += 1;
      continue;
    }

    prepared.push({
      source_manifest_id: manifestId,
      instrument_key: options.instrumentKey,
      instrument_family: options.instrumentFamily,
      asset_scope: "BTC",
      quote_currency: "USD",
      observed_at: `${observationDate}T00:00:00Z`,
      observation_date: observationDate,
      observation_timezone: "UTC",
      interval: "daily",
      open,
      high,
      low,
      close,
      volume,
      open_interest: null,
      vendor_symbol: record.source_symbol || options.vendorSymbol,
      is_adjusted: Boolean(options.isAdjusted),
      adjustment_type: options.isAdjusted ? "source_adjusted" : null,
      metadata: {
        importer: "backtester/importers/btc/import_btc_daily.js",
        proxy_label: options.proxyLabel,
        source_instrument: record.instrument || null
      }
    });
  }

  return { prepared, skippedMissing };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || readOptionalEnv("BTC_IMPORT_START", DEFAULT_START);
  const endDate = args.end || readOptionalEnv("BTC_IMPORT_END", DEFAULT_END);
  const manifestName = args.manifest || readOptionalEnv("BTC_MANIFEST_NAME", DEFAULT_MANIFEST_NAME);
  const filePath = args.file || readOptionalEnv("BTC_IMPORT_FILE");
  const sourcePreset = args.source || readOptionalEnv("BTC_SOURCE_PRESET", "coinbase_btcusd_spot_daily");
  const sourceUrl = args["source-url"] || readOptionalEnv("BTC_SOURCE_URL");
  const instrumentKey = args["instrument-key"] || readOptionalEnv("BTC_INSTRUMENT_KEY", "btc_usd_spot");
  const instrumentFamily = args["instrument-family"] || readOptionalEnv("BTC_INSTRUMENT_FAMILY", "crypto_spot");
  const vendorName = args["vendor-name"] || readOptionalEnv(
    "BTC_VENDOR_NAME",
    sourcePreset === "coinbase_btcusd_spot_daily" ? "Coinbase" : "manual_source"
  );
  const vendorSymbol = args["vendor-symbol"] || readOptionalEnv(
    "BTC_VENDOR_SYMBOL",
    sourcePreset === "coinbase_btcusd_spot_daily" ? "BTC-USD" : "BTCUSD"
  );
  const proxyLabel = args["proxy-label"] || readOptionalEnv("BTC_PROXY_LABEL", "spot");
  const delimiter = args.delimiter || readOptionalEnv("BTC_IMPORT_DELIMITER");
  const isAdjusted = String(args.adjusted || readOptionalEnv("BTC_IS_ADJUSTED", "false")).toLowerCase() === "true";

  assertDateRange(startDate, endDate);

  if (sourcePreset !== "coinbase_btcusd_spot_daily" && !filePath && !sourceUrl) {
    throw new Error("Provide --file or --source-url, or use --source=coinbase_btcusd_spot_daily.");
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const records = sourcePreset === "coinbase_btcusd_spot_daily"
    ? await fetchCoinbaseSpotRecords(startDate, endDate)
    : parseDelimited(await readTextInput({ filePath, sourceUrl }), { delimiter });

  const manifestPayload = {
    manifest_name: manifestName,
    source_type: filePath ? "csv_upload" : "api_export",
    vendor_name: vendorName,
    dataset_name: `BTC daily history (${instrumentKey})`,
    asset_scope: "BTC",
    coverage_start: startDate,
    coverage_end: endDate,
    frequency: "daily",
    import_mode: "historical_backfill",
    schema_version: DEFAULT_SCHEMA_VERSION,
    normalization_version: DEFAULT_NORMALIZATION_VERSION,
    source_uri: filePath ? null : (sourceUrl || COINBASE_BTCUSD_SPOT_URL),
    license_notes: "Imported for internal historical replay research.",
    checksum: null,
    row_count: null,
    metadata: {
      importer: "backtester/importers/btc/import_btc_daily.js",
      source_preset: sourcePreset,
      instrument_key: instrumentKey,
      proxy_label: proxyLabel
    }
  };

  const manifest = await ensureManifest(
    supabaseUrl,
    serviceRoleKey,
    {
      manifestName,
      vendorName,
      assetScope: "BTC"
    },
    manifestPayload
  );

  const { prepared, skippedMissing } = buildRows(records, manifest.id, {
    startDate,
    endDate,
    instrumentKey,
    instrumentFamily,
    vendorSymbol,
    proxyLabel,
    isAdjusted
  });

  await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_price_series",
    prepared,
    ["instrument_key", "interval", "observed_at", "source_manifest_id"]
  );

  console.log(JSON.stringify({
    manifest_id: manifest.id,
    rows_prepared: prepared.length,
    rows_submitted: prepared.length,
    rows_skipped_missing: skippedMissing,
    coverage_start: minDate(prepared.map((row) => row.observation_date)),
    coverage_end: maxDate(prepared.map((row) => row.observation_date)),
    instrument_key: instrumentKey,
    vendor_name: vendorName
  }, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error("BTC daily import failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
