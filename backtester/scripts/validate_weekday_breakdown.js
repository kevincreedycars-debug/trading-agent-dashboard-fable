#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../lib/historical_common");

const ASSET_CONFIG = [
  {
    code: "USD",
    input: path.resolve(__dirname, "../../data/backtester-checker-usd-24h-2024-01.json"),
    expectedRows: 604,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
  },
  {
    code: "EUR",
    input: path.resolve(__dirname, "../../data/backtester-checker-eur-24h-2024-2026.json"),
    expectedRows: 602,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
  },
  {
    code: "GOLD",
    input: path.resolve(__dirname, "../../data/backtester-checker-gold-24h-2024-2026.json"),
    expectedRows: 608,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
  },
  {
    code: "NQ",
    input: path.resolve(__dirname, "../../data/backtester-checker-nq-24h-2024-2026.json"),
    expectedRows: 604,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
  },
  {
    code: "BTC",
    input: path.resolve(__dirname, "../../data/backtester-checker-btc-24h-2024-2026.json"),
    expectedRows: 850,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
  }
];

const WEEKDAY_LABELS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const BUCKETS = [
  { key: "WEAK", min: 0, max: 49 },
  { key: "MODERATE", min: 50, max: 64 },
  { key: "STRONG", min: 65, max: 79 },
  { key: "VERY_STRONG", min: 80, max: 100 }
];

function parseConfidenceCandidate(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeHeadlineConfidence(row) {
  const candidates = [
    row?.stored?.displayed_headline_confidence_pct,
    row?.stored?.headline_confidence_pct,
    row?.checker?.displayed_headline_confidence_pct,
    row?.checker?.headline_confidence_pct
  ];

  for (const candidate of candidates) {
    const numeric = parseConfidenceCandidate(candidate);
    if (!Number.isFinite(numeric)) continue;
    if (numeric >= 0.5 && numeric <= 1) return numeric * 100;
    if (numeric >= 0 && numeric <= 100) return numeric;
  }

  return null;
}

function bucketKeyFromConfidence(confidence) {
  const numeric = Number(confidence);
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.max(0, Math.min(100, numeric));
  return BUCKETS.find(bucket => clamped >= bucket.min && clamped <= bucket.max)?.key || null;
}

function weekdayFromSnapshotDate(snapshotDate) {
  const value = String(snapshotDate || "").trim();
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return WEEKDAY_LABELS[parsed.getUTCDay()] || null;
}

function buildEmptyCounts(keys) {
  return Object.fromEntries(keys.map(key => [key, 0]));
}

function validateAsset(config) {
  const payload = JSON.parse(fs.readFileSync(config.input, "utf8"));
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const summaryRowsChecked = Number(payload?.summary?.rows_checked || 0);
  const weekdayCounts = buildEmptyCounts(config.weekdays);
  const bucketCounts = buildEmptyCounts(BUCKETS.map(bucket => bucket.key));
  const errors = [];

  let totalRows = 0;

  rows.forEach((row, index) => {
    const weekday = weekdayFromSnapshotDate(row?.snapshot_date);
    const confidence = normalizeHeadlineConfidence(row);
    const bucketKey = bucketKeyFromConfidence(confidence);
    if (!weekday) {
      errors.push(`row ${index + 1}: missing weekday from snapshot_date`);
      return;
    }
    if (!config.weekdays.includes(weekday)) {
      errors.push(`row ${index + 1}: unexpected weekday ${weekday}`);
      return;
    }
    if (!Number.isFinite(confidence)) {
      errors.push(`row ${index + 1}: missing displayed headline confidence`);
      return;
    }
    if (!bucketKey) {
      errors.push(`row ${index + 1}: unsupported confidence bucket`);
      return;
    }

    weekdayCounts[weekday] += 1;
    bucketCounts[bucketKey] += 1;
    totalRows += 1;
  });

  const weekdayTotal = Object.values(weekdayCounts).reduce((sum, count) => sum + count, 0);
  const bucketTotal = Object.values(bucketCounts).reduce((sum, count) => sum + count, 0);

  if (rows.length !== config.expectedRows) {
    errors.push(`artifact row count ${rows.length} did not match expected ${config.expectedRows}`);
  }
  if (summaryRowsChecked !== config.expectedRows) {
    errors.push(`summary rows_checked ${summaryRowsChecked} did not match expected ${config.expectedRows}`);
  }
  if (weekdayTotal !== config.expectedRows) {
    errors.push(`weekday total ${weekdayTotal} did not match expected ${config.expectedRows}`);
  }
  if (bucketTotal !== config.expectedRows) {
    errors.push(`bucket total ${bucketTotal} did not match expected ${config.expectedRows}`);
  }
  if (totalRows !== config.expectedRows) {
    errors.push(`validated row total ${totalRows} did not match expected ${config.expectedRows}`);
  }

  const includesWeekend = Boolean((weekdayCounts.SATURDAY || 0) + (weekdayCounts.SUNDAY || 0));
  if (config.code === "BTC" && !includesWeekend) {
    errors.push("BTC weekday totals did not include any weekend rows");
  }
  if (config.code !== "BTC" && includesWeekend) {
    errors.push(`${config.code} unexpectedly included weekend rows`);
  }

  return {
    asset: config.code,
    input: config.input,
    expected_rows: config.expectedRows,
    rows_in_artifact: rows.length,
    summary_rows_checked: summaryRowsChecked,
    weekday_total: weekdayTotal,
    bucket_total: bucketTotal,
    weekday_counts: weekdayCounts,
    bucket_counts: bucketCounts,
    weekend_rows: (weekdayCounts.SATURDAY || 0) + (weekdayCounts.SUNDAY || 0),
    status: errors.length ? "FAIL" : "PASS",
    errors
  };
}

function main() {
  parseArgs(process.argv.slice(2));
  const results = ASSET_CONFIG.map(validateAsset);
  const failed = results.filter(result => result.status !== "PASS");

  console.log(JSON.stringify({
    status: failed.length ? "FAIL" : "PASS",
    assets: results
  }, null, 2));

  if (failed.length) {
    process.exitCode = 1;
  }
}

main();
