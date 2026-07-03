#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../../lib/historical_common");

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, "../../tmp/eurusd_daily_alpha_vantage.csv");
const DEFAULT_START = "2023-11-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const DEFAULT_API_KEY = "demo";
const SOURCE_URL = "https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=EUR&to_symbol=USD&outputsize=full&apikey=demo";

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function buildUrl(apiKey) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "FX_DAILY");
  url.searchParams.set("from_symbol", "EUR");
  url.searchParams.set("to_symbol", "USD");
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

function quoteCsv(value) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function normalizeRows(payload, startDate, endDate) {
  const series = payload?.["Time Series FX (Daily)"];
  if (!series || typeof series !== "object") {
    throw new Error("Alpha Vantage response did not include daily FX OHLC data.");
  }

  return Object.entries(series)
    .map(([date, row]) => ({
      date,
      open: Number(row?.["1. open"]),
      high: Number(row?.["2. high"]),
      low: Number(row?.["3. low"]),
      close: Number(row?.["4. close"])
    }))
    .filter((row) =>
      row.date >= startDate
      && row.date <= endDate
      && Number.isFinite(row.open)
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && Number.isFinite(row.close)
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function toCsv(rows) {
  const header = ["date", "open", "high", "low", "close", "volume", "adjusted_close", "source_symbol"];
  const body = rows.map((row) => [
    row.date,
    row.open,
    row.high,
    row.low,
    row.close,
    "",
    "",
    "EURUSD"
  ].map(quoteCsv).join(","));
  return `${header.map(quoteCsv).join(",")}\n${body.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || DEFAULT_START;
  const endDate = args.end || DEFAULT_END;
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);
  const apiKey = args["api-key"] || process.env.ALPHA_VANTAGE_API_KEY || DEFAULT_API_KEY;

  assertDate(startDate, "start");
  assertDate(endDate, "end");

  const payload = await fetchJson(buildUrl(apiKey));
  const rows = normalizeRows(payload, startDate, endDate);
  if (!rows.length) {
    throw new Error("No EUR/USD OHLC rows were returned for the requested date range.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCsv(rows), "utf8");

  console.log(JSON.stringify({
    status: "PASS",
    source: "Alpha Vantage FX_DAILY",
    source_url: apiKey === DEFAULT_API_KEY ? SOURCE_URL : buildUrl("[redacted]"),
    output_path: outputPath,
    coverage_start: rows[0].date,
    coverage_end: rows[rows.length - 1].date,
    row_count: rows.length
  }, null, 2));
}

main().catch((error) => {
  console.error("EUR/USD OHLC download failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
