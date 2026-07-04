#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs, parseDelimited } = require("../lib/historical_common");
const {
  ADR_WINDOW_SESSIONS,
  ADR_THRESHOLD_PCT,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateIntradayReach,
  bucketKeyFromConfidence
} = require("../lib/adr_reach_logic");

const WEEKDAY_KEYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
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
const CACHE_DIR = path.resolve(__dirname, "../cache/ohlc");
const TMP_DIR = path.resolve(__dirname, "../tmp");

// Sources are tried in order; the first one whose file exists wins. OANDA
// caches (staged via backtester/importers/oanda/download_oanda_daily_ohlc.js)
// always outrank legacy/proxy fallbacks, so coverage upgrades automatically
// once the account-verified instrument data is downloaded.
const ASSET_CONFIGS = [
  {
    assetCode: "EUR",
    assetLabel: "EUR",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.EUR,
    allowWeekends: false,
    sources: [
      {
        path: path.resolve(CACHE_DIR, "eur_usd_daily_oanda.csv"),
        label: "EUR/USD daily OHLC from OANDA v20 EUR_USD mid candles",
        kind: "oanda",
        instrument: "EUR_USD"
      },
      {
        path: path.resolve(TMP_DIR, "eurusd_daily_alpha_vantage.csv"),
        label: "EUR/USD daily OHLC CSV from Alpha Vantage FX_DAILY (fallback until the OANDA EUR_USD cache is staged)",
        kind: "legacy_fallback",
        instrument: "EUR/USD (Alpha Vantage)"
      }
    ],
    unavailableBlocker: "No EUR/USD daily OHLC source is staged."
  },
  {
    assetCode: "GOLD",
    assetLabel: "Gold",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.GOLD,
    allowWeekends: false,
    sources: [
      {
        path: path.resolve(CACHE_DIR, "xau_usd_daily_oanda.csv"),
        label: "XAU/USD daily OHLC from OANDA v20 XAU_USD mid candles",
        kind: "oanda",
        instrument: "XAU_USD"
      }
    ],
    unavailableBlocker: "OANDA XAU_USD daily OHLC cache is not staged. Set OANDA_API_TOKEN and run backtester/importers/oanda/download_oanda_daily_ohlc.js --instrument=XAU_USD, then rebuild this artifact. Close-only spot lineage and GLD proxy data remain unacceptable for intraday reach evidence."
  },
  {
    assetCode: "NQ",
    assetLabel: "NQ",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.NQ,
    allowWeekends: false,
    sources: [
      {
        path: path.resolve(CACHE_DIR, "nas100_usd_daily_oanda.csv"),
        label: "NAS100 daily OHLC from OANDA v20 NAS100_USD mid candles",
        kind: "oanda",
        instrument: "NAS100_USD"
      },
      {
        path: path.resolve(CACHE_DIR, "qqq_daily_yahoo_proxy.csv"),
        label: "QQQ daily OHLC proxy (Yahoo) — explicit proxy fallback until the OANDA NAS100_USD cache is staged",
        kind: "proxy_fallback",
        instrument: "QQQ (proxy for NAS100)"
      }
    ],
    unavailableBlocker: "No NQ daily OHLC source is staged. Stage the OANDA NAS100_USD cache via backtester/importers/oanda/download_oanda_daily_ohlc.js."
  },
  {
    assetCode: "BTC",
    assetLabel: "BTC",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    checkerPath: CHECKER_PATHS.BTC,
    allowWeekends: true,
    sources: [
      {
        path: path.resolve(CACHE_DIR, "btcusdt_daily_binance.csv"),
        label: "BTC/USDT daily OHLC from Binance Spot GET /api/v3/klines (interval=1d)",
        kind: "binance",
        instrument: "BTCUSDT"
      },
      {
        path: path.resolve(TMP_DIR, "btcusd_daily_coinbase.csv"),
        label: "BTC/USD daily OHLC CSV from Coinbase Exchange candles (legacy fallback)",
        kind: "legacy_fallback",
        instrument: "BTC-USD (Coinbase)"
      }
    ],
    unavailableBlocker: "No BTC daily OHLC source is staged."
  },
  {
    assetCode: "USD",
    assetLabel: "USD",
    weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    checkerPath: CHECKER_PATHS.USD,
    allowWeekends: false,
    sources: [],
    unavailableBlocker: "No supportable DXY/USD-index daily OHLC source is staged. If the OANDA account exposes a USD index instrument, stage it via backtester/importers/oanda/download_oanda_daily_ohlc.js --instrument=<name> and add it to this builder. Close-to-close research views remain unacceptable for intraday reach evidence."
  }
];
const PAIR_CONFIGS = [
  { targetAssetCode: "EUR", pairCode: "EUR_USD", pairLabel: "EUR/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "GOLD", pairCode: "XAU_USD", pairLabel: "XAU/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "NQ", pairCode: "NQ_USD", pairLabel: "NQ/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] },
  { targetAssetCode: "BTC", pairCode: "BTC_USD", pairLabel: "BTC/USD", weekdayKeys: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] }
];
const OUTPUT_PATH = path.resolve(__dirname, "../../data/adr-reach-research.json");
const REFERENCE_PRICE_POLICY = "Use the call day's open as the entry price. Rows without a usable same-day open are excluded and counted in diagnostics; there is no previous-close fallback.";

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

function normalizeExactDirectionalSignal(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "BULLISH" || normalized === "BEARISH") return normalized;
  return null;
}

function loadChecker(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveSource(config) {
  for (const source of config.sources) {
    if (fs.existsSync(source.path)) return source;
  }
  return null;
}

// Supports both cache schemas:
// - legacy: date,open,high,low,close[,volume,...]
// - importer: instrument,date,open,high,low,close,volume,source,complete
// Incomplete (still-forming) candles and, for weekday-only markets, weekend
// rows are filtered out and counted so the artifact can report them.
function loadCsvOhlc(source, allowWeekends) {
  const rows = parseDelimited(fs.readFileSync(source.path, "utf8"));
  let incompleteRowsExcluded = 0;
  let weekendRowsDropped = 0;

  const records = rows
    .filter((row) => {
      if (String(row.complete || "").trim().toLowerCase() === "false") {
        incompleteRowsExcluded += 1;
        return false;
      }
      return true;
    })
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
    .filter((row) => {
      if (allowWeekends) return true;
      const weekdayKey = weekdayFromDate(row.date);
      if (weekdayKey === "SATURDAY" || weekdayKey === "SUNDAY") {
        weekendRowsDropped += 1;
        return false;
      }
      return true;
    })
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
    weekendRowCount,
    incompleteRowsExcluded,
    weekendRowsDropped
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
  if (!Number.isFinite(evaluationRecord.open)) {
    return { ok: false, reason: "missing_day_open" };
  }

  const previousSessions = context.records.slice(index - ADR_WINDOW_SESSIONS, index);
  const adr20 = computeAdrFromSessions(previousSessions, ADR_WINDOW_SESSIONS);
  const targetDistance = resolveL2lDistance(adr20, ADR_THRESHOLD_PCT);
  if (!Number.isFinite(targetDistance)) {
    return { ok: false, reason: "insufficient_previous_sessions" };
  }

  return {
    ok: true,
    entryPrice: evaluationRecord.open,
    evaluationRecord,
    previousSessions,
    adr20,
    targetDistance
  };
}

function buildDiagnostics(skippedCounts = {}) {
  return {
    missingOhlcRows:
      Number(skippedCounts.missing_evaluation_day_ohlc || 0)
      + Number(skippedCounts.missing_day_open || 0),
    missingL2lDistanceRows: Number(skippedCounts.insufficient_previous_sessions || 0),
    noTradeRows: Number(skippedCounts.no_trade_non_directional || 0),
    otherSkippedRows:
      Number(skippedCounts.missing_confidence_bucket || 0)
      + Number(skippedCounts.missing_evaluation_date || 0),
    skippedCounts
  };
}

function buildUnavailableAsset(config, checker) {
  return {
    assetCode: config.assetCode,
    assetLabel: config.assetLabel,
    available: false,
    status: "UNAVAILABLE",
    blocker: config.unavailableBlocker,
    ohlcSourceLabel: config.sources[0]?.label || "No OHLC source configured",
    ohlcSourceKind: null,
    ohlcInstrument: null,
    referencePricePolicy: "Unavailable because no supportable OHLC source is staged in the repo.",
    summaryRowsChecked: Number(checker?.summary?.rows_checked || 0),
    totalCheckerRows: Array.isArray(checker?.rows) ? checker.rows.length : 0,
    evaluatedRows: [],
    skippedCounts: {},
    diagnostics: buildDiagnostics({}),
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
  const source = resolveSource(config);
  if (!source) {
    return buildUnavailableAsset(config, checker);
  }

  const context = loadCsvOhlc(source, config.allowWeekends);
  const rows = Array.isArray(checker?.rows) ? checker.rows : [];
  const weekdayTotals = buildCellMap(config.weekdayKeys);
  const bucketTotals = buildCellMap(CONFIDENCE_BUCKETS.map(bucket => bucket.key));
  const bucketMatrix = Object.fromEntries(CONFIDENCE_BUCKETS.map(bucket => [bucket.key, buildCellMap(config.weekdayKeys)]));
  const evaluatedRows = [];
  const skippedCounts = {};

  rows.forEach((row) => {
    const rawDirection = row?.stored?.direction || row?.checker?.direction || "";
    const directionKey = normalizeReachDirection(rawDirection);
    if (!directionKey) {
      skippedCounts.no_trade_non_directional = (skippedCounts.no_trade_non_directional || 0) + 1;
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

    const reach = evaluateIntradayReach({
      direction: directionKey,
      open: adrInputs.entryPrice,
      high: adrInputs.evaluationRecord.high,
      low: adrInputs.evaluationRecord.low,
      l2lDistance: adrInputs.targetDistance
    });
    if (reach.status !== "WIN" && reach.status !== "MISS") {
      skippedCounts[reach.reason || "invalid_reach_inputs"] = (skippedCounts[reach.reason || "invalid_reach_inputs"] || 0) + 1;
      return;
    }

    const outcomeKey = reach.status === "WIN" ? "WIN" : "LOSS";
    addOutcome(weekdayTotals[weekdayKey], outcomeKey);
    addOutcome(bucketTotals[bucketKey], outcomeKey);
    addOutcome(bucketMatrix[bucketKey][weekdayKey], outcomeKey);

    evaluatedRows.push({
      predictionId: row?.prediction_id || null,
      snapshotDate: row?.snapshot_date || "",
      evaluationDate,
      weekdayKey,
      directionKey,
      directionRaw: rawDirection || null,
      confidencePct,
      bucketKey,
      entryPrice: adrInputs.entryPrice,
      adr20: Number(adrInputs.adr20.toFixed(8)),
      targetDistance: Number(adrInputs.targetDistance.toFixed(8)),
      requiredTarget: Number(reach.requiredTarget.toFixed(8)),
      dayOpen: adrInputs.evaluationRecord.open,
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
    ohlcSourceLabel: source.label,
    ohlcSourceKind: source.kind,
    ohlcInstrument: source.instrument,
    ohlcSourcePath: path.relative(path.resolve(__dirname, "../.."), source.path).replace(/\\/g, "/"),
    referencePricePolicy: REFERENCE_PRICE_POLICY,
    sourceCoverage: {
      startDate: context.coverageStart,
      endDate: context.coverageEnd,
      rowCount: context.records.length,
      weekendRowCount: context.weekendRowCount,
      incompleteRowsExcluded: context.incompleteRowsExcluded,
      weekendRowsDropped: context.weekendRowsDropped
    },
    summaryRowsChecked: Number(checker?.summary?.rows_checked || 0),
    totalCheckerRows: rows.length,
    evaluatedRows,
    skippedCounts,
    diagnostics: buildDiagnostics(skippedCounts),
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

function buildPairDiagnostics(skippedCounts = {}) {
  return {
    missingUsdSnapshotRows: Number(skippedCounts.missing_usd_snapshot || 0),
    noTradeRows:
      Number(skippedCounts.unsupported_target_direction || 0)
      + Number(skippedCounts.unsupported_usd_direction || 0),
    sameDirectionConflicts: Number(skippedCounts.same_direction_conflict || 0),
    missingCombinedConfidenceRows: Number(skippedCounts.missing_combined_confidence || 0),
    missingTargetAdrSupportRows: Number(skippedCounts.missing_target_adr_support || 0),
    skippedCounts
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
      skippedCounts: {},
      diagnostics: buildPairDiagnostics({})
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
    skippedCounts,
    diagnostics: buildPairDiagnostics(skippedCounts)
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
    if (row.entryPrice !== row.dayOpen) {
      errors.push(`${asset.assetCode} row ${index + 1}: entry price was not the call day's open`);
    }
    if (row.directionKey === "BULLISH") {
      if (row.reachedVia !== "high") {
        errors.push(`${asset.assetCode} row ${index + 1}: bullish reach was not evaluated against the session high`);
      }
      const shouldWin = row.dayHigh >= (row.entryPrice + row.targetDistance) - 0.000001;
      if ((row.outcomeKey === "WIN") !== shouldWin) {
        errors.push(`${asset.assetCode} row ${index + 1}: bullish outcome did not match the intraday touch definition`);
      }
    }
    if (row.directionKey === "BEARISH") {
      if (row.reachedVia !== "low") {
        errors.push(`${asset.assetCode} row ${index + 1}: bearish reach was not evaluated against the session low`);
      }
      const shouldWin = row.dayLow <= (row.entryPrice - row.targetDistance) + 0.000001;
      if ((row.outcomeKey === "WIN") !== shouldWin) {
        errors.push(`${asset.assetCode} row ${index + 1}: bearish outcome did not match the intraday touch definition`);
      }
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
      l2l_definition: `L2L target distance = ${ADR_THRESHOLD_PCT}% of the rolling ADR(${ADR_WINDOW_SESSIONS}) computed from the ${ADR_WINDOW_SESSIONS} completed sessions before the evaluation day.`,
      win_definition: "WIN when the day's high (bullish/long) or low (bearish/short) touches open +/- the L2L target distance at any point inside the evaluation day. The close is ignored; this is intraday reach, not close-to-close accuracy.",
      reference_price_policy: REFERENCE_PRICE_POLICY,
      diagnostics: {
        unsupportedInstruments: layer1Assets
          .filter(asset => !asset.available)
          .map(asset => ({ assetCode: asset.assetCode, blocker: asset.blocker })),
        layer1: Object.fromEntries(layer1Assets.map(asset => [asset.assetCode, {
          missingOhlcRows: asset.diagnostics.missingOhlcRows,
          missingL2lDistanceRows: asset.diagnostics.missingL2lDistanceRows,
          noTradeRows: asset.diagnostics.noTradeRows,
          otherSkippedRows: asset.diagnostics.otherSkippedRows
        }])),
        layer2: Object.fromEntries(layer2Pairs.map(pair => [pair.pairCode, {
          missingUsdSnapshotRows: pair.diagnostics.missingUsdSnapshotRows,
          noTradeRows: pair.diagnostics.noTradeRows,
          sameDirectionConflicts: pair.diagnostics.sameDirectionConflicts,
          missingCombinedConfidenceRows: pair.diagnostics.missingCombinedConfidenceRows,
          missingTargetAdrSupportRows: pair.diagnostics.missingTargetAdrSupportRows
        }]))
      }
    },
    source_audit: layer1Assets.map(asset => ({
      assetCode: asset.assetCode,
      assetLabel: asset.assetLabel,
      available: asset.available,
      ohlcSourceLabel: asset.ohlcSourceLabel,
      ohlcSourceKind: asset.ohlcSourceKind || null,
      ohlcInstrument: asset.ohlcInstrument || null,
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
        diagnostics: asset.diagnostics,
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
        diagnostics: pair.diagnostics,
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
    diagnostics: output.meta.diagnostics,
    errors
  }, null, 2));

  if (errors.length) {
    process.exitCode = 1;
  }
}

main();
