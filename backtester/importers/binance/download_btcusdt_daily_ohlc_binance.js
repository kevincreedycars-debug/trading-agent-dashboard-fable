#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../../lib/historical_common");

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, "../../cache/ohlc/btcusdt_daily_binance.csv");
const DEFAULT_START = "2023-11-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const SYMBOL = "BTCUSDT";
const INTERVAL = "1d";
const MAX_LIMIT = 1000;
const DAY_MS = 86400000;
const SOURCE_LABEL = "binance_spot_klines";

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
}

function toEpochMs(dateString) {
  return Date.parse(`${dateString}T00:00:00Z`);
}

async function fetchKlines(startTimeMs, endTimeMs) {
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", SYMBOL);
  url.searchParams.set("interval", INTERVAL);
  url.searchParams.set("startTime", String(startTimeMs));
  url.searchParams.set("endTime", String(endTimeMs));
  url.searchParams.set("limit", String(MAX_LIMIT));

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}\n${body}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Binance returned a non-array payload for ${url}`);
  }

  return payload.map((row) => ({
    openTimeMs: Number(row[0]),
    date: new Date(Number(row[0])).toISOString().slice(0, 10),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTimeMs: Number(row[6])
  }));
}

function quoteCsv(value) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function toCsv(rows) {
  const header = ["instrument", "date", "open", "high", "low", "close", "volume", "source", "complete"];
  const body = rows.map((row) => [
    SYMBOL,
    row.date,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    SOURCE_LABEL,
    row.complete ? "true" : "false"
  ].map(quoteCsv).join(","));
  return `${header.map(quoteCsv).join(",")}\n${body.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || DEFAULT_START;
  const endDate = args.end || DEFAULT_END;
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);

  assertDate(startDate, "start");
  assertDate(endDate, "end");

  const endTimeMs = toEpochMs(endDate) + DAY_MS - 1;
  const nowMs = Date.now();
  const byDate = new Map();
  let cursorMs = toEpochMs(startDate);
  let requestCount = 0;

  while (cursorMs <= endTimeMs) {
    requestCount += 1;
    if (requestCount > 100) {
      throw new Error("Aborting: kline pagination exceeded 100 requests.");
    }

    const rows = await fetchKlines(cursorMs, endTimeMs);
    if (!rows.length) break;

    rows.forEach((row) => {
      if (
        row.date >= startDate
        && row.date <= endDate
        && Number.isFinite(row.open)
        && Number.isFinite(row.high)
        && Number.isFinite(row.low)
        && Number.isFinite(row.close)
      ) {
        byDate.set(row.date, { ...row, complete: row.closeTimeMs < nowMs });
      }
    });

    const lastOpenTimeMs = rows[rows.length - 1].openTimeMs;
    if (rows.length < MAX_LIMIT) break;
    cursorMs = lastOpenTimeMs + DAY_MS;
  }

  const rows = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) {
    throw new Error("No BTCUSDT klines were returned for the requested date range.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCsv(rows), "utf8");

  console.log(JSON.stringify({
    status: "PASS",
    source: "Binance Spot GET /api/v3/klines",
    symbol: SYMBOL,
    interval: INTERVAL,
    output_path: outputPath,
    coverage_start: rows[0].date,
    coverage_end: rows[rows.length - 1].date,
    row_count: rows.length,
    incomplete_rows: rows.filter((row) => !row.complete).length,
    requests_made: requestCount
  }, null, 2));
}

main().catch((error) => {
  console.error("BTCUSDT daily kline download failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
