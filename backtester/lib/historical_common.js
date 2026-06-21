const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) continue;
    const [key, ...rest] = rawArg.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : "true";
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

function readOptionalEnv(name, fallback = null) {
  return process.env[name] || fallback;
}

function validateDateLiteral(label, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD. Received: ${value}`);
  }
}

function assertDateRange(startDate, endDate) {
  validateDateLiteral("start", startDate);
  validateDateLiteral("end", endDate);

  if (startDate > endDate) {
    throw new Error(`start must be <= end. Received ${startDate} > ${endDate}`);
  }
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

async function readTextInput({ filePath = null, sourceUrl = null }) {
  if (filePath) {
    const resolvedPath = path.resolve(filePath);
    return fs.readFileSync(resolvedPath, "utf8");
  }

  if (sourceUrl) {
    return fetchText(sourceUrl);
  }

  throw new Error("Provide either --file or --source-url.");
}

function getSupabaseHeaders(serviceRoleKey, prefer = null) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };

  if (prefer) {
    headers.Prefer = prefer;
  }

  return headers;
}

async function selectExistingManifest(supabaseUrl, serviceRoleKey, manifestName, vendorName, assetScope) {
  const url = new URL(`${supabaseUrl}/rest/v1/historical_source_manifests`);
  url.searchParams.set("select", "*");
  url.searchParams.set("manifest_name", `eq.${manifestName}`);
  url.searchParams.set("vendor_name", `eq.${vendorName}`);
  url.searchParams.set("asset_scope", `eq.${assetScope}`);
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

async function ensureManifest(supabaseUrl, serviceRoleKey, manifestKey, payload) {
  const existing = await selectExistingManifest(
    supabaseUrl,
    serviceRoleKey,
    manifestKey.manifestName,
    manifestKey.vendorName,
    manifestKey.assetScope
  );

  const manifest = existing[0] || null;

  return manifest
    ? updateManifest(supabaseUrl, serviceRoleKey, manifest.id, payload)
    : createManifest(supabaseUrl, serviceRoleKey, payload);
}

async function upsertRows(supabaseUrl, serviceRoleKey, tableName, rows, onConflictColumns, chunkSize = 500) {
  if (!rows.length) {
    return 0;
  }

  let processed = 0;

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const url = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
    url.searchParams.set("on_conflict", onConflictColumns.join(","));

    await fetchText(url.toString(), {
      method: "POST",
      headers: getSupabaseHeaders(serviceRoleKey, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(chunk)
    });

    processed += chunk.length;
  }

  return processed;
}

async function fetchAllRows(supabaseUrl, serviceRoleKey, tableName, queryBuilder) {
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
    queryBuilder(url);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));

    const page = await fetchJson(url.toString(), {
      headers: getSupabaseHeaders(serviceRoleKey)
    });

    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

function detectDelimiter(text, forcedDelimiter = null) {
  if (forcedDelimiter) {
    return forcedDelimiter;
  }

  const firstLine = String(text).replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;

  return semicolonCount > commaCount ? ";" : ",";
}

function parseDelimited(text, options = {}) {
  const delimiter = detectDelimiter(text, options.delimiter);
  const source = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(value);
      value = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header) => String(header || "").trim());

  return dataRows
    .filter((dataRow) => dataRow.some((cell) => String(cell || "").trim() !== ""))
    .map((dataRow) => {
      const record = {};
      headers.forEach((header, headerIndex) => {
        record[header] = dataRow[headerIndex] !== undefined ? String(dataRow[headerIndex]).trim() : "";
      });
      return record;
    });
}

function toNullableNumber(value, options = {}) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text || text === "." || text.toLowerCase() === "null" || text.toLowerCase() === "n/a") {
    return null;
  }

  let normalized = text;
  if (options.decimalComma) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (options.scale === "bps_to_percent") {
    return numeric / 100;
  }

  return numeric;
}

function minDate(values) {
  return values.length ? values.slice().sort()[0] : null;
}

function maxDate(values) {
  return values.length ? values.slice().sort()[values.length - 1] : null;
}

module.exports = {
  assertDateRange,
  createManifest,
  detectDelimiter,
  ensureManifest,
  fetchAllRows,
  fetchJson,
  fetchText,
  getSupabaseHeaders,
  maxDate,
  minDate,
  parseArgs,
  parseDelimited,
  readOptionalEnv,
  readTextInput,
  requireEnv,
  selectExistingManifest,
  toNullableNumber,
  updateManifest,
  upsertRows,
  validateDateLiteral
};
