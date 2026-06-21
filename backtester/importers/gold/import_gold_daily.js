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
const DEFAULT_MANIFEST_NAME = "Gold daily history";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "gold_daily_importer_v1";
const DEFAULT_FRED_SERIES_ID = "GOLDAMGBD228NLBM";

function buildFredUrl(seriesId, apiKey, startDate, endDate) {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "asc");
  url.searchParams.set("observation_start", startDate);
  url.searchParams.set("observation_end", endDate);
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}\n${body}`);
  }
  return response.json();
}

function parseFredGoldObservations(payload, seriesId) {
  const observations = Array.isArray(payload?.observations) ? payload.observations : [];

  return observations
    .filter((row) => row && row.value !== "." && row.value !== "" && row.value !== null)
    .map((row) => {
      const close = toNullableNumber(row.value);
      if (close === null || close <= 0) {
        return null;
      }

      return {
        date: row.date,
        open: "",
        high: "",
        low: "",
        close: String(close),
        volume: "",
        instrument: "LBMA Gold Price AM USD",
        source_symbol: seriesId,
        source_note: "FRED LBMA daily USD gold price"
      };
    })
    .filter(Boolean);
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
      is_adjusted: Boolean(options.isAdjusted),
      adjustment_type: options.isAdjusted ? "source_adjusted" : null,
      metadata: {
        importer: "backtester/importers/gold/import_gold_daily.js",
        proxy_label: options.proxyLabel,
        source_instrument: record.instrument || null
      }
    });
  }

  return { prepared, skippedMissing };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || readOptionalEnv("GOLD_IMPORT_START", DEFAULT_START);
  const endDate = args.end || readOptionalEnv("GOLD_IMPORT_END", DEFAULT_END);
  const manifestName = args.manifest || readOptionalEnv("GOLD_MANIFEST_NAME", DEFAULT_MANIFEST_NAME);
  const filePath = args.file || readOptionalEnv("GOLD_IMPORT_FILE");
  const sourcePreset = args.source || readOptionalEnv("GOLD_SOURCE_PRESET", "file");
  const fredSeriesId = args["fred-series-id"] || readOptionalEnv("GOLD_FRED_SERIES_ID", DEFAULT_FRED_SERIES_ID);
  const sourceUrl = args["source-url"] || readOptionalEnv("GOLD_SOURCE_URL");
  const instrumentKey = args["instrument-key"] || readOptionalEnv("GOLD_INSTRUMENT_KEY", "gold_spot_usd");
  const instrumentFamily = args["instrument-family"] || readOptionalEnv("GOLD_INSTRUMENT_FAMILY", "commodity");
  const vendorName = args["vendor-name"] || readOptionalEnv(
    "GOLD_VENDOR_NAME",
    sourcePreset === "fred_lbma_usd_am" ? "FRED" : "manual_source"
  );
  const vendorSymbol = args["vendor-symbol"] || readOptionalEnv(
    "GOLD_VENDOR_SYMBOL",
    sourcePreset === "fred_lbma_usd_am" ? fredSeriesId : "XAUUSD"
  );
  const proxyLabel = args["proxy-label"] || readOptionalEnv(
    "GOLD_PROXY_LABEL",
    sourcePreset === "fred_lbma_usd_am"
      ? "lbma_spot_fix_via_fred"
      : instrumentKey === "gold_spot_usd"
        ? "spot"
        : "proxy"
  );
  const delimiter = args.delimiter || readOptionalEnv("GOLD_IMPORT_DELIMITER");
  const isAdjusted = String(args.adjusted || readOptionalEnv("GOLD_IS_ADJUSTED", "false")).toLowerCase() === "true";

  assertDateRange(startDate, endDate);

  if (sourcePreset !== "fred_lbma_usd_am" && !filePath && !sourceUrl) {
    throw new Error("Provide --file or --source-url, or use --source=fred_lbma_usd_am.");
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const records = sourcePreset === "fred_lbma_usd_am"
    ? parseFredGoldObservations(
        await fetchJson(buildFredUrl(fredSeriesId, requireEnv("FRED_API_KEY"), startDate, endDate)),
        fredSeriesId
      )
    : parseDelimited(await readTextInput({ filePath, sourceUrl }), { delimiter });

  const manifestPayload = {
    manifest_name: manifestName,
    source_type: filePath ? "csv_upload" : "api_export",
    vendor_name: vendorName,
    dataset_name: `Gold daily history (${instrumentKey})`,
    asset_scope: "USD",
    coverage_start: startDate,
    coverage_end: endDate,
    frequency: "daily",
    import_mode: "historical_backfill",
    schema_version: DEFAULT_SCHEMA_VERSION,
    normalization_version: DEFAULT_NORMALIZATION_VERSION,
    source_uri: sourceUrl || filePath || null,
    metadata: {
      importer: "backtester/importers/gold/import_gold_daily.js",
      instrument_key: instrumentKey,
      source_preset: sourcePreset,
      proxy_label: proxyLabel,
      vendor_symbol: vendorSymbol,
      is_adjusted: isAdjusted,
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
    instrumentFamily,
    instrumentKey,
    isAdjusted,
    proxyLabel,
    startDate,
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

  console.log(`[GOLD] prepared=${prepared.length} submitted=${submitted} skipped_missing=${skippedMissing}`);
  console.log(`Manifest: ${manifestName}`);
  console.log(`Instrument key: ${instrumentKey}`);
  console.log(`Date range: ${startDate} -> ${endDate}`);
}

run().catch((error) => {
  console.error("Gold daily import failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
