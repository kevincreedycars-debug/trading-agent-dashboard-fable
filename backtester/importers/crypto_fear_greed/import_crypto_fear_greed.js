#!/usr/bin/env node

const {
  assertDateRange,
  ensureManifest,
  maxDate,
  minDate,
  parseArgs,
  readOptionalEnv,
  requireEnv,
  toNullableNumber,
  upsertRows
} = require("../../lib/historical_common");

const DEFAULT_START = "2018-02-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const DEFAULT_MANIFEST_NAME = "Crypto Fear and Greed daily history";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "crypto_fear_greed_importer_v1";
const API_URL = "https://api.alternative.me/fng/?limit=0&format=json";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}\n${body}`);
  }
  return response.json();
}

function toDateLiteralFromUnix(timestampSeconds) {
  const milliseconds = Number(timestampSeconds) * 1000;
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function buildRows(records, manifestId, options) {
  const prepared = [];
  let skippedMissing = 0;

  for (const record of records) {
    const observationDate = toDateLiteralFromUnix(record.timestamp);
    const valueNumeric = toNullableNumber(record.value);
    const classification = String(record.value_classification || "").trim() || null;

    if (!observationDate || observationDate < options.startDate || observationDate > options.endDate) {
      continue;
    }
    if (valueNumeric === null) {
      skippedMissing += 1;
      continue;
    }

    prepared.push({
      source_manifest_id: manifestId,
      series_key: "crypto_fear_greed",
      series_family: "crypto_sentiment",
      asset_scope: "BTC",
      region_scope: "GLOBAL",
      observed_at: `${observationDate}T00:00:00Z`,
      observation_date: observationDate,
      observation_timezone: "UTC",
      value_numeric: valueNumeric,
      value_text: classification,
      unit: "index_points",
      frequency: "daily",
      vendor_symbol: "ALTERNATIVE_ME_FNG",
      vendor_field: "value",
      is_revised: false,
      revision_tag: "base",
      metadata: {
        importer: "backtester/importers/crypto_fear_greed/import_crypto_fear_greed.js",
        value_classification: classification
      }
    });
  }

  return { prepared, skippedMissing };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || readOptionalEnv("CRYPTO_FEAR_GREED_IMPORT_START", DEFAULT_START);
  const endDate = args.end || readOptionalEnv("CRYPTO_FEAR_GREED_IMPORT_END", DEFAULT_END);
  const manifestName = args.manifest || readOptionalEnv("CRYPTO_FEAR_GREED_MANIFEST_NAME", DEFAULT_MANIFEST_NAME);

  assertDateRange(startDate, endDate);

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const payload = await fetchJson(API_URL);
  const records = Array.isArray(payload?.data) ? payload.data : [];

  const manifest = await ensureManifest(
    supabaseUrl,
    serviceRoleKey,
    {
      manifestName,
      vendorName: "Alternative.me",
      assetScope: "BTC"
    },
    {
      manifest_name: manifestName,
      source_type: "api_export",
      vendor_name: "Alternative.me",
      dataset_name: "Crypto Fear and Greed daily index",
      asset_scope: "BTC",
      coverage_start: startDate,
      coverage_end: endDate,
      frequency: "daily",
      import_mode: "historical_backfill",
      schema_version: DEFAULT_SCHEMA_VERSION,
      normalization_version: DEFAULT_NORMALIZATION_VERSION,
      source_uri: API_URL,
      license_notes: "Imported for internal historical replay research.",
      checksum: null,
      row_count: null,
      metadata: {
        importer: "backtester/importers/crypto_fear_greed/import_crypto_fear_greed.js"
      }
    }
  );

  const { prepared, skippedMissing } = buildRows(records, manifest.id, {
    startDate,
    endDate
  });

  await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_macro_series",
    prepared,
    ["series_key", "observed_at", "source_manifest_id", "revision_tag"]
  );

  console.log(JSON.stringify({
    manifest_id: manifest.id,
    rows_prepared: prepared.length,
    rows_submitted: prepared.length,
    rows_skipped_missing: skippedMissing,
    coverage_start: minDate(prepared.map((row) => row.observation_date)),
    coverage_end: maxDate(prepared.map((row) => row.observation_date)),
    series_key: "crypto_fear_greed"
  }, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Crypto Fear and Greed import failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
