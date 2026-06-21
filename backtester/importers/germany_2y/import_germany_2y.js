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
const DEFAULT_MANIFEST_NAME = "Germany 2Y daily history";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "germany_2y_importer_v1";
const BUNDESBANK_DAILY_2Y_ZAR_URL =
  "https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A?format=csv&lang=en";
const XML_OBS_PATTERN =
  /<[^>]*Obs[^>]*>[\s\S]*?<[^>]*(?:ObsDimension|Time)[^>]*value="([^"]+)"[^>]*\/?>[\s\S]*?<[^>]*(?:ObsValue|Value)[^>]*value="([^"]+)"[^>]*\/?>[\s\S]*?<\/[^>]*Obs>/gi;
const HEADER_ALIASES = {
  date: [
    "date",
    "datum",
    "time_period",
    "time period",
    "observation_date",
    "observation date",
    "day"
  ],
  value: [
    "value",
    "wert",
    "obs_value",
    "obs value",
    "yield",
    "rate",
    "close",
    "closing_value",
    "closing value"
  ],
  source_symbol: [
    "source_symbol",
    "source symbol",
    "symbol",
    "series",
    "series_key",
    "series key",
    "ticker"
  ],
  source_name: [
    "source_name",
    "source name",
    "name",
    "series_name",
    "series name",
    "title"
  ]
};

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}

function firstDefined(record, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    for (const [key, value] of Object.entries(record)) {
      if (normalizeHeader(key) === normalizedAlias && String(value || "").trim() !== "") {
        return value;
      }
    }
  }
  return "";
}

function normalizeDelimitedRecords(records, options) {
  return records.map((record) => ({
    date: String(firstDefined(record, HEADER_ALIASES.date) || "").trim(),
    value: String(firstDefined(record, HEADER_ALIASES.value) || "").trim(),
    source_symbol: String(firstDefined(record, HEADER_ALIASES.source_symbol) || options.vendorSymbol || "").trim(),
    source_name: String(firstDefined(record, HEADER_ALIASES.source_name) || options.vendorName || "").trim()
  }));
}

function normalizeBundesbankCsv(text, options) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const rows = [];
  const firstLine = lines[0] || "";
  const secondLine = lines[1] || "";
  const seriesIdMatch = firstLine.match(/^[^,]*,([^,]+)/);
  const seriesNameMatch = secondLine.match(/^[^,]*,([^,]+)/);
  const seriesId = seriesIdMatch ? seriesIdMatch[1].replace(/^"|"$/g, "").trim() : (options.vendorSymbol || "BUNDESBANK_DE2Y");
  const seriesName = seriesNameMatch ? seriesNameMatch[1].replace(/^"|"$/g, "").trim() : (options.vendorName || "Bundesbank Germany 2Y");

  for (const line of lines) {
    const match = line.match(/^"?(\d{4}-\d{2}-\d{2})"?,("?[^",]*"?)/);
    if (!match) {
      continue;
    }
    const dateCandidate = String(match[1] || "").trim();
    const valueCandidate = String(match[2] || "").replace(/^"|"$/g, "").trim();

    rows.push({
      date: dateCandidate,
      value: valueCandidate,
      source_symbol: seriesId,
      source_name: seriesName
    });
  }

  if (!rows.length) {
    throw new Error("Bundesbank CSV source detected, but no dated observation rows were parsed.");
  }

  return rows;
}

function normalizeXmlRecords(text, options) {
  const rows = [];
  let match;

  while ((match = XML_OBS_PATTERN.exec(text)) !== null) {
    rows.push({
      date: String(match[1] || "").trim(),
      value: String(match[2] || "").trim(),
      source_symbol: options.vendorSymbol,
      source_name: options.vendorName
    });
  }

  return rows;
}

function parseSourceRecords(text, options) {
  const trimmed = String(text || "").trimStart();
  if (trimmed.startsWith("<")) {
    const xmlRecords = normalizeXmlRecords(text, options);
    if (!xmlRecords.length) {
      throw new Error("XML source detected, but no observation rows were parsed.");
    }
    return {
      sourceFormat: "xml",
      records: xmlRecords
    };
  }

  if (trimmed.includes("BBSIS.") && trimmed.includes("Time format code")) {
    return {
      sourceFormat: "bundesbank_csv",
      records: normalizeBundesbankCsv(text, options)
    };
  }

  const records = parseDelimited(text, { delimiter: options.delimiter });
  const normalized = normalizeDelimitedRecords(records, options);
  return {
    sourceFormat: "delimited",
    records: normalized
  };
}

function buildRows(records, manifestId, options) {
  const prepared = [];
  let skippedMissing = 0;

  for (const record of records) {
    const observationDate = String(record.date || "").trim();
    const valueNumeric = toNullableNumber(record.value, {
      decimalComma: options.decimalComma,
      scale: options.valueScale === "bps" ? "bps_to_percent" : null
    });

    if (!observationDate || observationDate < options.startDate || observationDate > options.endDate) {
      continue;
    }

    if (valueNumeric === null) {
      skippedMissing += 1;
      continue;
    }

    prepared.push({
      source_manifest_id: manifestId,
      series_key: "de_2y_yield",
      series_family: "rates",
      asset_scope: "USD",
      region_scope: "DE",
      observed_at: `${observationDate}T00:00:00Z`,
      observation_date: observationDate,
      observation_timezone: "UTC",
      value_numeric: valueNumeric,
      value_text: null,
      unit: "percent",
      frequency: "daily",
      vendor_symbol: record.source_symbol || options.vendorSymbol,
      vendor_field: "value",
      is_revised: false,
      revision_tag: "base",
      metadata: {
        importer: "backtester/importers/germany_2y/import_germany_2y.js",
        source_name: record.source_name || null,
        original_value: record.value
      }
    });
  }

  return { prepared, skippedMissing };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || readOptionalEnv("GERMANY_2Y_IMPORT_START", DEFAULT_START);
  const endDate = args.end || readOptionalEnv("GERMANY_2Y_IMPORT_END", DEFAULT_END);
  const manifestName = args.manifest || readOptionalEnv("GERMANY_2Y_MANIFEST_NAME", DEFAULT_MANIFEST_NAME);
  const filePath = args.file || readOptionalEnv("GERMANY_2Y_IMPORT_FILE");
  const sourcePreset = args.source || readOptionalEnv("GERMANY_2Y_SOURCE_PRESET", "bundesbank_2y_daily");
  const sourceUrl = args["source-url"] || readOptionalEnv(
    "GERMANY_2Y_SOURCE_URL",
    !filePath && sourcePreset === "bundesbank_2y_daily" ? BUNDESBANK_DAILY_2Y_ZAR_URL : null
  );
  const vendorName = args["vendor-name"] || readOptionalEnv(
    "GERMANY_2Y_VENDOR_NAME",
    sourcePreset === "bundesbank_2y_daily" ? "Bundesbank" : "manual_source"
  );
  const vendorSymbol = args["vendor-symbol"] || readOptionalEnv(
    "GERMANY_2Y_VENDOR_SYMBOL",
    sourcePreset === "bundesbank_2y_daily"
      ? "BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A"
      : "DE2Y"
  );
  const delimiter = args.delimiter || readOptionalEnv("GERMANY_2Y_IMPORT_DELIMITER");
  const decimalComma = String(
    args["decimal-comma"] || readOptionalEnv("GERMANY_2Y_DECIMAL_COMMA", "false")
  ).toLowerCase() === "true";
  const valueScale = args["value-scale"] || readOptionalEnv("GERMANY_2Y_VALUE_SCALE", "percent");
  const previewOnly = String(args["preview-only"] || "false").toLowerCase() === "true";

  assertDateRange(startDate, endDate);

  const text = await readTextInput({ filePath, sourceUrl });
  const { sourceFormat, records } = parseSourceRecords(text, {
    delimiter,
    vendorName,
    vendorSymbol
  });
  const { prepared, skippedMissing } = buildRows(records, "preview-manifest", {
    decimalComma,
    endDate,
    startDate,
    valueScale,
    vendorSymbol
  });

  if (previewOnly) {
    console.log(JSON.stringify({
      mode: "preview",
      source_format: sourceFormat,
      prepared_rows: prepared.length,
      skipped_missing: skippedMissing,
      sample_rows: prepared.slice(0, 3).map((row) => ({
        observation_date: row.observation_date,
        value_numeric: row.value_numeric,
        vendor_symbol: row.vendor_symbol,
        metadata: row.metadata
      }))
    }, null, 2));
    return;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const manifestPayload = {
    manifest_name: manifestName,
    source_type: filePath ? "csv_upload" : "api_export",
    vendor_name: vendorName,
    dataset_name: "Germany 2Y historical daily series",
    asset_scope: "USD",
    coverage_start: startDate,
    coverage_end: endDate,
    frequency: "daily",
    import_mode: "historical_backfill",
    schema_version: DEFAULT_SCHEMA_VERSION,
    normalization_version: DEFAULT_NORMALIZATION_VERSION,
    source_uri: sourceUrl || filePath || null,
    metadata: {
      importer: "backtester/importers/germany_2y/import_germany_2y.js",
      vendor_symbol: vendorSymbol,
      source_preset: sourcePreset,
      source_format: sourceFormat,
      decimal_comma: decimalComma,
      value_scale: valueScale,
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

  const preparedRows = buildRows(records, manifest.id, {
    decimalComma,
    endDate,
    startDate,
    valueScale,
    vendorSymbol
  });
  const preparedForSubmit = preparedRows.prepared;
  const skippedForSubmit = preparedRows.skippedMissing;

  const submitted = await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_macro_series",
    preparedForSubmit,
    ["series_key", "observed_at", "source_manifest_id", "revision_tag"]
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
      row_count: preparedForSubmit.length,
      coverage_start: minDate(preparedForSubmit.map((row) => row.observation_date)) || startDate,
      coverage_end: maxDate(preparedForSubmit.map((row) => row.observation_date)) || endDate,
      metadata: {
        ...manifestPayload.metadata,
        prepared_rows: preparedForSubmit.length,
        submitted_rows: submitted,
        skipped_missing: skippedForSubmit
      }
    }
  );

  console.log(`[DE2Y] format=${sourceFormat} prepared=${preparedForSubmit.length} submitted=${submitted} skipped_missing=${skippedForSubmit}`);
  console.log(`Manifest: ${manifestName}`);
  console.log(`Series key: de_2y_yield`);
  console.log(`Date range: ${startDate} -> ${endDate}`);
}

module.exports = {
  BUNDESBANK_DAILY_2Y_ZAR_URL,
  buildRows,
  normalizeBundesbankCsv,
  normalizeDelimitedRecords,
  normalizeXmlRecords,
  parseSourceRecords,
  run
};

if (require.main === module) {
  run().catch((error) => {
    console.error("Germany 2Y import failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
