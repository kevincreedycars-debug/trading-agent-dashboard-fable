#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs, parseDelimited } = require("../lib/historical_common");
const {
  ADR_WINDOW_SESSIONS,
  ADR_THRESHOLD_PCT,
  RANGE_AVAILABILITY_NOTE,
  DIRECTIONAL_MOVE_NOTE,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateL2lRangeAvailability,
  evaluateL2lDirectionalMove,
  bucketKeyFromConfidence
} = require("../lib/l2l_range_logic");

const MIN_HOURLY_CANDLES_PER_DAY = 6;

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
    hourlySources: [
      {
        path: path.resolve(CACHE_DIR, "eur_usd_h1_oanda.csv"),
        label: "EUR/USD H1 OHLC from OANDA v20 EUR_USD mid candles",
        kind: "oanda",
        instrument: "EUR_USD"
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
    hourlySources: [
      {
        path: path.resolve(CACHE_DIR, "xau_usd_h1_oanda.csv"),
        label: "XAU/USD H1 OHLC from OANDA v20 XAU_USD mid candles",
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
    hourlySources: [
      {
        path: path.resolve(CACHE_DIR, "nas100_usd_h1_oanda.csv"),
        label: "NAS100 H1 OHLC from OANDA v20 NAS100_USD mid candles",
        kind: "oanda",
        instrument: "NAS100_USD"
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
    hourlySources: [
      {
        path: path.resolve(CACHE_DIR, "btcusdt_h1_binance.csv"),
        label: "BTC/USDT 1h OHLC from Binance Spot GET /api/v3/klines",
        kind: "binance",
        instrument: "BTCUSDT"
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
    hourlySources: [],
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
const REFERENCE_PRICE_POLICY = "The day's open is recorded as diagnostic context only; it is never an anchor. Availability is measured purely on the day's high-low range vs the L2L distance.";

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

// Hourly candles grouped by UTC date. Weekend-dated stubs stay in the map but
// are never queried for weekday-only markets because evaluation dates come
// from the weekday-filtered daily calendar.
function loadHourlyOhlc(source) {
  const rows = parseDelimited(fs.readFileSync(source.path, "utf8"));
  let incompleteRowsExcluded = 0;
  const byDate = new Map();
  let rowCount = 0;
  let coverageStart = null;
  let coverageEnd = null;

  rows.forEach((row) => {
    if (String(row.complete || "").trim().toLowerCase() === "false") {
      incompleteRowsExcluded += 1;
      return;
    }
    const time = String(row.time || "").trim();
    const date = String(row.date || "").trim();
    const candle = {
      time,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close)
    };
    if (
      !time
      || !date
      || !Number.isFinite(candle.open)
      || !Number.isFinite(candle.high)
      || !Number.isFinite(candle.low)
      || !Number.isFinite(candle.close)
    ) {
      return;
    }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(candle);
    rowCount += 1;
    if (!coverageStart || date < coverageStart) coverageStart = date;
    if (!coverageEnd || date > coverageEnd) coverageEnd = date;
  });

  byDate.forEach((candles) => candles.sort((a, b) => a.time.localeCompare(b.time)));

  return { byDate, rowCount, coverageStart, coverageEnd, incompleteRowsExcluded };
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
  const adr20 = computeAdrFromSessions(previousSessions, ADR_WINDOW_SESSIONS);
  const targetDistance = resolveL2lDistance(adr20, ADR_THRESHOLD_PCT);
  if (!Number.isFinite(targetDistance)) {
    return { ok: false, reason: "insufficient_previous_sessions" };
  }

  return {
    ok: true,
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
      + Number(skippedCounts.missing_high_low || 0)
      + Number(skippedCounts.invalid_range || 0),
    missingL2lDistanceRows: Number(skippedCounts.insufficient_previous_sessions || 0),
    missingIntradayRows:
      Number(skippedCounts.missing_intraday_ohlc || 0)
      + Number(skippedCounts.insufficient_intraday_coverage || 0),
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
  const hourlySource = (config.hourlySources || []).find((candidate) => fs.existsSync(candidate.path)) || null;
  if (!source || !hourlySource) {
    if (source && !hourlySource) {
      return buildUnavailableAsset({
        ...config,
        unavailableBlocker: `Daily OHLC is staged but the hourly cache is missing. Stage ${config.hourlySources?.[0]?.path ? path.basename(config.hourlySources[0].path) : "the H1 cache"} via the importer, then rebuild.`
      }, checker);
    }
    return buildUnavailableAsset(config, checker);
  }

  const context = loadCsvOhlc(source, config.allowWeekends);
  const hourlyContext = loadHourlyOhlc(hourlySource);
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

    const hourlyCandles = hourlyContext.byDate.get(evaluationDate) || [];
    if (!hourlyCandles.length) {
      skippedCounts.missing_intraday_ohlc = (skippedCounts.missing_intraday_ohlc || 0) + 1;
      return;
    }
    if (hourlyCandles.length < MIN_HOURLY_CANDLES_PER_DAY) {
      skippedCounts.insufficient_intraday_coverage = (skippedCounts.insufficient_intraday_coverage || 0) + 1;
      return;
    }

    const move = evaluateL2lDirectionalMove({
      direction: directionKey,
      candles: hourlyCandles,
      l2lDistance: adrInputs.targetDistance
    });
    if (move.status !== "MOVED" && move.status !== "NOT_MOVED") {
      skippedCounts[move.reason || "invalid_move_inputs"] = (skippedCounts[move.reason || "invalid_move_inputs"] || 0) + 1;
      return;
    }

    const range = evaluateL2lRangeAvailability({
      direction: directionKey,
      high: adrInputs.evaluationRecord.high,
      low: adrInputs.evaluationRecord.low,
      l2lDistance: adrInputs.targetDistance
    });
    let intradayHigh = -Infinity;
    let intradayLow = Infinity;
    hourlyCandles.forEach((candle) => {
      if (candle.high > intradayHigh) intradayHigh = candle.high;
      if (candle.low < intradayLow) intradayLow = candle.low;
    });

    const outcomeKey = move.moveAchieved ? "WIN" : "LOSS";
    addOutcome(weekdayTotals[weekdayKey], outcomeKey);
    addOutcome(bucketTotals[bucketKey], outcomeKey);
    addOutcome(bucketMatrix[bucketKey][weekdayKey], outcomeKey);

    evaluatedRows.push({
      predictionId: row?.prediction_id || null,
      snapshotDate: row?.snapshot_date || "",
      date: evaluationDate,
      asset: config.assetCode,
      layer: "layer1",
      weekdayKey,
      callDirection: directionKey,
      directionRaw: rawDirection || null,
      confidencePct,
      bucketKey,
      ohlcSource: source.kind,
      ohlcInstrument: source.instrument,
      open: Number.isFinite(adrInputs.evaluationRecord.open) ? adrInputs.evaluationRecord.open : null,
      high: adrInputs.evaluationRecord.high,
      low: adrInputs.evaluationRecord.low,
      close: adrInputs.evaluationRecord.close,
      dayRange: Number((adrInputs.evaluationRecord.high - adrInputs.evaluationRecord.low).toFixed(8)),
      adr20: Number(adrInputs.adr20.toFixed(8)),
      l2lDistance: Number(adrInputs.targetDistance.toFixed(8)),
      maxDirectionalMove: Number(move.maxDirectionalMove.toFixed(8)),
      moveAchieved: move.moveAchieved,
      moveMargin: Number(move.moveMargin.toFixed(8)),
      hourlyCandleCount: move.candlesUsed,
      intradayHigh,
      intradayLow,
      rangeAvailable: range.rangeAvailable === true,
      rangeMargin: Number.isFinite(range.rangeMargin) ? Number(range.rangeMargin.toFixed(8)) : null,
      prev20FirstDate: adrInputs.previousSessions[0]?.date || null,
      prev20LastDate: adrInputs.previousSessions[ADR_WINDOW_SESSIONS - 1]?.date || null,
      prev20Count: adrInputs.previousSessions.length,
      thresholdPct: ADR_THRESHOLD_PCT,
      outcomeKey,
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
    hourlySourceLabel: hourlySource.label,
    hourlySourcePath: path.relative(path.resolve(__dirname, "../.."), hourlySource.path).replace(/\\/g, "/"),
    referencePricePolicy: REFERENCE_PRICE_POLICY,
    sourceCoverage: {
      startDate: context.coverageStart,
      endDate: context.coverageEnd,
      rowCount: context.records.length,
      weekendRowCount: context.weekendRowCount,
      incompleteRowsExcluded: context.incompleteRowsExcluded,
      weekendRowsDropped: context.weekendRowsDropped,
      hourlyRowCount: hourlyContext.rowCount,
      hourlyCoverageStart: hourlyContext.coverageStart,
      hourlyCoverageEnd: hourlyContext.coverageEnd,
      hourlyIncompleteRowsExcluded: hourlyContext.incompleteRowsExcluded
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
      date: evaluatedTargetRow.date,
      pair: config.pairCode,
      layer: "layer2",
      weekdayKey,
      targetDirection,
      usdDirection,
      callDirection: targetDirection,
      combinedConfidencePct,
      bucketKey,
      ohlcSource: evaluatedTargetRow.ohlcSource,
      ohlcInstrument: evaluatedTargetRow.ohlcInstrument,
      open: evaluatedTargetRow.open,
      high: evaluatedTargetRow.high,
      low: evaluatedTargetRow.low,
      close: evaluatedTargetRow.close,
      dayRange: evaluatedTargetRow.dayRange,
      l2lDistance: evaluatedTargetRow.l2lDistance,
      maxDirectionalMove: evaluatedTargetRow.maxDirectionalMove,
      moveAchieved: evaluatedTargetRow.moveAchieved,
      moveMargin: evaluatedTargetRow.moveMargin,
      hourlyCandleCount: evaluatedTargetRow.hourlyCandleCount,
      rangeAvailable: evaluatedTargetRow.rangeAvailable,
      rangeMargin: evaluatedTargetRow.rangeMargin,
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
    if (!row.prev20LastDate || row.prev20LastDate >= row.date) {
      errors.push(`${asset.assetCode} row ${index + 1}: ADR window included look-ahead data`);
    }
    if (Math.abs(row.l2lDistance - (row.adr20 * 0.5)) > 0.000001) {
      errors.push(`${asset.assetCode} row ${index + 1}: L2L distance did not equal 50% ADR20`);
    }
    if (row.high < row.low) {
      errors.push(`${asset.assetCode} row ${index + 1}: day high was below day low`);
    }
    if (Math.abs(row.dayRange - (row.high - row.low)) > 0.000001) {
      errors.push(`${asset.assetCode} row ${index + 1}: day range did not equal high - low`);
    }
    const shouldHaveMoved = row.maxDirectionalMove >= row.l2lDistance - 0.000001;
    if (row.moveAchieved !== shouldHaveMoved || (row.outcomeKey === "WIN") !== shouldHaveMoved) {
      errors.push(`${asset.assetCode} row ${index + 1}: outcome did not match the L2L directional move definition`);
    }
    if (Math.abs(row.moveMargin - (row.maxDirectionalMove - row.l2lDistance)) > 0.000001) {
      errors.push(`${asset.assetCode} row ${index + 1}: move margin did not equal directional move - L2L distance`);
    }
    if (row.hourlyCandleCount < MIN_HOURLY_CANDLES_PER_DAY) {
      errors.push(`${asset.assetCode} row ${index + 1}: evaluated with insufficient hourly coverage`);
    }
    // The guaranteed move can never exceed the day's range (0.2% tolerance for
    // mid-price rounding between the daily and hourly feeds).
    if (row.maxDirectionalMove > row.dayRange * 1.002 + 0.000001) {
      errors.push(`${asset.assetCode} row ${index + 1}: directional move exceeded the day's range`);
    }
    if (row.outcomeKey === "WIN" && !row.rangeAvailable && row.dayRange < row.l2lDistance * 0.998) {
      errors.push(`${asset.assetCode} row ${index + 1}: directional win without the day range containing the L2L distance`);
    }
    if (row.intradayHigh > row.high * 1.002 || row.intradayLow < row.low * 0.998) {
      errors.push(`${asset.assetCode} row ${index + 1}: hourly extremes fell outside the daily range tolerance`);
    }
    if (row.callDirection !== "BULLISH" && row.callDirection !== "BEARISH") {
      errors.push(`${asset.assetCode} row ${index + 1}: non-directional row leaked into evaluated results`);
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
      l2l_definition: `L2L distance = ${ADR_THRESHOLD_PCT}% of the rolling ADR(${ADR_WINDOW_SESSIONS}) computed from the ${ADR_WINDOW_SESSIONS} completed sessions before the evaluation day.`,
      win_definition: "L2L Move: a call wins when price made a complete move of at least the L2L distance in the direction of the call at some point during the trading day, verified from 1-hour candles. A midday swing counts even if the day trends the other way before and after it; sub-L2L swings in the call direction never count. The close is irrelevant and the day's open is diagnostic context only. Day range availability (high - low >= L2L) is kept per row as context; it is necessary but not sufficient for a win.",
      intraday_granularity: "H1",
      directional_move_note: DIRECTIONAL_MOVE_NOTE,
      range_availability_note: RANGE_AVAILABILITY_NOTE,
      reference_price_policy: REFERENCE_PRICE_POLICY,
      diagnostics: {
        unsupportedInstruments: layer1Assets
          .filter(asset => !asset.available)
          .map(asset => ({ assetCode: asset.assetCode, blocker: asset.blocker })),
        layer1: Object.fromEntries(layer1Assets.map(asset => [asset.assetCode, {
          missingOhlcRows: asset.diagnostics.missingOhlcRows,
          missingL2lDistanceRows: asset.diagnostics.missingL2lDistanceRows,
          missingIntradayRows: asset.diagnostics.missingIntradayRows,
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
      hourlySourceLabel: asset.hourlySourceLabel || null,
      hourlySourcePath: asset.hourlySourcePath || null,
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
        bucketMatrix: asset.bucketMatrix,
        evaluatedRows: asset.evaluatedRows
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
        bucketMatrix: pair.bucketMatrix,
        tradableRows: pair.tradableRows
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
