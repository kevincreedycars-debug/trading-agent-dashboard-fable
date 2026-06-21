#!/usr/bin/env node

const {
  assertDateRange,
  ensureManifest,
  maxDate,
  minDate,
  parseArgs,
  readOptionalEnv,
  requireEnv,
  upsertRows
} = require("../../lib/historical_common");

const DEFAULT_MANIFEST_NAME = "USD historical economic events";
const DEFAULT_SCHEMA_VERSION = "v1";
const DEFAULT_NORMALIZATION_VERSION = "usd_events_importer_v1";
const DEFAULT_HOST = "forex-factory-scraper1.p.rapidapi.com";
const DEFAULT_TIMEZONE = "GMT-06:00 Central Time (US & Canada)";
const DEFAULT_TIME_FORMAT = "12h";
const DEFAULT_COUNTRY = "US";
const DEFAULT_CURRENCY = "USD";
const DEFAULT_SOURCE_URI = `https://${DEFAULT_HOST}/get_calendar_details`;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_MAX_REQUESTS = 250;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeName(value) {
  const text = clean(value);
  return text ? text.replace(/\s+/g, " ").trim() : null;
}

function normalizeTimeText(value) {
  const text = clean(value);
  if (!text) return "00:00";
  return text.replace(/\s+/g, " ").replace(/am/ig, "AM").replace(/pm/ig, "PM").trim();
}

function parseRapidApiKey(text) {
  const match = String(text || "").match(/x-rapidapi-key:\s*([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
}

function parseNumericValue(value) {
  const text = clean(value);
  if (!text) return null;

  let normalized = text
    .replace(/\u2212/g, "-")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  let multiplier = 1;
  if (/[Kk]$/.test(normalized)) {
    multiplier = 1_000;
    normalized = normalized.slice(0, -1);
  } else if (/[Mm]$/.test(normalized)) {
    multiplier = 1_000_000;
    normalized = normalized.slice(0, -1);
  } else if (/[Bb]$/.test(normalized)) {
    multiplier = 1_000_000_000;
    normalized = normalized.slice(0, -1);
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric * multiplier : null;
}

function impactRank(impact) {
  const text = String(impact || "").toLowerCase();
  if (text.includes("high")) return 3;
  if (text.includes("medium")) return 2;
  if (text.includes("low")) return 1;
  return 0;
}

function importanceFromImpact(impact) {
  const rank = impactRank(impact);
  if (rank === 3) return "high";
  if (rank === 2) return "medium";
  if (rank === 1) return "low";
  return null;
}

function classifySurprise(event) {
  const actual = parseNumericValue(event.actual);
  const forecast = parseNumericValue(event.forecast);
  const usual = String(event.usual_effect || "").toLowerCase();

  if (actual === null || forecast === null) return null;

  let goodIfHigher = true;
  if (usual.includes("less than") || usual.includes("lower") || usual.includes("actual less")) {
    goodIfHigher = false;
  }

  if (actual === forecast) return "neutral";
  const positive = goodIfHigher ? actual > forecast : actual < forecast;
  return positive ? "positive" : "negative";
}

function currencySignal(currency, surpriseDirection) {
  if (surpriseDirection === "positive") return "BULLISH";
  if (surpriseDirection === "negative") return "BEARISH";
  if (surpriseDirection === "neutral") return "NEUTRAL";
  return null;
}

function normalizeEventKey(name) {
  const normalized = String(name || "").toLowerCase();

  if (normalized.includes("non farm payroll") || normalized.includes("non-farm payroll")) return "NFP";
  if (normalized.includes("average hourly earnings")) return "AHE_MOM";
  if (normalized.includes("unemployment rate")) return "UNEMPLOYMENT_RATE";
  if (normalized.includes("core inflation rate mom")) return "CORE_CPI_MOM";
  if (normalized.includes("inflation rate mom")) return "CPI_MOM";
  if (normalized.includes("core pce price index mom")) return "CORE_PCE_MOM";
  if (normalized.includes("pce price index mom")) return "PCE_MOM";
  if (normalized.includes("ism services pmi")) return "ISM_SERVICES_PMI";
  if (normalized.includes("ism manufacturing pmi")) return "ISM_MANUFACTURING_PMI";
  if (normalized.includes("retail sales mom")) return "RETAIL_SALES_MOM";
  if (normalized.includes("gdp growth rate qoq adv")) return "GDP_QOQ_ADV";
  if (normalized.includes("initial jobless claims")) return "INITIAL_JOBLESS_CLAIMS";
  if (normalized.includes("jolts job openings")) return "JOLTS_JOB_OPENINGS";
  if (normalized.includes("fomc")) return "FOMC";
  if (normalized.includes("fed")) return "FED";

  return null;
}

function eventCategory(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("fomc") || normalized.includes("fed")) return "central_bank";
  if (normalized.includes("payroll") || normalized.includes("unemployment") || normalized.includes("claims") || normalized.includes("jolts")) {
    return "labor";
  }
  if (normalized.includes("cpi") || normalized.includes("inflation") || normalized.includes("pce") || normalized.includes("ppi")) {
    return "inflation";
  }
  if (normalized.includes("ism") || normalized.includes("pmi") || normalized.includes("gdp") || normalized.includes("retail sales") || normalized.includes("factory orders")) {
    return "growth";
  }
  return "macro";
}

function buildDailyUrl(dateLiteral, options) {
  const date = new Date(`${dateLiteral}T00:00:00Z`);
  const url = new URL(`https://${options.host}/get_calendar_details`);
  url.searchParams.set("year", String(date.getUTCFullYear()));
  url.searchParams.set("month", String(date.getUTCMonth() + 1));
  url.searchParams.set("day", String(date.getUTCDate()));
  url.searchParams.set("currency", options.currency);
  url.searchParams.set("event_name", "ALL");
  url.searchParams.set("timezone", options.timezone);
  url.searchParams.set("time_format", options.timeFormat);
  return url.toString();
}

async function fetchDailyCalendar(dateLiteral, options) {
  const url = buildDailyUrl(dateLiteral, options);
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": options.host,
      "x-rapidapi-key": options.rapidApiKey
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${dateLiteral} ${url}\n${body}`);
  }

  return response.json();
}

function toPositiveInteger(value, label) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive integer. Received: ${value}`);
  }
  return numeric;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDailyCalendarWithRetry(dateLiteral, options) {
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await fetchDailyCalendar(dateLiteral, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      const isRateLimit = message.includes("HTTP 429");

      if (!isRateLimit || attempt >= options.maxRetries) {
        const failure = new Error(
          `Request failed for ${dateLiteral} after ${attempt} attempt(s).\n${message}`
        );
        failure.failedDate = dateLiteral;
        throw failure;
      }

      const waitMs = options.retryDelayMs * attempt;
      console.error(`[USD_EVENTS] 429 on ${dateLiteral}; retry ${attempt}/${options.maxRetries} after ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

function listDates(startDate, endDate) {
  const dates = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function timezoneOffsetMinutes(timezone) {
  const match = String(timezone || "").match(/GMT([+-])(\d{2}):(\d{2})/i);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * ((Number(match[2]) * 60) + Number(match[3]));
}

function toUtcIso(dateLiteral, timeText, timezone) {
  const normalizedTime = normalizeTimeText(timeText);
  const offsetMinutes = timezoneOffsetMinutes(timezone);
  const specialTime = /^(all day|tentative|day \d+|holiday)$/i.test(normalizedTime);
  const fallbackTime = specialTime || normalizedTime === "00:00" ? "12:00AM" : normalizedTime;
  const match = fallbackTime.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);

  if (!match || offsetMinutes === null) {
    return `${dateLiteral}T00:00:00Z`;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hours === 12) hours = 0;
  if (meridiem === "PM") hours += 12;

  const utcMillis = Date.UTC(
    Number(dateLiteral.slice(0, 4)),
    Number(dateLiteral.slice(5, 7)) - 1,
    Number(dateLiteral.slice(8, 10)),
    hours,
    minutes
  ) - (offsetMinutes * 60 * 1000);

  return new Date(utcMillis).toISOString();
}

function buildKey(row) {
  return [
    row.event_date || "",
    row.currency || "",
    row.event_name || "",
    row.event_time_text || ""
  ].join("|").toLowerCase();
}

function qualityScore(row) {
  let score = 0;
  if (row.actual_numeric !== null) score += 8;
  if (row.forecast_numeric !== null) score += 4;
  if (row.previous_numeric !== null) score += 2;
  score += row.importance === "high" ? 3 : row.importance === "medium" ? 2 : row.importance === "low" ? 1 : 0;
  return score;
}

function normalizeDailyPayload(dateLiteral, payload, options) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.value)
      ? payload.value
      : [];
  const deduped = new Map();

  for (const rawEvent of items) {
    const currency = clean(rawEvent.currency) || options.currency;
    if (currency !== options.currency) {
      continue;
    }

    const eventName = normalizeName(rawEvent.name);
    if (!eventName) {
      continue;
    }

    const eventDate = clean(rawEvent.date) || dateLiteral;
    const eventTimeText = normalizeTimeText(rawEvent.time);
    const surpriseDirection = classifySurprise(rawEvent);
    const importance = importanceFromImpact(rawEvent.impact);

    const row = {
      event_key: normalizeEventKey(eventName),
      event_name: eventName,
      event_category: eventCategory(eventName),
      country: DEFAULT_COUNTRY,
      currency,
      region_scope: DEFAULT_COUNTRY,
      event_time: toUtcIso(eventDate, eventTimeText, options.timezone),
      event_date: eventDate,
      event_timezone: options.timezone,
      importance,
      actual_numeric: parseNumericValue(rawEvent.actual),
      forecast_numeric: parseNumericValue(rawEvent.forecast),
      previous_numeric: parseNumericValue(rawEvent.previous),
      actual_text: clean(rawEvent.actual),
      forecast_text: clean(rawEvent.forecast),
      previous_text: clean(rawEvent.previous),
      surprise_direction: surpriseDirection,
      currency_signal: currencySignal(currency, surpriseDirection),
      vendor_event_id: clean(rawEvent.id) || null,
      revision_status: null,
      event_time_text: eventTimeText,
      metadata: {
        importer: "backtester/importers/usd_events/import_usd_events.js",
        source: "forex_factory_rapidapi",
        source_date: dateLiteral,
        impact_text: clean(rawEvent.impact),
        description: clean(rawEvent.description),
        source_link: clean(rawEvent.source),
        source_last_release: clean(rawEvent.source_last_release),
        next_release_date: clean(rawEvent.next_release_date),
        measures: clean(rawEvent.measures),
        usual_effect: clean(rawEvent.usual_effect),
        ff_notes: clean(rawEvent.ff_notes),
        derived_via: clean(rawEvent.derived_via),
        also_called: clean(rawEvent.also_called),
        acro_expand: clean(rawEvent.acro_expand),
        why_traders_care: clean(rawEvent.why_traders_care),
        history_data: (() => {
          if (Array.isArray(rawEvent.history_data)) return rawEvent.history_data;
          if (typeof rawEvent.history_data === "string") {
            try {
              const parsed = JSON.parse(rawEvent.history_data);
              return Array.isArray(parsed) ? parsed : null;
            } catch (error) {
              return rawEvent.history_data;
            }
          }
          return null;
        })(),
        raw_json: rawEvent
      }
    };

    const existing = deduped.get(buildKey(row));
    if (!existing || qualityScore(row) > qualityScore(existing)) {
      deduped.set(buildKey(row), row);
    }
  }

  return Array.from(deduped.values());
}

function attachManifest(rows, manifestId) {
  return rows.map((row) => ({
    source_manifest_id: manifestId,
    event_key: row.event_key,
    event_name: row.event_name,
    event_category: row.event_category,
    country: row.country,
    currency: row.currency,
    region_scope: row.region_scope,
    event_time: row.event_time,
    event_date: row.event_date,
    event_timezone: row.event_timezone,
    importance: row.importance,
    actual_numeric: row.actual_numeric,
    forecast_numeric: row.forecast_numeric,
    previous_numeric: row.previous_numeric,
    actual_text: row.actual_text,
    forecast_text: row.forecast_text,
    previous_text: row.previous_text,
    surprise_direction: row.surprise_direction,
    currency_signal: row.currency_signal,
    vendor_event_id: row.vendor_event_id,
    revision_status: row.revision_status,
    metadata: row.metadata
  }));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || readOptionalEnv("USD_EVENTS_IMPORT_START");
  const endDate = args.end || readOptionalEnv("USD_EVENTS_IMPORT_END");
  const manifestName = args.manifest || readOptionalEnv("USD_EVENTS_MANIFEST_NAME", DEFAULT_MANIFEST_NAME);
  const host = args.host || readOptionalEnv("USD_EVENTS_RAPIDAPI_HOST", DEFAULT_HOST);
  const timezone = args.timezone || readOptionalEnv("USD_EVENTS_TIMEZONE", DEFAULT_TIMEZONE);
  const timeFormat = args["time-format"] || readOptionalEnv("USD_EVENTS_TIME_FORMAT", DEFAULT_TIME_FORMAT);
  const currency = args.currency || readOptionalEnv("USD_EVENTS_CURRENCY", DEFAULT_CURRENCY);
  const delayMs = toPositiveInteger(
    args["delay-ms"] || readOptionalEnv("USD_EVENTS_DELAY_MS", String(DEFAULT_DELAY_MS)),
    "delay-ms"
  );
  const maxRequests = toPositiveInteger(
    args["max-requests"] || readOptionalEnv("USD_EVENTS_MAX_REQUESTS", String(DEFAULT_MAX_REQUESTS)),
    "max-requests"
  );
  const maxRetries = toPositiveInteger(
    args["max-retries"] || readOptionalEnv("USD_EVENTS_MAX_RETRIES", String(DEFAULT_MAX_RETRIES)),
    "max-retries"
  );
  const retryDelayMs = toPositiveInteger(
    args["retry-delay-ms"] || readOptionalEnv("USD_EVENTS_RETRY_DELAY_MS", String(DEFAULT_RETRY_DELAY_MS)),
    "retry-delay-ms"
  );
  const previewOnly = String(args["preview-only"] || "false").toLowerCase() === "true";

  if (!startDate || !endDate) {
    throw new Error("Both --start and --end are required for resumable bounded imports.");
  }

  assertDateRange(startDate, endDate);

  const rapidApiKey = clean(readOptionalEnv("RAPIDAPI_KEY")) || requireEnv("RAPIDAPI_KEY");
  const dateLiterals = listDates(startDate, endDate);
  const normalizedRows = [];
  let requestsCompleted = 0;
  let lastCompletedDate = null;
  let nextResumeDate = dateLiterals[0] || null;

  for (const dateLiteral of dateLiterals) {
    if (requestsCompleted >= maxRequests) {
      break;
    }

    const payload = await fetchDailyCalendarWithRetry(dateLiteral, {
      currency,
      host,
      maxRetries,
      rapidApiKey,
      retryDelayMs,
      timeFormat,
      timezone
    });
    requestsCompleted += 1;
    lastCompletedDate = dateLiteral;
    normalizedRows.push(...normalizeDailyPayload(dateLiteral, payload, {
      currency,
      timezone
    }));

    const currentIndex = dateLiterals.indexOf(dateLiteral);
    nextResumeDate = dateLiterals[currentIndex + 1] || null;

    if (requestsCompleted < maxRequests && nextResumeDate) {
      await sleep(delayMs);
    }
  }

  const budgetReached = requestsCompleted >= maxRequests && nextResumeDate !== null;

  if (previewOnly) {
    console.log(JSON.stringify({
      mode: "preview",
      source: "forex_factory_rapidapi",
      requested_dates: dateLiterals.length,
      requests_completed: requestsCompleted,
      request_budget: maxRequests,
      budget_reached: budgetReached,
      last_completed_date: lastCompletedDate,
      next_resume_date: nextResumeDate,
      normalized_rows: normalizedRows.length,
      sample_rows: normalizedRows.slice(0, 5)
    }, null, 2));
    return;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const manifestPayload = {
    manifest_name: manifestName,
    source_type: "api_export",
    vendor_name: "Forex Factory RapidAPI",
    dataset_name: "USD historical economic events",
    asset_scope: "USD",
    coverage_start: startDate,
    coverage_end: endDate,
    frequency: "event",
    import_mode: "historical_backfill",
    schema_version: DEFAULT_SCHEMA_VERSION,
    normalization_version: DEFAULT_NORMALIZATION_VERSION,
    source_uri: DEFAULT_SOURCE_URI,
    metadata: {
      importer: "backtester/importers/usd_events/import_usd_events.js",
      currency,
      host,
      timezone,
      time_format: timeFormat,
      requested_dates: dateLiterals.length,
      requests_completed: requestsCompleted,
      request_budget: maxRequests,
      budget_reached: budgetReached,
      last_completed_date: lastCompletedDate,
      next_resume_date: nextResumeDate,
      delay_ms: delayMs,
      max_retries: maxRetries,
      retry_delay_ms: retryDelayMs,
      last_imported_at: new Date().toISOString()
    }
  };

  const manifest = await ensureManifest(
    supabaseUrl,
    serviceRoleKey,
    {
      manifestName,
      vendorName: "Forex Factory RapidAPI",
      assetScope: "USD"
    },
    manifestPayload
  );

  const rows = attachManifest(normalizedRows, manifest.id);
  const submitted = await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_economic_events",
    rows,
    ["event_name", "event_time", "currency", "source_manifest_id"]
  );

  await ensureManifest(
    supabaseUrl,
    serviceRoleKey,
    {
      manifestName,
      vendorName: "Forex Factory RapidAPI",
      assetScope: "USD"
    },
    {
      ...manifestPayload,
      row_count: rows.length,
      coverage_start: minDate(rows.map((row) => row.event_date)) || startDate,
      coverage_end: maxDate(rows.map((row) => row.event_date)) || endDate,
      metadata: {
        ...manifestPayload.metadata,
        normalized_rows: rows.length,
        submitted_rows: submitted
      }
    }
  );

  console.log(JSON.stringify({
    manifest: manifestName,
    requested_dates: dateLiterals.length,
    requests_completed: requestsCompleted,
    request_budget: maxRequests,
    budget_reached: budgetReached,
    last_completed_date: lastCompletedDate,
    next_resume_date: nextResumeDate,
    normalized_rows: rows.length,
    submitted_rows: submitted,
    coverage_start: minDate(rows.map((row) => row.event_date)) || startDate,
    coverage_end: maxDate(rows.map((row) => row.event_date)) || endDate
  }, null, 2));
}

module.exports = {
  attachManifest,
  buildDailyUrl,
  classifySurprise,
  currencySignal,
  eventCategory,
  listDates,
  normalizeDailyPayload,
  normalizeEventKey,
  normalizeName,
  normalizeTimeText,
  parseNumericValue,
  parseRapidApiKey,
  run,
  toUtcIso
};

if (require.main === module) {
  run().catch((error) => {
    console.error("USD historical economic events import failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
