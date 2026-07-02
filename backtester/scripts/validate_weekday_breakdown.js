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

function createTotals() {
  return {
    total: 0,
    wins: 0,
    losses: 0,
    flats: 0
  };
}

function buildCounts(keys) {
  return Object.fromEntries(keys.map(key => [key, createTotals()]));
}

function addRowToTotals(target, result) {
  target.total += 1;
  if (result === "CORRECT") {
    target.wins += 1;
  } else if (result === "WRONG") {
    target.losses += 1;
  } else {
    target.flats += 1;
  }
}

function sumTotals(collection) {
  return Object.values(collection).reduce((aggregate, item) => {
    aggregate.total += item.total;
    aggregate.wins += item.wins;
    aggregate.losses += item.losses;
    aggregate.flats += item.flats;
    return aggregate;
  }, createTotals());
}

function exFlatWinRate(totals) {
  const directionalTotal = totals.wins + totals.losses;
  return directionalTotal ? totals.wins / directionalTotal : null;
}

function validateTotalsShape(label, totals, errors) {
  if (totals.wins + totals.losses + totals.flats !== totals.total) {
    errors.push(`${label}: wins + losses + flats did not equal total`);
  }

  const rate = exFlatWinRate(totals);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
    errors.push(`${label}: ex-flat directional win rate was out of range`);
  }
}

function validateAsset(config) {
  const payload = JSON.parse(fs.readFileSync(config.input, "utf8"));
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const summaryRowsChecked = Number(payload?.summary?.rows_checked || 0);
  const weekdayCounts = buildCounts(config.weekdays);
  const bucketCounts = buildCounts(BUCKETS.map(bucket => bucket.key));
  const cellCounts = {};
  const errors = [];

  BUCKETS.forEach(bucket => {
    cellCounts[bucket.key] = buildCounts(config.weekdays);
  });

  rows.forEach((row, index) => {
    const weekday = weekdayFromSnapshotDate(row?.snapshot_date);
    const confidence = normalizeHeadlineConfidence(row);
    const bucketKey = bucketKeyFromConfidence(confidence);
    const result = String(row?.stored?.evaluation_result || row?.checker?.evaluation_result || "").trim().toUpperCase();

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

    addRowToTotals(weekdayCounts[weekday], result);
    addRowToTotals(bucketCounts[bucketKey], result);
    addRowToTotals(cellCounts[bucketKey][weekday], result);
  });

  Object.entries(weekdayCounts).forEach(([weekday, totals]) => {
    validateTotalsShape(`weekday ${weekday}`, totals, errors);
  });

  Object.entries(bucketCounts).forEach(([bucket, totals]) => {
    validateTotalsShape(`bucket ${bucket}`, totals, errors);
  });

  Object.entries(cellCounts).forEach(([bucket, weekdayMap]) => {
    Object.entries(weekdayMap).forEach(([weekday, totals]) => {
      validateTotalsShape(`cell ${bucket}/${weekday}`, totals, errors);
    });
  });

  const weekdayRollup = sumTotals(weekdayCounts);
  const bucketRollup = sumTotals(bucketCounts);

  if (rows.length !== config.expectedRows) {
    errors.push(`artifact row count ${rows.length} did not match expected ${config.expectedRows}`);
  }
  if (summaryRowsChecked !== config.expectedRows) {
    errors.push(`summary rows_checked ${summaryRowsChecked} did not match expected ${config.expectedRows}`);
  }
  if (weekdayRollup.total !== config.expectedRows) {
    errors.push(`weekday total ${weekdayRollup.total} did not match expected ${config.expectedRows}`);
  }
  if (bucketRollup.total !== config.expectedRows) {
    errors.push(`bucket total ${bucketRollup.total} did not match expected ${config.expectedRows}`);
  }

  validateTotalsShape("asset total", weekdayRollup, errors);
  if (bucketRollup.total !== weekdayRollup.total || bucketRollup.wins !== weekdayRollup.wins || bucketRollup.losses !== weekdayRollup.losses || bucketRollup.flats !== weekdayRollup.flats) {
    errors.push("bucket rollup did not match weekday rollup");
  }

  const weekendRows = (weekdayCounts.SATURDAY?.total || 0) + (weekdayCounts.SUNDAY?.total || 0);
  if (config.code === "BTC" && !weekendRows) {
    errors.push("BTC weekday totals did not include any weekend rows");
  }
  if (config.code !== "BTC" && weekendRows) {
    errors.push(`${config.code} unexpectedly included weekend rows`);
  }

  return {
    asset: config.code,
    input: config.input,
    expected_rows: config.expectedRows,
    rows_in_artifact: rows.length,
    summary_rows_checked: summaryRowsChecked,
    weekday_total: weekdayRollup.total,
    bucket_total: bucketRollup.total,
    weekday_counts: weekdayCounts,
    bucket_counts: bucketCounts,
    total_wins: weekdayRollup.wins,
    total_losses: weekdayRollup.losses,
    total_flats: weekdayRollup.flats,
    total_rows: weekdayRollup.total,
    flat_rate_pct: weekdayRollup.total ? Number(((weekdayRollup.flats / weekdayRollup.total) * 100).toFixed(1)) : null,
    ex_flat_directional_win_rate_pct: exFlatWinRate(weekdayRollup) !== null ? Number((exFlatWinRate(weekdayRollup) * 100).toFixed(1)) : null,
    weekend_rows: weekendRows,
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
