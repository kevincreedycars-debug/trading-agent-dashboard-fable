#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs, parseDelimited } = require("../lib/historical_common");

const ADR_WINDOW_SESSIONS = 20;
const ADR_THRESHOLD_PCT = 50;
const WEEKDAY_KEYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const CONFIDENCE_BUCKETS = [
  { key: "WEAK", label: "Weak", min: 0, max: 49 },
  { key: "MODERATE", label: "Moderate", min: 50, max: 64 },
  { key: "STRONG", label: "Strong", min: 65, max: 79 },
  { key: "VERY_STRONG", label: "Very Strong", min: 80, max: 100 }
];
const CHECKER_PATHS = {
  USD: path.resolve(__dirname, "../../data/backtester-checker-usd-24h-2024-01.json"),
  EUR: path.resolve(__dirname, "../../data/backtester-checker-eur-24h-2024-2026.json"),
  GOLD: path.resolve(__dirname, "../../data/backtester-checker-gold-24h-2024-2026.json"),
  NQ: path.resolve(__dirname, "../../data/backtester-checker-nq-24h-2024-2026.json"),
  BTC: path.resolve(__dirname, "../../data/backtester-checker-btc-24h-2024-2026.json")
};
const EXPECTED_CHECKER_ROWS = {
  USD: 604,
  EUR: 602,
  GOLD: 608,
  NQ: 604,
  BTC: 850
};
const ASSET_CONFIGS = [
  {
    assetCode: "EUR",
    assetLabel: "EUR",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.EUR,
    ohlcSourcePath: path.resolve(__dirname, "../tmp/eurusd_daily_alpha_vantage.csv"),
    ohlcSourceLabel: "EUR/USD daily OHLC CSV from Alpha Vantage FX_DAILY",
    status: "available",
    blocker: null
  },
  {
    assetCode: "GOLD",
    assetLabel: "Gold",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.GOLD,
    ohlcSourcePath: null,
    ohlcSourceLabel: "No repo-local XAU/USD OHLC source",
    status: "unavailable",
    blocker: "No supportable unauthenticated XAU/USD spot OHLC feed is staged repo-locally yet. Existing repo evidence is still either close-only spot lineage or GLD proxy data, neither of which is acceptable for ADR reach."
  },
  {
    assetCode: "NQ",
    assetLabel: "NQ",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.NQ,
    ohlcSourcePath: path.resolve(__dirname, "../tmp/qqq_daily_yahoo.csv"),
    ohlcSourceLabel: "QQQ OHLC daily proxy CSV",
    status: "available",
    blocker: null
  },
  {
    assetCode: "BTC",
    assetLabel: "BTC",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    checkerPath: CHECKER_PATHS.BTC,
    ohlcSourcePath: path.resolve(__dirname, "../tmp/btcusd_daily_coinbase.csv"),
    ohlcSourceLabel: "BTC/USD daily OHLC CSV from Coinbase Exchange candles",
    status: "available",
    blocker: null
  },
  {
    assetCode: "USD",
    assetLabel: "USD",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.USD,
    ohlcSourcePath: null,
    ohlcSourceLabel: "No repo-local DXY OHLC source",
    status: "unavailable",
    blocker: "The repo includes only USD checker artifacts and close-to-close research views. No repo-local DXY OHLC export is available, and the raw warehouse table is not readable through the publishable research key."
  }
];
const PAIR_CONFIGS = [
  { targetAssetCode: "EUR", pairCode: "EUR_USD", pairLabel: "EUR/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "GOLD", pairCode: "XAU_USD", pairLabel: "XAU/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "NQ", pairCode: "NQ_USD", pairLabel: "NQ/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "BTC", pairCode: "BTC_USD", pairLabel: "BTC/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] }
];
const OUTPUT_PATH = path.resolve(__dirname, "../../data/adr-reach-research.json");

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

function bucketLabelFromKey(bucketKey) {
  return CONFIDENCE_BUCKETS.find(bucket => bucket.key === bucketKey)?.label || bucketKey;
}

function weekdayFromDate(dateValue) {
  const value = String(dateValue || "").trim();
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return WEEKDAY_KEYS[parsed.getUTCDay()] || null;
}

function createOutcomeCell() {
  return { total: 0, wins: 0, losses: 0 };
}

function addOutcome(cell, outcomeKey) {
  cell.total += 1;
  if (outcomeKey === "WIN") cell.wins += 1;
  else cell.losses += 1;
}

function summarizeOutcomeCell(cell = {}) {
  const total = Number(cell.total || 0);
  const wins = Number(cell.wins || 0);
  const losses = Number(cell.losses || 0);
  return {
    total,
    wins,
    losses,
    winRatePct: total ? Number(((wins / total) * 100).toFixed(1)) : null
  };
}

function sumOutcomeCells(cells = []) {
  return summarizeOutcomeCell(cells.reduce((aggregate, cell) => {
    aggregate.total += Number(cell?.total || 0);
    aggregate.wins += Number(cell?.wins || 0);
    aggregate.losses += Number(cell?.losses || 0);
    return aggregate;
  }, createOutcomeCell()));
}

function buildCellMap(keys = []) {
  return Object.fromEntries(keys.map(key => [key, createOutcomeCell()]));
}

function normalizeLayer1Direction(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized.startsWith("BULLISH")) return "BULLISH";
  if (normalized.startsWith("BEARISH")) return "BEARISH";
  return null;
}

function normalizeExactDirectionalSignal(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "BULLISH" || normalized === "BEARISH") return normalized;
  return null;
}

function loadChecker(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadCsvOhlc(filePath) {
  const rows = parseDelimited(fs.readFileSync(filePath, "utf8"));
  const records = rows
    .map((row) => ({
      date: String(row.date || "").trim(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close)
    }))
    .filter((row) =>
      row.date
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && Number.isFinite(row.close)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const byDate = new Map(records.map(record => [record.date, record]));
  const indexByDate = new Map(records.map((record, index) => [record.date, index]));
  const weekdayCounts = records.reduce((counts, record) => {
    const weekdayKey = weekdayFromDate(record.date);
    if (weekdayKey) counts[weekdayKey] = (counts[weekdayKey] || 0) + 1;
    return counts;
  }, {});
  const weekendRowCount = Number(weekdayCounts.SATURDAY || 0) + Number(weekdayCounts.SUNDAY || 0);

  return {
    records,
    byDate,
    indexByDate,
    coverageStart: records[0]?.date || null,
    coverageEnd: records[records.length - 1]?.date || null,
    weekdayCounts,
    weekendRowCount
  };
}

function computeAdrInputs(context, evaluationDate) {
  const index = context.indexByDate.get(evaluationDate);
  if (!Number.isInteger(index)) {
    return { ok: false, reason: "missing_evaluation_day_ohlc" };
  }
  if (index < ADR_WINDOW_SESSIONS) {
    return { ok: false, reason: "insufficient_previous_sessions" };
  }

  const evaluationRecord = context.records[index];
  const previousSessions = context.records.slice(index - ADR_WINDOW_SESSIONS, index);
  if (previousSessions.length !== ADR_WINDOW_SESSIONS) {
    return { ok: false, reason: "insufficient_previous_sessions" };
  }

  const adr20 = previousSessions.reduce((sum, row) => sum + (row.high - row.low), 0) / ADR_WINDOW_SESSIONS;
  const previousClose = context.records[index - 1]?.close;
  const open = Number.isFinite(evaluationRecord.open) ? evaluationRecord.open : null;
  const entryPrice = Number.isFinite(open) ? open : (Number.isFinite(previousClose) ? previousClose : null);
  const entryKind = Number.isFinite(open) ? "open" : (Number.isFinite(previousClose) ? "previous_close" : null);

  if (!Number.isFinite(entryPrice)) {
    return { ok: false, reason: "missing_reference_price" };
  }

  return {
    ok: true,
    entryPrice,
    entryKind,
    evaluationRecord,
    previousSessions,
    adr20,
    targetDistance: adr20 * (ADR_THRESHOLD_PCT / 100)
  };
}

function evaluateAdrReach(directionKey, adrInputs) {
  if (directionKey === "BULLISH") {
    return {
      reached: adrInputs.evaluationRecord.high >= (adrInputs.entryPrice + adrInputs.targetDistance),
      reachedVia: "high"
    };
  }

  return {
    reached: adrInputs.evaluationRecord.low <= (adrInputs.entryPrice - adrInputs.targetDistance),
    reachedVia: "low"
  };
}

function buildUnavailableAsset(config, checker) {
  return {
    assetCode: config.assetCode,
    assetLabel: config.assetLabel,
    available: false,
    status: "UNAVAILABLE",
    blocker: config.blocker,
    ohlcSourceLabel: config.ohlcSourceLabel,
    referencePricePolicy: "Unavailable because no supportable OHLC source exists in repo evidence.",
    summaryRowsChecked: Number(checker?.summary?.rows_checked || 0),
    totalCheckerRows: Array.isArray(checker?.rows) ? checker.rows.length : 0,
    evaluatedRows: [],
    skippedCounts: {},
    summary: {
      evaluatedCalls: 0,
      adrReachWins: 0,
      adrReachLosses: 0,
      adrReachWinPct: null,
      strongPlusCalls: 0,
      strongPlusAdrReachWinPct: null
    },
    bucketSummaryRows: CONFIDENCE_BUCKETS.map(bucket => ({
      bucketKey: bucket.key,
      bucketLabel: bucket.label,
      wins: 0,
      losses: 0,
      total: 0,
      adrReachWinPct: null
    })),
    weekdayKeys: config.weekdayKeys,
    weekdayTotals: buildCellMap(config.weekdayKeys),
    bucketTotals: buildCellMap(CONFIDENCE_BUCKETS.map(bucket => bucket.key)),
    bucketMatrix: Object.fromEntries(CONFIDENCE_BUCKETS.map(bucket => [bucket.key, buildCellMap(config.weekdayKeys)])),
    dayTotals: summarizeOutcomeCell(createOutcomeCell())
  };
}

function buildLayer1AssetResearch(config, checker) {
  if (config.status !== "available") {
    return buildUnavailableAsset(config, checker);
  }

  const context = loadCsvOhlc(config.ohlcSourcePath);
  const rows = Array.isArray(checker?.rows) ? checker.rows : [];
  const weekdayTotals = buildCellMap(config.weekdayKeys);
  const bucketTotals = buildCellMap(CONFIDENCE_BUCKETS.map(bucket => bucket.key));
  const bucketMatrix = Object.fromEntries(CONFIDENCE_BUCKETS.map(bucket => [bucket.key, buildCellMap(config.weekdayKeys)]));
  const evaluatedRows = [];
  const skippedCounts = {};

  rows.forEach((row) => {
    const directionKey = normalizeLayer1Direction(row?.stored?.direction || row?.checker?.direction || "");
    if (!directionKey) {
      skippedCounts.unsupported_direction = (skippedCounts.unsupported_direction || 0) + 1;
      return;
    }

    const confidencePct = normalizeHeadlineConfidence(row);
    const bucketKey = bucketKeyFromConfidence(confidencePct);
    if (!bucketKey) {
      skippedCounts.missing_confidence_bucket = (skippedCounts.missing_confidence_bucket || 0) + 1;
      return;
    }

    const evaluationDate = String(row?.evaluation_inputs?.close_date || "").trim();
    const weekdayKey = weekdayFromDate(evaluationDate);
    if (!evaluationDate || !weekdayKey || !weekdayTotals[weekdayKey]) {
      skippedCounts.missing_evaluation_date = (skippedCounts.missing_evaluation_date || 0) + 1;
      return;
    }

    const adrInputs = computeAdrInputs(context, evaluationDate);
    if (!adrInputs.ok) {
      skippedCounts[adrInputs.reason] = (skippedCounts[adrInputs.reason] || 0) + 1;
      return;
    }

    const reach = evaluateAdrReach(directionKey, adrInputs);
    const outcomeKey = reach.reached ? "WIN" : "LOSS";
    addOutcome(weekdayTotals[weekdayKey], outcomeKey);
    addOutcome(bucketTotals[bucketKey], outcomeKey);
    addOutcome(bucketMatrix[bucketKey][weekdayKey], outcomeKey);

    evaluatedRows.push({
      predictionId: row?.prediction_id || null,
      snapshotDate: row?.snapshot_date || "",
      evaluationDate,
      weekdayKey,
      directionKey,
      directionRaw: row?.stored?.direction || row?.checker?.direction || null,
      confidencePct,
      bucketKey,
      entryPrice: adrInputs.entryPrice,
      entryKind: adrInputs.entryKind,
      adr20: Number(adrInputs.adr20.toFixed(8)),
      targetDistance: Number(adrInputs.targetDistance.toFixed(8)),
      dayOpen: Number.isFinite(adrInputs.evaluationRecord.open) ? adrInputs.evaluationRecord.open : null,
      dayHigh: adrInputs.evaluationRecord.high,
      dayLow: adrInputs.evaluationRecord.low,
      dayClose: adrInputs.evaluationRecord.close,
      prev20FirstDate: adrInputs.previousSessions[0]?.date || null,
      prev20LastDate: adrInputs.previousSessions[ADR_WINDOW_SESSIONS - 1]?.date || null,
      prev20Count: adrInputs.previousSessions.length,
      thresholdPct: ADR_THRESHOLD_PCT,
      outcomeKey,
      reachedVia: reach.reachedVia,
      checkerResult: row?.stored?.evaluation_result || row?.checker?.evaluation_result || null
    });
  });

  const dayTotals = sumOutcomeCells(Object.values(weekdayTotals));
  const bucketSummaryRows = CONFIDENCE_BUCKETS.map(bucket => {
    const totals = summarizeOutcomeCell(bucketTotals[bucket.key]);
    return {
      bucketKey: bucket.key,
      bucketLabel: bucket.label,
      ...totals,
      adrReachWinPct: totals.winRatePct
    };
  });
  const strongPlus = sumOutcomeCells([
    bucketTotals.STRONG,
    bucketTotals.VERY_STRONG
  ]);

  return {
    assetCode: config.assetCode,
    assetLabel: config.assetLabel,
    available: true,
    status: "AVAILABLE",
    blocker: null,
    ohlcSourceLabel: config.ohlcSourceLabel,
    ohlcSourcePath: path.relative(path.resolve(__dirname, "../.."), config.ohlcSourcePath).replace(/\\/g, "/"),
    referencePricePolicy: "Use evaluation-day open when OHLC open exists; otherwise use previous close.",
    sourceCoverage: {
      startDate: context.coverageStart,
      endDate: context.coverageEnd,
      rowCount: context.records.length,
      weekendRowCount: context.weekendRowCount
    },
    summaryRowsChecked: Number(checker?.summary?.rows_checked || 0),
    totalCheckerRows: rows.length,
    evaluatedRows,
    skippedCounts,
    summary: {
      evaluatedCalls: dayTotals.total,
      adrReachWins: dayTotals.wins,
      adrReachLosses: dayTotals.losses,
      adrReachWinPct: dayTotals.winRatePct,
      strongPlusCalls: strongPlus.total,
      strongPlusAdrReachWinPct: strongPlus.winRatePct
    },
    bucketSummaryRows,
    weekdayKeys: config.weekdayKeys,
    weekdayTotals,
    bucketTotals,
    bucketMatrix,
    dayTotals
  };
}

function buildLayer2PairResearch(config, layer1ByAssetCode, checkers) {
  const targetAsset = layer1ByAssetCode[config.targetAssetCode];
  if (!targetAsset?.available) {
    return {
      pairCode: config.pairCode,
      pairLabel: config.pairLabel,
      targetAssetCode: config.targetAssetCode,
      available: false,
      status: "UNAVAILABLE",
      blocker: targetAsset?.blocker || "Target asset ADR reach support is unavailable.",
      weekdayKeys: config.weekdayKeys,
      summary: {
        tradableSignals: 0,
        adrReachWins: 0,
        adrReachLosses: 0,
        adrReachWinPct: null,
        strongPlusSignals: 0,
        strongPlusAdrReachWinPct: null
      },
      bucketSummaryRows: CONFIDENCE_BUCKETS.map(bucket => ({
        bucketKey: bucket.key,
        bucketLabel: bucket.label,
        wins: 0,
        losses: 0,
        total: 0,
        adrReachWinPct: null
      })),
      weekdayTotals: buildCellMap(config.weekdayKeys),
      bucketTotals: buildCellMap(CONFIDENCE_BUCKETS.map(bucket => bucket.key)),
      bucketMatrix: Object.fromEntries(CONFIDENCE_BUCKETS.map(bucket => [bucket.key, buildCellMap(config.weekdayKeys)])),
      dayTotals: summarizeOutcomeCell(createOutcomeCell()),
      tradableRows: [],
      skippedCounts: {}
    };
  }

  const usdChecker = checkers.USD;
  const targetChecker = checkers[config.targetAssetCode];
  const usdRowsByDate = new Map((Array.isArray(usdChecker?.rows) ? usdChecker.rows : []).map(row => [String(row?.snapshot_date || "").trim(), row]));
  const targetByPredictionId = new Map(targetAsset.evaluatedRows.map(row => [row.predictionId, row]));
  const targetBySnapshotDate = new Map(targetAsset.evaluatedRows.map(row => [row.snapshotDate, row]));
  const weekdayTotals = buildCellMap(config.weekdayKeys);
  const bucketTotals = buildCellMap(CONFIDENCE_BUCKETS.map(bucket => bucket.key));
  const bucketMatrix = Object.fromEntries(CONFIDENCE_BUCKETS.map(bucket => [bucket.key, buildCellMap(config.weekdayKeys)]));
  const skippedCounts = {};
  const tradableRows = [];

  (Array.isArray(targetChecker?.rows) ? targetChecker.rows : []).forEach((targetRow) => {
    const snapshotDate = String(targetRow?.snapshot_date || "").trim();
    const usdRow = usdRowsByDate.get(snapshotDate) || null;
    const targetDirection = normalizeExactDirectionalSignal(targetRow?.stored?.direction || targetRow?.checker?.direction || "");
    const usdDirection = normalizeExactDirectionalSignal(usdRow?.stored?.direction || usdRow?.checker?.direction || "");
    const targetConfidence = normalizeHeadlineConfidence(targetRow);
    const usdConfidence = normalizeHeadlineConfidence(usdRow);
    const combinedConfidencePct = Number.isFinite(targetConfidence) && Number.isFinite(usdConfidence)
      ? Math.min(targetConfidence, usdConfidence)
      : null;
    const bucketKey = bucketKeyFromConfidence(combinedConfidencePct);

    if (!usdRow) {
      skippedCounts.missing_usd_snapshot = (skippedCounts.missing_usd_snapshot || 0) + 1;
      return;
    }
    if (!targetDirection) {
      skippedCounts.unsupported_target_direction = (skippedCounts.unsupported_target_direction || 0) + 1;
      return;
    }
    if (!usdDirection) {
      skippedCounts.unsupported_usd_direction = (skippedCounts.unsupported_usd_direction || 0) + 1;
      return;
    }
    if (targetDirection === usdDirection) {
      skippedCounts.same_direction_conflict = (skippedCounts.same_direction_conflict || 0) + 1;
      return;
    }
    if (!bucketKey) {
      skippedCounts.missing_combined_confidence = (skippedCounts.missing_combined_confidence || 0) + 1;
      return;
    }

    const evaluatedTargetRow = targetByPredictionId.get(targetRow?.prediction_id) || targetBySnapshotDate.get(snapshotDate) || null;
    if (!evaluatedTargetRow) {
      skippedCounts.missing_target_adr_support = (skippedCounts.missing_target_adr_support || 0) + 1;
      return;
    }

    const weekdayKey = evaluatedTargetRow.weekdayKey;
    if (!weekdayTotals[weekdayKey]) {
      skippedCounts.unsupported_weekday = (skippedCounts.unsupported_weekday || 0) + 1;
      return;
    }

    addOutcome(weekdayTotals[weekdayKey], evaluatedTargetRow.outcomeKey);
    addOutcome(bucketTotals[bucketKey], evaluatedTargetRow.outcomeKey);
    addOutcome(bucketMatrix[bucketKey][weekdayKey], evaluatedTargetRow.outcomeKey);
    tradableRows.push({
      predictionId: targetRow?.prediction_id || null,
      snapshotDate,
      evaluationDate: evaluatedTargetRow.evaluationDate,
      weekdayKey,
      targetDirection,
      usdDirection,
      combinedConfidencePct,
      bucketKey,
      outcomeKey: evaluatedTargetRow.outcomeKey
    });
  });

  const dayTotals = sumOutcomeCells(Object.values(weekdayTotals));
  const bucketSummaryRows = CONFIDENCE_BUCKETS.map(bucket => {
    const totals = summarizeOutcomeCell(bucketTotals[bucket.key]);
    return {
      bucketKey: bucket.key,
      bucketLabel: bucket.label,
      ...totals,
      adrReachWinPct: totals.winRatePct
    };
  });
  const strongPlus = sumOutcomeCells([
    bucketTotals.STRONG,
    bucketTotals.VERY_STRONG
  ]);

  return {
    pairCode: config.pairCode,
    pairLabel: config.pairLabel,
    targetAssetCode: config.targetAssetCode,
    available: true,
    status: "AVAILABLE",
    blocker: null,
    weekdayKeys: config.weekdayKeys,
    summary: {
      tradableSignals: dayTotals.total,
      adrReachWins: dayTotals.wins,
      adrReachLosses: dayTotals.losses,
      adrReachWinPct: dayTotals.winRatePct,
      strongPlusSignals: strongPlus.total,
      strongPlusAdrReachWinPct: strongPlus.winRatePct
    },
    bucketSummaryRows,
    weekdayTotals,
    bucketTotals,
    bucketMatrix,
    dayTotals,
    tradableRows,
    skippedCounts
  };
}

function validateCheckerInvariants(checkers, errors) {
  Object.entries(checkers).forEach(([assetCode, checker]) => {
    const rowCount = Array.isArray(checker?.rows) ? checker.rows.length : 0;
    const rowsChecked = Number(checker?.summary?.rows_checked || 0);
    if (EXPECTED_CHECKER_ROWS[assetCode] !== rowCount) {
      errors.push(`${assetCode}: checker rows ${rowCount} did not match expected ${EXPECTED_CHECKER_ROWS[assetCode]}`);
    }
    if (EXPECTED_CHECKER_ROWS[assetCode] !== rowsChecked) {
      errors.push(`${assetCode}: checker summary rows_checked ${rowsChecked} did not match expected ${EXPECTED_CHECKER_ROWS[assetCode]}`);
    }
  });
}

function validateAvailableAsset(asset, errors) {
  if (asset.assetCode === "BTC") {
    if (Number(asset?.sourceCoverage?.weekendRowCount || 0) <= 0) {
      errors.push("BTC: source coverage did not include weekend OHLC rows");
    }
    const btcWeekendEvaluations = asset.evaluatedRows.filter((row) => row.weekdayKey === "SATURDAY" || row.weekdayKey === "SUNDAY").length;
    if (btcWeekendEvaluations <= 0) {
      errors.push("BTC: evaluated rows did not retain weekend calendar handling");
    }
  } else if (Number(asset?.sourceCoverage?.weekendRowCount || 0) > 0) {
    errors.push(`${asset.assetCode}: non-BTC OHLC source included weekend rows`);
  }

  asset.evaluatedRows.forEach((row, index) => {
    if (row.prev20Count !== ADR_WINDOW_SESSIONS) {
      errors.push(`${asset.assetCode} row ${index + 1}: previous 20 sessions were not used`);
    }
    if (!row.prev20LastDate || row.prev20LastDate >= row.evaluationDate) {
      errors.push(`${asset.assetCode} row ${index + 1}: ADR window included look-ahead data`);
    }
    if (Math.abs(row.targetDistance - (row.adr20 * 0.5)) > 0.000001) {
      errors.push(`${asset.assetCode} row ${index + 1}: threshold did not equal 50% ADR20`);
    }
    if (row.directionKey === "BULLISH" && row.reachedVia !== "high") {
      errors.push(`${asset.assetCode} row ${index + 1}: bullish reach was not evaluated against the session high`);
    }
    if (row.directionKey === "BEARISH" && row.reachedVia !== "low") {
      errors.push(`${asset.assetCode} row ${index + 1}: bearish reach was not evaluated against the session low`);
    }
  });

  const summaryTotal = asset.summary.adrReachWins + asset.summary.adrReachLosses;
  if (asset.summary.evaluatedCalls !== summaryTotal) {
    errors.push(`${asset.assetCode}: summary evaluated calls did not equal wins + losses`);
  }

  const bucketRollup = sumOutcomeCells(Object.values(asset.bucketTotals));
  const weekdayRollup = sumOutcomeCells(Object.values(asset.weekdayTotals));
  if (bucketRollup.total !== asset.summary.evaluatedCalls || weekdayRollup.total !== asset.summary.evaluatedCalls) {
    errors.push(`${asset.assetCode}: confidence buckets or weekday totals did not reconcile to the asset summary`);
  }

  asset.weekdayKeys.forEach((weekdayKey) => {
    const weekdayRollupFromBuckets = sumOutcomeCells(CONFIDENCE_BUCKETS.map(bucket => asset.bucketMatrix?.[bucket.key]?.[weekdayKey]));
    const dayCell = summarizeOutcomeCell(asset.weekdayTotals[weekdayKey]);
    if (
      weekdayRollupFromBuckets.total !== dayCell.total
      || weekdayRollupFromBuckets.wins !== dayCell.wins
      || weekdayRollupFromBuckets.losses !== dayCell.losses
    ) {
      errors.push(`${asset.assetCode}: weekday ${weekdayKey} did not reconcile to the confidence-bucket rows`);
    }
  });
}

function validateAvailablePair(pair, errors) {
  const summaryTotal = pair.summary.adrReachWins + pair.summary.adrReachLosses;
  if (pair.summary.tradableSignals !== summaryTotal) {
    errors.push(`${pair.pairCode}: tradable signals did not equal wins + losses`);
  }

  const bucketRollup = sumOutcomeCells(Object.values(pair.bucketTotals));
  const weekdayRollup = sumOutcomeCells(Object.values(pair.weekdayTotals));
  if (bucketRollup.total !== pair.summary.tradableSignals || weekdayRollup.total !== pair.summary.tradableSignals) {
    errors.push(`${pair.pairCode}: confidence buckets or weekday totals did not reconcile to the pair summary`);
  }

  pair.weekdayKeys.forEach((weekdayKey) => {
    const weekdayRollupFromBuckets = sumOutcomeCells(CONFIDENCE_BUCKETS.map(bucket => pair.bucketMatrix?.[bucket.key]?.[weekdayKey]));
    const dayCell = summarizeOutcomeCell(pair.weekdayTotals[weekdayKey]);
    if (
      weekdayRollupFromBuckets.total !== dayCell.total
      || weekdayRollupFromBuckets.wins !== dayCell.wins
      || weekdayRollupFromBuckets.losses !== dayCell.losses
    ) {
      errors.push(`${pair.pairCode}: weekday ${weekdayKey} did not reconcile to the confidence-bucket rows`);
    }
  });
}

function buildOutput(layer1Assets, layer2Pairs) {
  return {
    meta: {
      generated_at: new Date().toISOString(),
      source: "backtester/scripts/validate_adr_reach_research.js",
      evaluation_window: "following 24hrs",
      adr_window_sessions: ADR_WINDOW_SESSIONS,
      adr_threshold_pct: ADR_THRESHOLD_PCT,
      reference_price_policy: "Use evaluation-day open when OHLC open exists; otherwise previous close. Unsupported assets stay unavailable rather than estimated."
    },
    source_audit: layer1Assets.map(asset => ({
      assetCode: asset.assetCode,
      assetLabel: asset.assetLabel,
      available: asset.available,
      ohlcSourceLabel: asset.ohlcSourceLabel,
      ohlcSourcePath: asset.ohlcSourcePath || null,
      sourceCoverage: asset.sourceCoverage || null,
      referencePricePolicy: asset.referencePricePolicy,
      blocker: asset.blocker || null
    })),
    layer1: {
      summary_rows: layer1Assets.map(asset => ({
        assetCode: asset.assetCode,
        assetLabel: asset.assetLabel,
        available: asset.available,
        blocker: asset.blocker || null,
        evaluatedCalls: asset.summary.evaluatedCalls,
        adrReachWins: asset.summary.adrReachWins,
        adrReachLosses: asset.summary.adrReachLosses,
        adrReachWinPct: asset.summary.adrReachWinPct,
        strongPlusCalls: asset.summary.strongPlusCalls,
        strongPlusAdrReachWinPct: asset.summary.strongPlusAdrReachWinPct
      })),
      assets: layer1Assets.map(asset => ({
        assetCode: asset.assetCode,
        assetLabel: asset.assetLabel,
        available: asset.available,
        blocker: asset.blocker || null,
        weekdayKeys: asset.weekdayKeys,
        summary: asset.summary,
        bucketSummaryRows: asset.bucketSummaryRows,
        dayTotals: asset.dayTotals,
        weekdayTotals: asset.weekdayTotals,
        bucketTotals: asset.bucketTotals,
        bucketMatrix: asset.bucketMatrix
      }))
    },
    layer2: {
      summary_rows: layer2Pairs.map(pair => ({
        pairCode: pair.pairCode,
        pairLabel: pair.pairLabel,
        targetAssetCode: pair.targetAssetCode,
        available: pair.available,
        blocker: pair.blocker || null,
        tradableSignals: pair.summary.tradableSignals,
        adrReachWins: pair.summary.adrReachWins,
        adrReachLosses: pair.summary.adrReachLosses,
        adrReachWinPct: pair.summary.adrReachWinPct,
        strongPlusSignals: pair.summary.strongPlusSignals,
        strongPlusAdrReachWinPct: pair.summary.strongPlusAdrReachWinPct
      })),
      pairs: layer2Pairs.map(pair => ({
        pairCode: pair.pairCode,
        pairLabel: pair.pairLabel,
        targetAssetCode: pair.targetAssetCode,
        available: pair.available,
        blocker: pair.blocker || null,
        weekdayKeys: pair.weekdayKeys,
        summary: pair.summary,
        bucketSummaryRows: pair.bucketSummaryRows,
        dayTotals: pair.dayTotals,
        weekdayTotals: pair.weekdayTotals,
        bucketTotals: pair.bucketTotals,
        bucketMatrix: pair.bucketMatrix
      }))
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkers = Object.fromEntries(Object.entries(CHECKER_PATHS).map(([assetCode, filePath]) => [assetCode, loadChecker(filePath)]));
  const layer1Assets = ASSET_CONFIGS.map(config => buildLayer1AssetResearch(config, checkers[config.assetCode]));
  const layer1ByAssetCode = Object.fromEntries(layer1Assets.map(asset => [asset.assetCode, asset]));
  const layer2Pairs = PAIR_CONFIGS.map(config => buildLayer2PairResearch(config, layer1ByAssetCode, checkers));
  const output = buildOutput(layer1Assets, layer2Pairs);
  const errors = [];

  validateCheckerInvariants(checkers, errors);
  layer1Assets.filter(asset => asset.available).forEach(asset => validateAvailableAsset(asset, errors));
  layer2Pairs.filter(pair => pair.available).forEach(pair => validateAvailablePair(pair, errors));

  if (args.write === "true") {
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  } else if (!fs.existsSync(OUTPUT_PATH)) {
    errors.push("ADR reach artifact is missing. Run with --write to generate data/adr-reach-research.json.");
  } else {
    const existing = fs.readFileSync(OUTPUT_PATH, "utf8");
    const parsed = JSON.parse(existing);
    const comparableCurrent = JSON.stringify({ ...output, meta: { ...output.meta, generated_at: null } });
    const comparableExisting = JSON.stringify({ ...parsed, meta: { ...parsed.meta, generated_at: null } });
    if (comparableCurrent !== comparableExisting) {
      errors.push("ADR reach artifact is stale relative to the current builder output.");
    }
  }

  console.log(JSON.stringify({
    status: errors.length ? "FAIL" : "PASS",
    artifact_path: OUTPUT_PATH,
    layer1_summary: output.layer1.summary_rows,
    layer2_summary: output.layer2.summary_rows,
    available_layer1_assets: layer1Assets.filter(asset => asset.available).map(asset => asset.assetCode),
    available_layer2_pairs: layer2Pairs.filter(pair => pair.available).map(pair => pair.pairCode),
    errors
  }, null, 2));

  if (errors.length) {
    process.exitCode = 1;
  }
}

main();
