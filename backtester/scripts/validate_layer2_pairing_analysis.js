#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../lib/historical_common");

const WEEKDAY_KEYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const CONFIDENCE_BUCKETS = [
  { key: "WEAK", min: 0, max: 49 },
  { key: "MODERATE", min: 50, max: 64 },
  { key: "STRONG", min: 65, max: 79 },
  { key: "VERY_STRONG", min: 80, max: 100 }
];
const CHECKER_PATHS = {
  USD: path.resolve(__dirname, "../../data/backtester-checker-usd-24h-2024-01.json"),
  EUR: path.resolve(__dirname, "../../data/backtester-checker-eur-24h-2024-2026.json"),
  GOLD: path.resolve(__dirname, "../../data/backtester-checker-gold-24h-2024-2026.json"),
  NQ: path.resolve(__dirname, "../../data/backtester-checker-nq-24h-2024-2026.json"),
  BTC: path.resolve(__dirname, "../../data/backtester-checker-btc-24h-2024-2026.json")
};
const PAIR_CONFIGS = [
  { targetAssetCode: "EUR", pairCode: "EUR_USD", pairLabel: "EUR/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "GOLD", pairCode: "XAU_USD", pairLabel: "XAU/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "NQ", pairCode: "NQ_USD", pairLabel: "NQ/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "BTC", pairCode: "BTC_USD", pairLabel: "BTC/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] }
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
  return CONFIDENCE_BUCKETS.find(bucket => clamped >= bucket.min && clamped <= bucket.max)?.key || null;
}

function weekdayFromSnapshotDate(snapshotDate) {
  const value = String(snapshotDate || "").trim();
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return WEEKDAY_KEYS[parsed.getUTCDay()] || null;
}

function normalizeDirectionalSignalKey(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "BULLISH" || normalized === "BEARISH") return normalized;
  return null;
}

function createTotals() {
  return { total: 0, wins: 0, losses: 0, flats: 0 };
}

function addOutcome(target, outcomeKey) {
  target.total += 1;
  if (outcomeKey === "WIN") target.wins += 1;
  else if (outcomeKey === "LOSS") target.losses += 1;
  else target.flats += 1;
}

function totalsFromCollection(collection) {
  return Object.values(collection).reduce((aggregate, totals) => {
    aggregate.total += totals.total;
    aggregate.wins += totals.wins;
    aggregate.losses += totals.losses;
    aggregate.flats += totals.flats;
    return aggregate;
  }, createTotals());
}

function totalsFromList(list = []) {
  return list.reduce((aggregate, totals) => {
    aggregate.total += totals?.total || 0;
    aggregate.wins += totals?.wins || 0;
    aggregate.losses += totals?.losses || 0;
    aggregate.flats += totals?.flats || 0;
    return aggregate;
  }, createTotals());
}

function totalsEqual(left, right) {
  return left.total === right.total
    && left.wins === right.wins
    && left.losses === right.losses
    && left.flats === right.flats;
}

function roundPct(value) {
  if (!Number.isFinite(value)) return null;
  return Number((value * 100).toFixed(1));
}

function validateRateShape(label, totals, errors) {
  if (totals.wins + totals.losses + totals.flats !== totals.total) {
    errors.push(`${label}: wins + losses + flats did not equal total`);
  }
  const flatRate = totals.total ? totals.flats / totals.total : null;
  if (flatRate !== null && (!Number.isFinite(flatRate) || flatRate < 0 || flatRate > 1)) {
    errors.push(`${label}: flat rate was out of range`);
  }
  const directionalTotal = totals.wins + totals.losses;
  const exFlatRate = directionalTotal ? totals.wins / directionalTotal : null;
  if (exFlatRate !== null && (!Number.isFinite(exFlatRate) || exFlatRate < 0 || exFlatRate > 1)) {
    errors.push(`${label}: ex-flat rate was out of range`);
  }
}

function rowsByDate(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row?.snapshot_date || "").trim();
    if (key && !map.has(key)) map.set(key, row);
  });
  return map;
}

function pairOutcomeKey(targetRow) {
  const result = String(targetRow?.stored?.evaluation_result || targetRow?.checker?.evaluation_result || "").trim().toUpperCase();
  if (result === "CORRECT") return "WIN";
  if (result === "WRONG") return "LOSS";
  return "FLAT";
}

function validatePair(config, checkers) {
  const targetRows = Array.isArray(checkers[config.targetAssetCode]?.rows) ? checkers[config.targetAssetCode].rows : [];
  const usdRows = Array.isArray(checkers.USD?.rows) ? checkers.USD.rows : [];
  const usdByDate = rowsByDate(usdRows);
  const errors = [];
  const dayTotals = Object.fromEntries(config.weekdayKeys.map((weekday) => [weekday, createTotals()]));
  const bucketTotals = Object.fromEntries(CONFIDENCE_BUCKETS.map((bucket) => [bucket.key, createTotals()]));
  const matrix = Object.fromEntries(CONFIDENCE_BUCKETS.map((bucket) => [bucket.key, Object.fromEntries(config.weekdayKeys.map((weekday) => [weekday, createTotals()]))]));
  const noTradeReasonCounts = {};

  let tradableCount = 0;
  let missingUsdCount = 0;
  let noTradeCount = 0;

  targetRows.forEach((targetRow, index) => {
    const snapshotDate = String(targetRow?.snapshot_date || "").trim();
    const usdRow = usdByDate.get(snapshotDate) || null;
    const weekdayKey = weekdayFromSnapshotDate(snapshotDate);
    const targetDirection = normalizeDirectionalSignalKey(targetRow?.stored?.direction || targetRow?.checker?.direction || "");
    const usdDirection = normalizeDirectionalSignalKey(usdRow?.stored?.direction || usdRow?.checker?.direction || "");
    const targetConfidence = normalizeHeadlineConfidence(targetRow);
    const usdConfidence = normalizeHeadlineConfidence(usdRow);
    const combinedConfidence = Number.isFinite(targetConfidence) && Number.isFinite(usdConfidence)
      ? Math.min(targetConfidence, usdConfidence)
      : null;
    const bucketKey = bucketKeyFromConfidence(combinedConfidence);

    let noTradeReason = null;
    if (!usdRow) {
      noTradeReason = "missing_usd_snapshot";
      missingUsdCount += 1;
    } else if (!targetDirection) {
      noTradeReason = "unsupported_target_direction";
    } else if (!usdDirection) {
      noTradeReason = "unsupported_usd_direction";
    } else if (!Number.isFinite(combinedConfidence)) {
      noTradeReason = "missing_combined_confidence";
    } else if (!bucketKey || !matrix[bucketKey]) {
      noTradeReason = "unsupported_confidence_bucket";
    } else if (targetDirection === usdDirection) {
      noTradeReason = "same_direction_conflict";
    }

    if (noTradeReason) {
      noTradeCount += 1;
      noTradeReasonCounts[noTradeReason] = (noTradeReasonCounts[noTradeReason] || 0) + 1;
      return;
    }

    if (!weekdayKey || !dayTotals[weekdayKey]) {
      errors.push(`row ${index + 1}: tradable pair row resolved to unsupported weekday ${weekdayKey || "(blank)"}`);
      return;
    }

    const outcomeKey = pairOutcomeKey(targetRow);
    addOutcome(dayTotals[weekdayKey], outcomeKey);
    addOutcome(bucketTotals[bucketKey], outcomeKey);
    addOutcome(matrix[bucketKey][weekdayKey], outcomeKey);
    tradableCount += 1;
  });

  Object.entries(dayTotals).forEach(([weekday, totals]) => {
    validateRateShape(`day ${weekday}`, totals, errors);
  });
  Object.entries(bucketTotals).forEach(([bucket, totals]) => {
    validateRateShape(`bucket ${bucket}`, totals, errors);
  });
  Object.entries(matrix).forEach(([bucket, weekdayMap]) => {
    Object.entries(weekdayMap).forEach(([weekday, totals]) => {
      validateRateShape(`cell ${bucket}/${weekday}`, totals, errors);
    });
  });

  config.weekdayKeys.forEach((weekday) => {
    const summedBucketDay = CONFIDENCE_BUCKETS.reduce((aggregate, bucket) => {
      const totals = matrix[bucket.key][weekday];
      aggregate.total += totals.total;
      aggregate.wins += totals.wins;
      aggregate.losses += totals.losses;
      aggregate.flats += totals.flats;
      return aggregate;
    }, createTotals());
    const day = dayTotals[weekday];
    if (
      summedBucketDay.total !== day.total
      || summedBucketDay.wins !== day.wins
      || summedBucketDay.losses !== day.losses
      || summedBucketDay.flats !== day.flats
    ) {
      errors.push(`weekday ${weekday}: day totals did not equal the sum of all bucket rows`);
    }
  });

  const dayRollup = totalsFromCollection(dayTotals);
  const bucketRollup = totalsFromCollection(bucketTotals);
  const strongPlusRollup = totalsFromList([
    bucketTotals.STRONG,
    bucketTotals.VERY_STRONG
  ]);
  const coveragePct = targetRows.length ? roundPct(tradableCount / targetRows.length) : null;
  const strongPlusCoveragePct = targetRows.length ? roundPct(strongPlusRollup.total / targetRows.length) : null;
  const pairSummary = {
    paired_rows: targetRows.length,
    tradable_signals: tradableCount,
    coverage_pct: coveragePct,
    all_signal_totals: dayRollup,
    strong_plus_signals: strongPlusRollup.total,
    strong_plus_coverage_pct: strongPlusCoveragePct,
    strong_plus_totals: strongPlusRollup,
    strong_plus_ex_flat_directional_win_rate_pct: (strongPlusRollup.wins + strongPlusRollup.losses)
      ? roundPct(strongPlusRollup.wins / (strongPlusRollup.wins + strongPlusRollup.losses))
      : null,
    strong_plus_flat_rate_pct: strongPlusRollup.total
      ? roundPct(strongPlusRollup.flats / strongPlusRollup.total)
      : null
  };

  validateRateShape("pair total", dayRollup, errors);
  validateRateShape("strong+ total", strongPlusRollup, errors);
  if (
    dayRollup.total !== bucketRollup.total
    || dayRollup.wins !== bucketRollup.wins
    || dayRollup.losses !== bucketRollup.losses
    || dayRollup.flats !== bucketRollup.flats
  ) {
    errors.push("day totals did not match bucket totals");
  }
  if (dayRollup.total !== tradableCount) {
    errors.push(`tradable rollup ${dayRollup.total} did not match tradable count ${tradableCount}`);
  }
  if (pairSummary.tradable_signals !== pairSummary.all_signal_totals.total) {
    errors.push("pair summary tradable signals did not match detailed tradable totals");
  }
  if (!totalsEqual(pairSummary.all_signal_totals, dayRollup)) {
    errors.push("pair summary all-signal totals did not reconcile to day totals");
  }
  if (!totalsEqual(pairSummary.strong_plus_totals, strongPlusRollup)) {
    errors.push("pair summary Strong+ totals did not reconcile to Strong + Very Strong bucket totals");
  }
  if (pairSummary.coverage_pct !== (pairSummary.paired_rows ? roundPct(pairSummary.tradable_signals / pairSummary.paired_rows) : null)) {
    errors.push("coverage % did not equal tradable signals divided by paired rows");
  }
  if (pairSummary.strong_plus_coverage_pct !== (pairSummary.paired_rows ? roundPct(pairSummary.strong_plus_signals / pairSummary.paired_rows) : null)) {
    errors.push("Strong+ coverage % did not equal Strong+ tradable signals divided by paired rows");
  }
  if (pairSummary.strong_plus_ex_flat_directional_win_rate_pct !== (
    (pairSummary.strong_plus_totals.wins + pairSummary.strong_plus_totals.losses)
      ? roundPct(pairSummary.strong_plus_totals.wins / (pairSummary.strong_plus_totals.wins + pairSummary.strong_plus_totals.losses))
      : null
  )) {
    errors.push("Strong+ ex-flat directional win rate did not exclude flats");
  }
  if (pairSummary.strong_plus_flat_rate_pct !== (
    pairSummary.strong_plus_totals.total
      ? roundPct(pairSummary.strong_plus_totals.flats / pairSummary.strong_plus_totals.total)
      : null
  )) {
    errors.push("Strong+ flat rate did not equal flats divided by total");
  }
  if (targetRows.length !== tradableCount + noTradeCount) {
    errors.push(`target rows ${targetRows.length} did not equal tradable + no-trade (${tradableCount + noTradeCount})`);
  }
  if (config.targetAssetCode === "BTC" && !config.weekdayKeys.includes("SATURDAY") && !config.weekdayKeys.includes("SUNDAY")) {
    errors.push("BTC pair config did not include Saturday/Sunday columns");
  }
  if (config.targetAssetCode !== "BTC" && (config.weekdayKeys.includes("SATURDAY") || config.weekdayKeys.includes("SUNDAY"))) {
    errors.push(`${config.targetAssetCode} pair config unexpectedly included weekend columns`);
  }

  return {
    pair: config.pairLabel,
    target_asset: config.targetAssetCode,
    target_rows: targetRows.length,
    usd_rows: usdRows.length,
    tradable_rows: tradableCount,
    no_trade_rows: noTradeCount,
    missing_usd_rows: missingUsdCount,
    day_totals: dayTotals,
    bucket_totals: bucketTotals,
    total_wins: dayRollup.wins,
    total_losses: dayRollup.losses,
    total_flats: dayRollup.flats,
    total_rows: dayRollup.total,
    flat_rate_pct: dayRollup.total ? Number(((dayRollup.flats / dayRollup.total) * 100).toFixed(1)) : null,
    ex_flat_directional_win_rate_pct: (dayRollup.wins + dayRollup.losses) ? Number(((dayRollup.wins / (dayRollup.wins + dayRollup.losses)) * 100).toFixed(1)) : null,
    pair_summary: pairSummary,
    no_trade_reason_counts: noTradeReasonCounts,
    status: errors.length ? "FAIL" : "PASS",
    errors
  };
}

function main() {
  parseArgs(process.argv.slice(2));
  const checkers = Object.fromEntries(Object.entries(CHECKER_PATHS).map(([key, filePath]) => [key, JSON.parse(fs.readFileSync(filePath, "utf8"))]));
  const results = PAIR_CONFIGS.map((config) => validatePair(config, checkers));
  const failed = results.filter(result => result.status !== "PASS");

  console.log(JSON.stringify({
    status: failed.length ? "FAIL" : "PASS",
    pairs: results
  }, null, 2));

  if (failed.length) {
    process.exitCode = 1;
  }
}

main();
