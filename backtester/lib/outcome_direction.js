const MARKET_FLAT_THRESHOLDS = Object.freeze({
  DXY: 0.10,
  EURUSD: 0.20,
  XAUUSD: 0.30,
  QQQ_NQ_PROXY: 0.40,
  BTCUSD: 1.00
});

const MARKET_ALIASES = Object.freeze({
  dxy: "DXY",
  broad_dollar_proxy: "DXY",
  dxy_level: "DXY",
  eurusd: "EURUSD",
  eur_usd: "EURUSD",
  "eur/usd": "EURUSD",
  xauusd: "XAUUSD",
  gold: "XAUUSD",
  "xau/usd": "XAUUSD",
  qqq: "QQQ_NQ_PROXY",
  qqq_nq_proxy: "QQQ_NQ_PROXY",
  nq_proxy: "QQQ_NQ_PROXY",
  btcusd: "BTCUSD",
  btc_usd: "BTCUSD",
  btc: "BTCUSD"
});

function normalizeMarketKey(market) {
  if (!market) {
    throw new Error("Market key is required.");
  }

  const compact = String(market).trim();
  const upper = compact.toUpperCase();
  if (MARKET_FLAT_THRESHOLDS[upper] !== undefined) {
    return upper;
  }

  const aliasKey = compact.toLowerCase().replace(/\s+/g, "_");
  const normalized = MARKET_ALIASES[aliasKey];

  if (!normalized) {
    throw new Error(`Unsupported evaluation market: ${market}`);
  }

  return normalized;
}

function getFlatThreshold(market) {
  const normalized = normalizeMarketKey(market);
  return MARKET_FLAT_THRESHOLDS[normalized];
}

function classifyMarketOutcome(pctChange, marketOrThreshold) {
  if (pctChange === null || pctChange === undefined || !Number.isFinite(Number(pctChange))) {
    return {
      market_outcome_direction: null,
      flat_threshold_used: typeof marketOrThreshold === "number" ? marketOrThreshold : getFlatThreshold(marketOrThreshold),
      result_reason: "pct_change_missing"
    };
  }

  const flatThreshold = typeof marketOrThreshold === "number"
    ? marketOrThreshold
    : getFlatThreshold(marketOrThreshold);
  const numericChange = Number(pctChange);

  if (numericChange > flatThreshold) {
    return {
      market_outcome_direction: "BULLISH",
      flat_threshold_used: flatThreshold,
      result_reason: "pct_change_above_flat_threshold"
    };
  }

  if (numericChange < -flatThreshold) {
    return {
      market_outcome_direction: "BEARISH",
      flat_threshold_used: flatThreshold,
      result_reason: "pct_change_below_negative_flat_threshold"
    };
  }

  return {
    market_outcome_direction: "FLAT",
    flat_threshold_used: flatThreshold,
    result_reason: "pct_change_inside_flat_band"
  };
}

function normalizeAgentDirection(direction) {
  if (!direction) return null;
  const normalized = String(direction).trim().toUpperCase();

  if (normalized.includes("BULLISH")) return "BULLISH";
  if (normalized.includes("BEARISH")) return "BEARISH";
  if (normalized === "NO_CLEAR_BIAS") return "NO_CLEAR_BIAS";

  return normalized;
}

function scoreEvaluationResult({ agentDirection, marketOutcomeDirection, notEvaluableReason = null }) {
  if (notEvaluableReason) {
    return {
      result: "NOT_EVALUABLE",
      result_reason: notEvaluableReason
    };
  }

  const normalizedAgent = normalizeAgentDirection(agentDirection);

  if (!normalizedAgent || normalizedAgent === "NO_CLEAR_BIAS") {
    return {
      result: "NO_CALL",
      result_reason: "agent_no_clear_bias"
    };
  }

  if (!marketOutcomeDirection) {
    return {
      result: "NOT_EVALUABLE",
      result_reason: "market_outcome_direction_missing"
    };
  }

  if (marketOutcomeDirection === "FLAT") {
    return {
      result: "FLAT",
      result_reason: "market_realised_flat"
    };
  }

  if (normalizedAgent === marketOutcomeDirection) {
    return {
      result: "CORRECT",
      result_reason: "agent_direction_matches_market_outcome"
    };
  }

  return {
    result: "WRONG",
    result_reason: "agent_direction_opposes_market_outcome"
  };
}

function classifyMoveMagnitude(absPctChange, flatThreshold) {
  if (absPctChange === null || absPctChange === undefined || !Number.isFinite(Number(absPctChange))) {
    return null;
  }

  const absolute = Number(absPctChange);
  if (absolute <= flatThreshold) return "FLAT_NOISE";
  if (absolute <= flatThreshold * 2) return "SMALL_MOVE";
  if (absolute <= flatThreshold * 4) return "MEDIUM_MOVE";
  return "LARGE_MOVE";
}

function classifyConvictionBucket(conviction) {
  if (conviction === null || conviction === undefined || !Number.isFinite(Number(conviction))) {
    return "UNKNOWN_CONVICTION";
  }

  const numeric = Number(conviction);
  if (numeric < 55) return "LOW_CONVICTION";
  if (numeric < 70) return "MODERATE_CONVICTION";
  if (numeric < 85) return "HIGH_CONVICTION";
  return "VERY_HIGH_CONVICTION";
}

function expectedMoveThreshold(flatThreshold, convictionBucket) {
  if (convictionBucket === "LOW_CONVICTION") return flatThreshold * 1;
  if (convictionBucket === "MODERATE_CONVICTION") return flatThreshold * 2;
  if (convictionBucket === "HIGH_CONVICTION") return flatThreshold * 3;
  if (convictionBucket === "VERY_HIGH_CONVICTION") return flatThreshold * 4;
  return flatThreshold;
}

function classifyEvaluationQuality(result, moveMagnitudeBucket) {
  if (result === "CORRECT" && (moveMagnitudeBucket === "MEDIUM_MOVE" || moveMagnitudeBucket === "LARGE_MOVE")) {
    return "EXCELLENT";
  }

  if (result === "CORRECT" && moveMagnitudeBucket === "SMALL_MOVE") {
    return "GOOD";
  }

  if (result === "CORRECT" && moveMagnitudeBucket === "FLAT_NOISE") {
    return "WEAK_CORRECT";
  }

  if (result === "WRONG") return "WRONG";
  if (result === "FLAT") return "FLAT";
  if (result === "NO_CALL") return "NO_CALL";
  if (result === "NOT_EVALUABLE") return "NOT_EVALUABLE";
  if (result === "MIXED") return "MIXED";

  return null;
}

function classifyConvictionMoveAlignment({ convictionBucket, moveMagnitudeBucket, result }) {
  if (
    (convictionBucket === "HIGH_CONVICTION" || convictionBucket === "VERY_HIGH_CONVICTION") &&
    (moveMagnitudeBucket === "MEDIUM_MOVE" || moveMagnitudeBucket === "LARGE_MOVE") &&
    result === "CORRECT"
  ) {
    return "ALIGNED_STRONG";
  }

  if (
    convictionBucket === "MODERATE_CONVICTION" &&
    (moveMagnitudeBucket === "SMALL_MOVE" || moveMagnitudeBucket === "MEDIUM_MOVE") &&
    result === "CORRECT"
  ) {
    return "ALIGNED_MODEST";
  }

  if (
    (convictionBucket === "HIGH_CONVICTION" || convictionBucket === "VERY_HIGH_CONVICTION") &&
    (moveMagnitudeBucket === "FLAT_NOISE" || result === "WRONG")
  ) {
    return "OVERCONFIDENT";
  }

  if (
    (convictionBucket === "LOW_CONVICTION" || convictionBucket === "MODERATE_CONVICTION") &&
    moveMagnitudeBucket === "LARGE_MOVE" &&
    result === "CORRECT"
  ) {
    return "UNDERCONFIDENT";
  }

  return "NEUTRAL";
}

function combineEvaluationResults(results) {
  const unique = Array.from(new Set(results.filter(Boolean)));

  if (!unique.length) {
    return {
      result: "NOT_EVALUABLE",
      result_reason: "no_market_evaluation_rows"
    };
  }

  if (unique.length === 1) {
    return {
      result: unique[0],
      result_reason: "single_consistent_market_result"
    };
  }

  if (unique.includes("CORRECT") && unique.includes("WRONG")) {
    return {
      result: "MIXED",
      result_reason: "market_evaluations_conflict"
    };
  }

  if (unique.every((value) => value === "FLAT" || value === "CORRECT")) {
    return {
      result: "MIXED",
      result_reason: "some_markets_flat_some_correct"
    };
  }

  if (unique.every((value) => value === "FLAT" || value === "WRONG")) {
    return {
      result: "MIXED",
      result_reason: "some_markets_flat_some_wrong"
    };
  }

  return {
    result: "MIXED",
    result_reason: "heterogeneous_market_results"
  };
}

module.exports = {
  MARKET_FLAT_THRESHOLDS,
  classifyMarketOutcome,
  classifyMoveMagnitude,
  classifyConvictionBucket,
  classifyConvictionMoveAlignment,
  classifyEvaluationQuality,
  combineEvaluationResults,
  expectedMoveThreshold,
  getFlatThreshold,
  normalizeAgentDirection,
  normalizeMarketKey,
  scoreEvaluationResult
};
