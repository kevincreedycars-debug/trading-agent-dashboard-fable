#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs, requireEnv, readOptionalEnv } = require("../../lib/historical_common");

const DEFAULT_START = "2023-11-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const DEFAULT_INSTRUMENTS = ["EUR_USD", "XAU_USD", "NAS100_USD"];
const OUTPUT_DIR = path.resolve(__dirname, "../../cache/ohlc");
const MAX_CANDLES_PER_REQUEST = 5000;
const DAY_MS = 86400000;
// H1 chunks stay well under the 5000-candle response cap (180d * 24h = 4320).
const GRANULARITIES = {
  D: { chunkDays: 2000, fileTag: "daily" },
  H1: { chunkDays: 180, fileTag: "h1" }
};

const HOSTS = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com"
};

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
}

function resolveHost(args) {
  const env = String(args.env || readOptionalEnv("OANDA_ENV", "practice")).toLowerCase();
  if (!HOSTS[env]) {
    throw new Error(`Unknown OANDA env "${env}". Use practice or live.`);
  }
  return { env, host: HOSTS[env] };
}

async function oandaGet(host, token, pathname, searchParams = {}) {
  const url = new URL(`${host}${pathname}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Datetime-Format": "RFC3339"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url.pathname}\n${body}`);
  }

  return response.json();
}

async function listInstruments(host, token, accountIdArg) {
  let accountId = accountIdArg || readOptionalEnv("OANDA_ACCOUNT_ID");
  if (!accountId) {
    const accounts = await oandaGet(host, token, "/v3/accounts");
    accountId = accounts?.accounts?.[0]?.id;
    if (!accountId) {
      throw new Error("No OANDA accounts were visible for this token.");
    }
  }

  const payload = await oandaGet(host, token, `/v3/accounts/${accountId}/instruments`);
  const instruments = (payload?.instruments || [])
    .map((item) => ({ name: item.name, displayName: item.displayName, type: item.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(JSON.stringify({
    status: "PASS",
    account_id: accountId,
    instrument_count: instruments.length,
    instruments
  }, null, 2));
}

// Daily candle alignment:
// - "utc" (default): dailyAlignment=0 / UTC. Each candle covers one UTC calendar
//   day and is labeled with that date, matching the Binance cache and the
//   checker artifacts' calendar-date convention.
// - "ny17": dailyAlignment=17 / America/New_York (the FX platform session day).
//   The candle opening at 17:00 NY is labeled with the NEXT calendar date,
//   because that session's trading day (and close) belongs to the next day.
function alignmentParams(alignment) {
  if (alignment === "ny17") {
    return { dailyAlignment: 17, alignmentTimezone: "America/New_York" };
  }
  return { dailyAlignment: 0, alignmentTimezone: "UTC" };
}

function labelDate(candleTimeIso, alignment) {
  const openMs = Date.parse(candleTimeIso);
  if (alignment === "ny17") {
    return new Date(openMs + DAY_MS).toISOString().slice(0, 10);
  }
  return new Date(openMs).toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const cursor = new Date(`${dateString}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

async function downloadInstrument(host, token, instrument, startDate, endDate, alignment, granularity) {
  const chunkDays = GRANULARITIES[granularity].chunkDays;
  const byKey = new Map();
  let cursor = startDate;

  while (cursor <= endDate) {
    const chunkEnd = addDays(cursor, chunkDays) < endDate ? addDays(cursor, chunkDays) : endDate;
    // OANDA rejects "to" values in the future, so cap the final chunk at now.
    const toMs = Math.min(Date.parse(`${addDays(chunkEnd, 1)}T00:00:00Z`), Date.now());
    const payload = await oandaGet(host, token, `/v3/instruments/${instrument}/candles`, {
      price: "M",
      granularity,
      from: `${cursor}T00:00:00Z`,
      to: new Date(toMs).toISOString(),
      ...alignmentParams(alignment)
    });

    const candles = payload?.candles || [];
    if (candles.length >= MAX_CANDLES_PER_REQUEST) {
      throw new Error(`OANDA returned ${candles.length} candles for one chunk; narrow the chunk size.`);
    }

    candles.forEach((candle) => {
      const time = new Date(Date.parse(candle.time)).toISOString();
      const date = granularity === "D" ? labelDate(candle.time, alignment) : time.slice(0, 10);
      const row = {
        time,
        date,
        open: Number(candle?.mid?.o),
        high: Number(candle?.mid?.h),
        low: Number(candle?.mid?.l),
        close: Number(candle?.mid?.c),
        volume: Number(candle?.volume),
        complete: Boolean(candle?.complete)
      };
      if (
        date >= startDate
        && date <= endDate
        && Number.isFinite(row.open)
        && Number.isFinite(row.high)
        && Number.isFinite(row.low)
        && Number.isFinite(row.close)
      ) {
        byKey.set(granularity === "D" ? date : time, row);
      }
    });

    cursor = addDays(chunkEnd, 1);
  }

  return Array.from(byKey.values()).sort((a, b) => (a.time || a.date).localeCompare(b.time || b.date));
}

function quoteCsv(value) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function toCsv(instrument, alignment, granularity, rows) {
  const includeTime = granularity !== "D";
  const header = ["instrument", ...(includeTime ? ["time"] : []), "date", "open", "high", "low", "close", "volume", "source", "complete"];
  const body = rows.map((row) => [
    instrument,
    ...(includeTime ? [row.time] : []),
    row.date,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    `oanda_v20_mid_${granularity.toLowerCase()}_${alignment}`,
    row.complete ? "true" : "false"
  ].map(quoteCsv).join(","));
  return `${header.map(quoteCsv).join(",")}\n${body.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = requireEnv("OANDA_API_TOKEN");
  const { env, host } = resolveHost(args);

  if (args["list-instruments"] === "true") {
    await listInstruments(host, token, args.account);
    return;
  }

  const startDate = args.start || DEFAULT_START;
  const endDate = args.end || DEFAULT_END;
  const alignment = String(args.alignment || "utc").toLowerCase();
  if (!["utc", "ny17"].includes(alignment)) {
    throw new Error(`Unknown alignment "${alignment}". Use utc or ny17.`);
  }
  const granularity = String(args.granularity || "D").toUpperCase();
  if (!GRANULARITIES[granularity]) {
    throw new Error(`Unknown granularity "${granularity}". Use D or H1.`);
  }
  if (granularity !== "D" && alignment !== "utc") {
    throw new Error("Intraday granularities support only --alignment=utc.");
  }

  assertDate(startDate, "start");
  assertDate(endDate, "end");

  const instruments = args.instrument
    ? String(args.instrument).split(",").map((item) => item.trim()).filter(Boolean)
    : DEFAULT_INSTRUMENTS;

  const results = [];
  for (const instrument of instruments) {
    const rows = await downloadInstrument(host, token, instrument, startDate, endDate, alignment, granularity);
    if (!rows.length) {
      throw new Error(`No ${instrument} ${granularity} candles were returned for the requested range.`);
    }

    const outputPath = path.resolve(OUTPUT_DIR, `${instrument.toLowerCase()}_${GRANULARITIES[granularity].fileTag}_oanda.csv`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, toCsv(instrument, alignment, granularity, rows), "utf8");

    results.push({
      instrument,
      output_path: outputPath,
      coverage_start: rows[0].date,
      coverage_end: rows[rows.length - 1].date,
      row_count: rows.length,
      incomplete_rows: rows.filter((row) => !row.complete).length
    });
  }

  console.log(JSON.stringify({
    status: "PASS",
    source: `OANDA v20 GET /v3/instruments/{instrument}/candles (mid, granularity ${granularity})`,
    oanda_env: env,
    alignment,
    granularity,
    results
  }, null, 2));
}

main().catch((error) => {
  console.error("OANDA daily OHLC download failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
