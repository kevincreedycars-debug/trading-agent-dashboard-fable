#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../../lib/historical_common");

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, "../../tmp/btcusd_daily_coinbase.csv");
const DEFAULT_START = "2023-11-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const PRODUCT_ID = "BTC-USD";
const GRANULARITY_SECONDS = 86400;
const MAX_DAYS_PER_REQUEST = 300;

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
}

function toIsoStart(dateString) {
  return `${dateString}T00:00:00Z`;
}

function addDays(dateString, days) {
  const cursor = new Date(`${dateString}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

async function fetchChunk(startDate, endDate) {
  const url = new URL(`https://api.exchange.coinbase.com/products/${PRODUCT_ID}/candles`);
  url.searchParams.set("granularity", String(GRANULARITY_SECONDS));
  url.searchParams.set("start", toIsoStart(startDate));
  url.searchParams.set("end", toIsoStart(endDate));

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}\n${body}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Coinbase returned a non-array payload for ${url}`);
  }

  return payload.map((row) => ({
    date: new Date(Number(row[0]) * 1000).toISOString().slice(0, 10),
    low: Number(row[1]),
    high: Number(row[2]),
    open: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  }));
}

function quoteCsv(value) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function toCsv(rows) {
  const header = ["date", "open", "high", "low", "close", "volume", "adjusted_close", "source_symbol"];
  const body = rows.map((row) => [
    row.date,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    "",
    PRODUCT_ID
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

  const byDate = new Map();
  let cursor = startDate;

  while (cursor <= endDate) {
    const chunkEndExclusive = addDays(cursor, MAX_DAYS_PER_REQUEST);
    const requestEnd = chunkEndExclusive <= endDate ? chunkEndExclusive : addDays(endDate, 1);
    const rows = await fetchChunk(cursor, requestEnd);

    rows.forEach((row) => {
      if (
        row.date >= startDate
        && row.date <= endDate
        && Number.isFinite(row.open)
        && Number.isFinite(row.high)
        && Number.isFinite(row.low)
        && Number.isFinite(row.close)
      ) {
        byDate.set(row.date, row);
      }
    });

    cursor = chunkEndExclusive;
  }

  const rows = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) {
    throw new Error("No BTC/USD OHLC rows were returned for the requested date range.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCsv(rows), "utf8");

  console.log(JSON.stringify({
    status: "PASS",
    source: "Coinbase Exchange candles",
    product_id: PRODUCT_ID,
    output_path: outputPath,
    coverage_start: rows[0].date,
    coverage_end: rows[rows.length - 1].date,
    row_count: rows.length
  }, null, 2));
}

main().catch((error) => {
  console.error("BTC/USD OHLC download failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
