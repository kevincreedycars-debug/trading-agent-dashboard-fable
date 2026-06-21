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

const DEFAULT_START = "2000-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const DEFAULT_MANIFEST_NAME = "QQQ daily NQ proxy";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "qqq_daily_importer_v1";

function buildRows(records, manifestId, options) {
  const prepared = [];
  let skippedMissing = 0;

  for (const record of records) {
    const observationDate = String(record.date || "").trim();
    const close = options.useAdjustedClose
      ? toNullableNumber(record.adjusted_close ?? record.close)
      : toNullableNumber(record.close);
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
      instrument_key: "qqq_nq_proxy",
      instrument_family: "equity_proxy",
      asset_scope: "USD",
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
      is_adjusted: options.useAdjustedClose,
      adjustment_type: options.useAdjustedClose ? "source_adjusted_close" : null,
      metadata: {
        importer: "backtester/importers/qqq/import_qqq_daily.js",
        proxy_for: "NQ",
        proxy_label: "QQQ ETF daily proxy"
      }
    });
  }

  return { prepared, skippedMissing };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || readOptionalEnv("QQQ_IMPORT_START", DEFAULT_START);
  const endDate = args.end || readOptionalEnv("QQQ_IMPORT_END", DEFAULT_END);
  const manifestName = args.manifest || readOptionalEnv("QQQ_MANIFEST_NAME", DEFAULT_MANIFEST_NAME);
  const filePath = args.file || readOptionalEnv("QQQ_IMPORT_FILE");
  const sourceUrl = args["source-url"] || readOptionalEnv("QQQ_SOURCE_URL");
  const vendorName = args["vendor-name"] || readOptionalEnv("QQQ_VENDOR_NAME", "manual_source");
  const vendorSymbol = args["vendor-symbol"] || readOptionalEnv("QQQ_VENDOR_SYMBOL", "QQQ");
  const delimiter = args.delimiter || readOptionalEnv("QQQ_IMPORT_DELIMITER");
  const useAdjustedClose = String(
    args["use-adjusted-close"] || readOptionalEnv("QQQ_USE_ADJUSTED_CLOSE", "false")
  ).toLowerCase() === "true";

  assertDateRange(startDate, endDate);

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const text = await readTextInput({ filePath, sourceUrl });
  const records = parseDelimited(text, { delimiter });

  const manifestPayload = {
    manifest_name: manifestName,
    source_type: filePath ? "csv_upload" : "api_export",
    vendor_name: vendorName,
    dataset_name: "QQQ daily close history for NQ proxy",
    asset_scope: "USD",
    coverage_start: startDate,
    coverage_end: endDate,
    frequency: "daily",
    import_mode: "historical_backfill",
    schema_version: DEFAULT_SCHEMA_VERSION,
    normalization_version: DEFAULT_NORMALIZATION_VERSION,
    source_uri: sourceUrl || filePath || null,
    metadata: {
      importer: "backtester/importers/qqq/import_qqq_daily.js",
      proxy_for: "NQ",
      vendor_symbol: vendorSymbol,
      use_adjusted_close: useAdjustedClose,
      last_imported_at: new Date().toISOString()
    }
  };

  const manifest = await ensureManifest(
    supabaseUrl,
    serviceRoleKey,
    {
      manifestName,
      vendorName,
      assetScope: "USD"
    },
    manifestPayload
  );

  const { prepared, skippedMissing } = buildRows(records, manifest.id, {
    endDate,
    startDate,
    useAdjustedClose,
    vendorSymbol
  });

  const submitted = await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_price_series",
    prepared,
    ["instrument_key", "interval", "observed_at", "source_manifest_id"]
  );

  await ensureManifest(
    supabaseUrl,
    serviceRoleKey,
    {
      manifestName,
      vendorName,
      assetScope: "USD"
    },
    {
      ...manifestPayload,
      row_count: prepared.length,
      coverage_start: minDate(prepared.map((row) => row.observation_date)) || startDate,
      coverage_end: maxDate(prepared.map((row) => row.observation_date)) || endDate,
      metadata: {
        ...manifestPayload.metadata,
        prepared_rows: prepared.length,
        submitted_rows: submitted,
        skipped_missing: skippedMissing
      }
    }
  );

  console.log(`[QQQ] prepared=${prepared.length} submitted=${submitted} skipped_missing=${skippedMissing}`);
  console.log(`Manifest: ${manifestName}`);
  console.log(`Instrument key: qqq_nq_proxy`);
  console.log(`Date range: ${startDate} -> ${endDate}`);
}

run().catch((error) => {
  console.error("QQQ daily import failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
