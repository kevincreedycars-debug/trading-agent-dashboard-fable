#!/usr/bin/env node

const DEFAULT_START = "2000-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const DEFAULT_MANIFEST_NAME = "FRED macro daily USD";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "fred_macro_importer_v1";

const SERIES_CONFIG = Object.freeze([
  {
    fredSeriesId: "DGS2",
    seriesKey: "us_2y_yield",
    seriesFamily: "rates",
    assetScope: "USD",
    regionScope: "US",
    unit: "percent"
  },
  {
    fredSeriesId: "DGS10",
    seriesKey: "us_10y_yield",
    seriesFamily: "rates",
    assetScope: "USD",
    regionScope: "US",
    unit: "percent"
  },
  {
    fredSeriesId: "DFII10",
    seriesKey: "us_10y_real_yield",
    seriesFamily: "rates",
    assetScope: "USD",
    regionScope: "US",
    unit: "percent"
  },
  {
    fredSeriesId: "VIXCLS",
    seriesKey: "vix_level",
    seriesFamily: "volatility",
    assetScope: "USD",
    regionScope: "US",
    unit: "index_points"
  },
  {
    fredSeriesId: "DTWEXBGS",
    seriesKey: "dxy_level",
    seriesFamily: "fx_index",
    assetScope: "USD",
    regionScope: "GLOBAL",
    unit: "index_points"
  }
]);

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) continue;
    const [key, value] = rawArg.slice(2).split("=");
    args[key] = value === undefined ? "true" : value;
  }

  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validateDateLiteral(label, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD. Received: ${value}`);
  }
}

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

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}\n${body}`);
  }
  return response.text();
}

function parseFredObservations(seriesConfig, payload) {
  const observations = Array.isArray(payload.observations) ? payload.observations : [];

  return observations
    .filter((row) => row && row.value !== "." && row.value !== "" && row.value !== null)
    .map((row) => {
      const numeric = Number(row.value);
      if (!Number.isFinite(numeric)) {
        return null;
      }

      return {
        date: row.date,
        value: numeric,
        realtime_start: row.realtime_start || null,
        realtime_end: row.realtime_end || null,
        series_id: payload.observation_start ? seriesConfig.fredSeriesId : (row.series_id || seriesConfig.fredSeriesId)
      };
    })
    .filter(Boolean);
}

function buildMacroRows(seriesConfig, manifestId, observations) {
  return observations.map((row) => ({
    source_manifest_id: manifestId,
    series_key: seriesConfig.seriesKey,
    series_family: seriesConfig.seriesFamily,
    asset_scope: seriesConfig.assetScope,
    region_scope: seriesConfig.regionScope,
    observed_at: `${row.date}T00:00:00Z`,
    observation_date: row.date,
    observation_timezone: "UTC",
    value_numeric: row.value,
    value_text: null,
    unit: seriesConfig.unit,
    frequency: "daily",
    vendor_symbol: seriesConfig.fredSeriesId,
    vendor_field: "value",
    is_revised: false,
    revision_tag: "base",
    metadata: {
      fred_series_id: seriesConfig.fredSeriesId,
      realtime_start: row.realtime_start,
      realtime_end: row.realtime_end
    }
  }));
}

function getSupabaseHeaders(serviceRoleKey, prefer = null) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };

  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function selectExistingManifest(supabaseUrl, serviceRoleKey, manifestName) {
  const url = new URL(`${supabaseUrl}/rest/v1/historical_source_manifests`);
  url.searchParams.set("select", "*");
  url.searchParams.set("manifest_name", `eq.${manifestName}`);
  url.searchParams.set("vendor_name", "eq.FRED");
  url.searchParams.set("asset_scope", "eq.USD");
  url.searchParams.set("limit", "1");

  return fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });
}

async function createManifest(supabaseUrl, serviceRoleKey, payload) {
  const url = `${supabaseUrl}/rest/v1/historical_source_manifests`;
  const rows = await fetchJson(url, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });

  return rows[0];
}

async function updateManifest(supabaseUrl, serviceRoleKey, manifestId, payload) {
  const url = new URL(`${supabaseUrl}/rest/v1/historical_source_manifests`);
  url.searchParams.set("id", `eq.${manifestId}`);
  url.searchParams.set("select", "*");

  const rows = await fetchJson(url.toString(), {
    method: "PATCH",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });

  return rows[0];
}

async function upsertMacroRows(supabaseUrl, serviceRoleKey, rows) {
  if (!rows.length) return 0;

  const chunkSize = 500;
  let processed = 0;

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const url = new URL(`${supabaseUrl}/rest/v1/historical_macro_series`);
    url.searchParams.set(
      "on_conflict",
      "series_key,observed_at,source_manifest_id,revision_tag"
    );

    await fetchText(url.toString(), {
      method: "POST",
      headers: getSupabaseHeaders(serviceRoleKey, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(chunk)
    });

    processed += chunk.length;
  }

  return processed;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const startDate = args.start || process.env.FRED_IMPORT_START || DEFAULT_START;
  const endDate = args.end || process.env.FRED_IMPORT_END || DEFAULT_END;
  const manifestName = args.manifest || process.env.FRED_MANIFEST_NAME || DEFAULT_MANIFEST_NAME;

  validateDateLiteral("start", startDate);
  validateDateLiteral("end", endDate);

  const fredApiKey = requireEnv("FRED_API_KEY");
  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const importCounts = {};
  let totalRowsPrepared = 0;
  let totalRowsSubmitted = 0;

  const existing = await selectExistingManifest(supabaseUrl, serviceRoleKey, manifestName);
  let manifest = existing[0] || null;

  const manifestPayload = {
    manifest_name: manifestName,
    source_type: "api_export",
    vendor_name: "FRED",
    dataset_name: "USD macro daily historical series",
    asset_scope: "USD",
    coverage_start: startDate,
    coverage_end: endDate,
    frequency: "daily",
    import_mode: "historical_backfill",
    schema_version: DEFAULT_SCHEMA_VERSION,
    normalization_version: DEFAULT_NORMALIZATION_VERSION,
    source_uri: "https://api.stlouisfed.org/fred/series/observations",
    metadata: {
      importer: "backtester/importers/fred/import_fred_macro.js",
      series: SERIES_CONFIG.map((series) => ({
        fred_series_id: series.fredSeriesId,
        series_key: series.seriesKey
      })),
      last_requested_start: startDate,
      last_requested_end: endDate,
      last_imported_at: new Date().toISOString()
    }
  };

  manifest = manifest
    ? await updateManifest(supabaseUrl, serviceRoleKey, manifest.id, manifestPayload)
    : await createManifest(supabaseUrl, serviceRoleKey, manifestPayload);

  for (const seriesConfig of SERIES_CONFIG) {
    const url = buildFredUrl(seriesConfig.fredSeriesId, fredApiKey, startDate, endDate);
    const payload = await fetchJson(url);
    const observations = parseFredObservations(seriesConfig, payload);
    const rows = buildMacroRows(seriesConfig, manifest.id, observations);
    const submitted = await upsertMacroRows(supabaseUrl, serviceRoleKey, rows);

    importCounts[seriesConfig.seriesKey] = {
      fred_series_id: seriesConfig.fredSeriesId,
      prepared_rows: rows.length,
      submitted_rows: submitted
    };

    totalRowsPrepared += rows.length;
    totalRowsSubmitted += submitted;

    console.log(
      `[FRED] ${seriesConfig.fredSeriesId} -> ${seriesConfig.seriesKey}: prepared=${rows.length} submitted=${submitted}`
    );
  }

  await updateManifest(supabaseUrl, serviceRoleKey, manifest.id, {
    row_count: totalRowsPrepared,
    coverage_start: startDate,
    coverage_end: endDate,
    metadata: {
      importer: "backtester/importers/fred/import_fred_macro.js",
      series_import_counts: importCounts,
      last_requested_start: startDate,
      last_requested_end: endDate,
      last_imported_at: new Date().toISOString(),
      total_rows_prepared: totalRowsPrepared,
      total_rows_submitted: totalRowsSubmitted
    }
  });

  console.log("");
  console.log("Import complete.");
  console.log(`Manifest: ${manifestName}`);
  console.log(`Manifest ID: ${manifest.id}`);
  console.log(`Date range: ${startDate} -> ${endDate}`);
  console.log(`Total prepared rows: ${totalRowsPrepared}`);
  console.log(`Total submitted rows: ${totalRowsSubmitted}`);
}

run().catch((error) => {
  console.error("FRED historical macro import failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
