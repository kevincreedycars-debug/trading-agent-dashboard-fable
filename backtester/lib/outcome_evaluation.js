const {
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
} = require("./outcome_direction");
const { getPhase1OutcomeWindow, normalizePhase1Timeframe } = require("./timeframe_windows");

const PHASE1_ASSET_MARKET_MAPPINGS = Object.freeze({
  USD: [
    { evaluated_market: "DXY", market_relationship: "direct", evaluation_mode: "primary" },
    { evaluated_market: "EURUSD", market_relationship: "inverse", evaluation_mode: "primary" },
    { evaluated_market: "XAUUSD", market_relationship: "inverse", evaluation_mode: "contextual" },
    { evaluated_market: "BTCUSD", market_relationship: "inverse", evaluation_mode: "contextual" },
    { evaluated_market: "QQQ_NQ_PROXY", market_relationship: "contextual", evaluation_mode: "contextual" }
  ],
  EUR: [
    { evaluated_market: "EURUSD", market_relationship: "direct", evaluation_mode: "primary" }
  ],
  GOLD: [
    { evaluated_market: "XAUUSD", market_relationship: "direct", evaluation_mode: "primary" }
  ],
  NQ: [
    { evaluated_market: "QQQ_NQ_PROXY", market_relationship: "direct", evaluation_mode: "primary" }
  ],
  BTC: [
    { evaluated_market: "BTCUSD", market_relationship: "direct", evaluation_mode: "primary" }
  ]
});

function normalizeAssetCode(assetCode) {
  const normalized = String(assetCode || "").trim().toUpperCase();
  if (!PHASE1_ASSET_MARKET_MAPPINGS[normalized]) {
    throw new Error(`Unsupported Phase 1 asset code: ${assetCode}`);
  }
  return normalized;
}

function computePctChange(openPrice, closePrice) {
  const open = Number(openPrice);
  const close = Number(closePrice);

  if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) {
    return null;
  }

  return ((close - open) / open) * 100;
}

function invertDirection(direction) {
  if (direction === "BULLISH") return "BEARISH";
  if (direction === "BEARISH") return "BULLISH";
  return direction;
}

function evaluateSingleMarket({
  assetCode,
  timeframe,
  callDate,
  callTimeEt,
  agentDirection,
  agentConviction,
  evaluatedMarket,
  openPrice,
  closePrice,
  evaluationVersion,
  marketRelationship = "direct",
  evaluationMode = "primary"
}) {
  const normalizedAsset = normalizeAssetCode(assetCode);
  const normalizedTimeframe = normalizePhase1Timeframe(timeframe);
  const normalizedMarket = normalizeMarketKey(evaluatedMarket);
  const window = getPhase1OutcomeWindow({
    assetCode: normalizedAsset,
    timeframe: normalizedTimeframe,
    callDate,
    callTimeEt
  });
  const pctChange = computePctChange(openPrice, closePrice);
  const absPctChange = pctChange === null ? null : Math.abs(pctChange);
  const marketOutcome = classifyMarketOutcome(pctChange, normalizedMarket);
  const comparableMarketDirection = marketRelationship === "inverse"
    ? invertDirection(marketOutcome.market_outcome_direction)
    : marketOutcome.market_outcome_direction;
  const flatThresholdUsed = getFlatThreshold(normalizedMarket);
  const convictionBucket = classifyConvictionBucket(agentConviction);
  const moveMagnitudeBucket = classifyMoveMagnitude(absPctChange, flatThresholdUsed);
  const expectedThreshold = expectedMoveThreshold(flatThresholdUsed, convictionBucket);
  const exceededExpectedMove = absPctChange === null ? null : absPctChange >= expectedThreshold;
  const scored = scoreEvaluationResult({
    agentDirection,
    marketOutcomeDirection: comparableMarketDirection,
    notEvaluableReason: window.not_evaluable_reason
  });
  const evaluationQuality = classifyEvaluationQuality(scored.result, moveMagnitudeBucket);
  const convictionMoveAlignment = classifyConvictionMoveAlignment({
    convictionBucket,
    moveMagnitudeBucket,
    result: scored.result
  });

  return {
    asset_code: normalizedAsset,
    evaluated_market: normalizedMarket,
    timeframe: normalizedTimeframe,
    call_date: callDate,
    call_day_of_week: window.call_day_of_week,
    call_time_et: window.call_time_et,
    call_time_et_local: window.call_time_et_local,
    open_time_et: window.open_time_et,
    open_time_et_local: window.open_time_et_local,
    close_time_et: window.close_time_et,
    close_time_et_local: window.close_time_et_local,
    open_price: Number.isFinite(Number(openPrice)) ? Number(openPrice) : null,
    close_price: Number.isFinite(Number(closePrice)) ? Number(closePrice) : null,
    pct_change: pctChange,
    abs_pct_change: absPctChange,
    flat_threshold_used: flatThresholdUsed,
    move_magnitude_bucket: moveMagnitudeBucket,
    conviction_bucket: convictionBucket,
    conviction_move_alignment: convictionMoveAlignment,
    evaluation_quality: evaluationQuality,
    expected_move_threshold: expectedThreshold,
    exceeded_expected_move: exceededExpectedMove,
    calibration_notes: null,
    market_outcome_direction: marketOutcome.market_outcome_direction,
    comparable_market_direction: comparableMarketDirection,
    agent_direction: normalizeAgentDirection(agentDirection),
    agent_conviction: agentConviction === undefined || agentConviction === null ? null : Number(agentConviction),
    result: scored.result,
    result_reason: scored.result_reason,
    evaluation_version: evaluationVersion,
    evaluation_mode: evaluationMode,
    market_relationship: marketRelationship,
    evaluable: window.evaluable
  };
}

function evaluatePhase1AssetAgainstConfiguredMarkets({
  assetCode,
  timeframe,
  callDate,
  callTimeEt,
  agentDirection,
  agentConviction,
  pricesByMarket,
  evaluationVersion
}) {
  const normalizedAsset = normalizeAssetCode(assetCode);
  const marketMappings = PHASE1_ASSET_MARKET_MAPPINGS[normalizedAsset];

  const evaluations = marketMappings.map((mapping) => {
    const marketPrices = pricesByMarket?.[mapping.evaluated_market] || {};
    return evaluateSingleMarket({
      assetCode: normalizedAsset,
      timeframe,
      callDate,
      callTimeEt,
      agentDirection,
      agentConviction,
      evaluatedMarket: mapping.evaluated_market,
      openPrice: marketPrices.open_price,
      closePrice: marketPrices.close_price,
      evaluationVersion,
      marketRelationship: mapping.market_relationship,
      evaluationMode: mapping.evaluation_mode
    });
  });

  return {
    evaluations,
    combined: combineEvaluationResults(evaluations.map((row) => row.result))
  };
}

module.exports = {
  PHASE1_ASSET_MARKET_MAPPINGS,
  computePctChange,
  evaluatePhase1AssetAgainstConfiguredMarkets,
  evaluateSingleMarket,
  invertDirection,
  normalizeAssetCode
};
