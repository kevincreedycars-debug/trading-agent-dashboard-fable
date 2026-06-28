#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  fetchAllRows,
  fetchJson,
  getSupabaseHeaders,
  parseArgs,
  requireEnv
} = require("../../lib/historical_common");

const REPLAY_VERSION = "usd_historical_replay_v2";
const SOURCE_WORKFLOW = "usd_historical_replay";
const LOGIC_DOCUMENT = "agent_usd_direction.md";

const FACTOR_WEIGHTS = Object.freeze({
  "F1 VIX": 10,
  "F2 US 2Y Yield Delta": 14,
  "F3 US-DE 2Y Spread Delta": 16,
  "F4 US 10Y Real Yield Delta": 14,
  "F5 DXY Delta": 6,
  "F6 Gold Delta": 5,
  "F7 US Economic Surprise": 3,
  "F8 Fed Bias": 18,
  "F9 Dollar Smile": 12,
  "F10 Equity Regime": 2
});

const TIMEFRAME_CONFIG = Object.freeze({
  following_24hrs: {
    timeframe: "following 24hrs",
    legacy_timeframe_key: "following_24hrs"
  },
  "3d_from_call": {
    timeframe: "3d from call",
    legacy_timeframe_key: "3d_from_call"
  },
  current_week: {
    timeframe: "current week",
    legacy_timeframe_key: "current_week"
  },
  current_month: {
    timeframe: "current month",
    legacy_timeframe_key: "current_month"
  }
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseLogicVersion() {
  const logicPath = path.resolve(__dirname, "../../../logic/agent_usd_direction.md");
  const text = fs.readFileSync(logicPath, "utf8");
  const explicitMachineVersion = text.match(/"logic_document_version":\s*"([^"]+)"/);
  if (explicitMachineVersion) {
    return explicitMachineVersion[1];
  }

  const headlineVersion = text.match(/\*\*Version:\*\*\s*([^\r\n]+)/i);
  if (headlineVersion) {
    return String(headlineVersion[1]).trim();
  }

  return "unknown";
}

function normalizeSnapshotPayload(row) {
  const keys = [
    "snapshot_date",
    "us_2y_yield",
    "us_2y_d5_bps",
    "us_2y_d20_bps",
    "us_de_2y_spread",
    "us_de_2y_spread_d5_bps",
    "us_10y_real_yield",
    "us_10y_real_yield_d5_bps",
    "us_10y_real_yield_d20_bps",
    "us_10y_yield",
    "us_10y_d5_bps",
    "vix_level",
    "vix_d1",
    "vix_d5",
    "dxy_level",
    "dxy_d1",
    "dxy_d5",
    "dxy_d20",
    "gold_price",
    "gold_d1_pct",
    "gold_d5_pct",
    "gold_d20_pct",
    "nq_price",
    "nq_d1_pct",
    "nq_d5_pct",
    "nq_d20_pct",
    "equities_regime",
    "latest_us_event",
    "surprise_score",
    "fed_bias",
    "warnings",
    "missing_inputs",
    "global_growth_context"
  ];

  return keys.reduce((accumulator, key) => {
    accumulator[key] = row[key] ?? null;
    return accumulator;
  }, {});
}

function directionFromSignedValue(value, positiveDirection, negativeDirection, threshold = 0) {
  if (value === null) return null;
  if (value > threshold) return positiveDirection;
  if (value < -threshold) return negativeDirection;
  return "NEUTRAL";
}

function formatEvidence(label, value, suffix = "") {
  return value === null ? `${label}: missing` : `${label}: ${value}${suffix}`;
}

function selectSeriesValue(snapshot, keyMap) {
  for (const key of keyMap) {
    const value = toNumber(snapshot[key]);
    if (value !== null) {
      return { key, value };
    }
  }
  return { key: keyMap[0], value: null };
}

function factorSignal(snapshot, timeframeKey) {
  const selectedDxy = timeframeKey === "following_24hrs"
    ? selectSeriesValue(snapshot, ["dxy_d1", "dxy_d5"])
    : timeframeKey === "current_month"
      ? selectSeriesValue(snapshot, ["dxy_d20", "dxy_d5"])
      : selectSeriesValue(snapshot, ["dxy_d5", "dxy_d1"]);

  const selectedGold = timeframeKey === "following_24hrs"
    ? selectSeriesValue(snapshot, ["gold_d1_pct", "gold_d5_pct"])
    : timeframeKey === "current_month"
      ? selectSeriesValue(snapshot, ["gold_d20_pct", "gold_d5_pct"])
      : selectSeriesValue(snapshot, ["gold_d5_pct", "gold_d1_pct"]);

  const selectedNq = timeframeKey === "following_24hrs"
    ? selectSeriesValue(snapshot, ["nq_d1_pct", "nq_d5_pct"])
    : timeframeKey === "current_month"
      ? selectSeriesValue(snapshot, ["nq_d20_pct", "nq_d5_pct"])
      : selectSeriesValue(snapshot, ["nq_d5_pct", "nq_d1_pct"]);

  const selectedUs2y = timeframeKey === "current_month"
    ? selectSeriesValue(snapshot, ["us_2y_d20_bps", "us_2y_d5_bps"])
    : selectSeriesValue(snapshot, ["us_2y_d5_bps"]);

  const selectedRealYield = timeframeKey === "current_month"
    ? selectSeriesValue(snapshot, ["us_10y_real_yield_d20_bps", "us_10y_real_yield_d5_bps"])
    : selectSeriesValue(snapshot, ["us_10y_real_yield_d5_bps"]);

  const selectedVixDelta = timeframeKey === "following_24hrs"
    ? selectSeriesValue(snapshot, ["vix_d1", "vix_d5"])
    : selectSeriesValue(snapshot, ["vix_d5", "vix_d1"]);

  const factors = {};
  const missingInputs = new Set();
  const warnings = new Set(asArray(snapshot.warnings).filter(Boolean));

  const vixLevel = toNumber(snapshot.vix_level);
  let f1Signal = "NEUTRAL";
  let f1Reason = "VIX regime not directional.";
  if (vixLevel === null) {
    missingInputs.add("vix_level");
    f1Reason = "Missing vix_level.";
  } else if (vixLevel > 25) {
    f1Signal = "BULLISH";
    f1Reason = "VIX above 25 signals USD-safe-haven demand.";
  } else if (vixLevel < 16) {
    f1Signal = "BEARISH";
    f1Reason = "VIX below 16 signals risk-on pressure on USD.";
  } else if (selectedVixDelta.value !== null) {
    if (selectedVixDelta.value > 1) {
      f1Signal = "BULLISH";
      f1Reason = "VIX delta points to rising risk aversion.";
    } else if (selectedVixDelta.value < -1) {
      f1Signal = "BEARISH";
      f1Reason = "VIX delta points to easing risk aversion.";
    }
  }
  factors["F1 VIX"] = {
    signal: f1Signal,
    weight: FACTOR_WEIGHTS["F1 VIX"],
    evidence: `${formatEvidence("vix_level", vixLevel)}; ${formatEvidence(selectedVixDelta.key, selectedVixDelta.value)}`,
    reason: f1Reason
  };

  const f2Signal = directionFromSignedValue(selectedUs2y.value, "BULLISH", "BEARISH", 5);
  if (selectedUs2y.value === null) missingInputs.add(selectedUs2y.key);
  factors["F2 US 2Y Yield Delta"] = {
    signal: f2Signal || "NEUTRAL",
    weight: FACTOR_WEIGHTS["F2 US 2Y Yield Delta"],
    evidence: formatEvidence(selectedUs2y.key, selectedUs2y.value, " bps"),
    reason: selectedUs2y.value === null
      ? `Missing ${selectedUs2y.key}.`
      : "US 2Y delta proxies Fed repricing."
  };

  const spreadD5 = toNumber(snapshot.us_de_2y_spread_d5_bps);
  if (spreadD5 === null) missingInputs.add("us_de_2y_spread_d5_bps");
  factors["F3 US-DE 2Y Spread Delta"] = {
    signal: directionFromSignedValue(spreadD5, "BULLISH", "BEARISH", 5) || "NEUTRAL",
    weight: FACTOR_WEIGHTS["F3 US-DE 2Y Spread Delta"],
    evidence: formatEvidence("us_de_2y_spread_d5_bps", spreadD5, " bps"),
    reason: spreadD5 === null
      ? "Missing US-DE spread delta."
      : "Relative-rate widening supports USD."
  };

  const f4Signal = directionFromSignedValue(selectedRealYield.value, "BULLISH", "BEARISH", 5);
  if (selectedRealYield.value === null) missingInputs.add(selectedRealYield.key);
  factors["F4 US 10Y Real Yield Delta"] = {
    signal: f4Signal || "NEUTRAL",
    weight: FACTOR_WEIGHTS["F4 US 10Y Real Yield Delta"],
    evidence: formatEvidence(selectedRealYield.key, selectedRealYield.value, " bps"),
    reason: selectedRealYield.value === null
      ? `Missing ${selectedRealYield.key}.`
      : "Real-yield delta is a core USD driver."
  };

  const f5Signal = directionFromSignedValue(selectedDxy.value, "BULLISH", "BEARISH", 0.30);
  if (selectedDxy.value === null) missingInputs.add(selectedDxy.key);
  factors["F5 DXY Delta"] = {
    signal: f5Signal || "NEUTRAL",
    weight: FACTOR_WEIGHTS["F5 DXY Delta"],
    evidence: formatEvidence(selectedDxy.key, selectedDxy.value, "%"),
    reason: selectedDxy.value === null
      ? `Missing ${selectedDxy.key}.`
      : "DXY confirms whether USD strength is already expressed."
  };

  let f6Signal = "NEUTRAL";
  if (selectedGold.value === null) {
    missingInputs.add(selectedGold.key);
  } else if (selectedGold.value < 0) {
    f6Signal = "BULLISH";
  } else if (selectedGold.value > 0) {
    f6Signal = "BEARISH";
  }
  factors["F6 Gold Delta"] = {
    signal: f6Signal,
    weight: FACTOR_WEIGHTS["F6 Gold Delta"],
    evidence: formatEvidence(selectedGold.key, selectedGold.value, "%"),
    reason: selectedGold.value === null
      ? `Missing ${selectedGold.key}.`
      : "Gold acts as an anti-USD confirmation input."
  };

  const latestEvent = snapshot.latest_us_event || null;
  const surprise = latestEvent?.surprise || latestEvent?.surprise_direction || null;
  const ageHours = toNumber(latestEvent?.age_hours ?? snapshot.latest_us_event_age_hours);
  let f7Signal = "NEUTRAL";
  if (!latestEvent) {
    missingInputs.add("latest_us_event");
  } else if (ageHours !== null && ageHours <= 72) {
    if (surprise === "positive") f7Signal = "BULLISH";
    if (surprise === "negative") f7Signal = "BEARISH";
  }
  factors["F7 US Economic Surprise"] = {
    signal: f7Signal,
    weight: FACTOR_WEIGHTS["F7 US Economic Surprise"],
    evidence: latestEvent
      ? `event=${latestEvent.event}; surprise=${surprise || "unknown"}; age_hours=${ageHours ?? "unknown"}`
      : "latest_us_event missing",
    reason: latestEvent
      ? "Recent actual-vs-consensus surprise influences USD direction."
      : "Missing latest_us_event."
  };

  const fedBias = snapshot.fed_bias ? String(snapshot.fed_bias).toLowerCase() : null;
  let f8Signal = "NEUTRAL";
  if (!fedBias || fedBias === "unknown" || fedBias === "neutral") {
    missingInputs.add("fed_bias");
  } else if (fedBias === "hawkish") {
    f8Signal = "BULLISH";
  } else if (fedBias === "dovish") {
    f8Signal = "BEARISH";
  }
  factors["F8 Fed Bias"] = {
    signal: f8Signal,
    weight: FACTOR_WEIGHTS["F8 Fed Bias"],
    evidence: `fed_bias=${fedBias || "missing"}`,
    reason: "Fed repricing is the highest-weight structural USD input."
  };

  let f9Signal = "NEUTRAL";
  if (vixLevel !== null && vixLevel > 25) {
    f9Signal = "BULLISH";
  } else if (fedBias === "hawkish" && surprise === "positive") {
    f9Signal = "BULLISH";
  } else if (vixLevel !== null && vixLevel < 16 && (fedBias === "neutral" || fedBias === "dovish")) {
    f9Signal = "BEARISH";
  }
  factors["F9 Dollar Smile"] = {
    signal: f9Signal,
    weight: FACTOR_WEIGHTS["F9 Dollar Smile"],
    evidence: `vix_level=${vixLevel ?? "missing"}; fed_bias=${fedBias || "missing"}; latest_surprise=${surprise || "missing"}`,
    reason: "Dollar Smile captures risk-off and US-outperformance USD regimes."
  };

  const equitiesRegime = snapshot.equities_regime || null;
  let f10Signal = "NEUTRAL";
  if (!equitiesRegime || selectedNq.value === null) {
    if (!equitiesRegime) missingInputs.add("equities_regime");
    if (selectedNq.value === null) missingInputs.add(selectedNq.key);
  } else if (equitiesRegime === "risk_on") {
    if (selectedNq.value > 0) f10Signal = "BEARISH";
    if (selectedNq.value < 0) f10Signal = "BULLISH";
  } else if (equitiesRegime === "risk_off" && selectedNq.value < 0) {
    f10Signal = "BULLISH";
  }
  factors["F10 Equity Regime"] = {
    signal: f10Signal,
    weight: FACTOR_WEIGHTS["F10 Equity Regime"],
    evidence: `equities_regime=${equitiesRegime || "missing"}; ${formatEvidence(selectedNq.key, selectedNq.value, "%")}`,
    reason: "NQ acts as a low-weight regime confirmation input for USD."
  };

  return {
    factors,
    warnings: Array.from(warnings),
    missingInputs: Array.from(missingInputs)
  };
}

function computeWeightedSummary(factors) {
  let bullishWeight = 0;
  let bearishWeight = 0;
  let neutralWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const factor of Object.values(factors)) {
    if (factor.signal === "BULLISH") {
      bullishWeight += factor.weight;
      bullishCount += 1;
    } else if (factor.signal === "BEARISH") {
      bearishWeight += factor.weight;
      bearishCount += 1;
    } else {
      neutralWeight += factor.weight;
      neutralCount += 1;
    }
  }

  return {
    bullish_weight: bullishWeight,
    bearish_weight: bearishWeight,
    neutral_weight: neutralWeight,
    active_weight: bullishWeight + bearishWeight,
    weight_margin: Math.abs(bullishWeight - bearishWeight),
    bullish_count: bullishCount,
    bearish_count: bearishCount,
    neutral_count: neutralCount
  };
}

function determineDirection(snapshot, timeframeKey, weighted, factors) {
  if (weighted.bullish_weight === 0 && weighted.bearish_weight === 0) {
    return {
      direction: "NO_CLEAR_BIAS",
      via_tiebreak: false,
      tiebreak_reason: "no_directional_evidence"
    };
  }

  if (weighted.bullish_weight > weighted.bearish_weight) {
    return { direction: "BULLISH", via_tiebreak: false, tiebreak_reason: null };
  }

  if (weighted.bearish_weight > weighted.bullish_weight) {
    return { direction: "BEARISH", via_tiebreak: false, tiebreak_reason: null };
  }

  const tiebreakSeries = [
    timeframeKey === "following_24hrs"
      ? { label: "dxy_d1", value: toNumber(snapshot.dxy_d1), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" }
      : timeframeKey === "current_month"
        ? { label: "dxy_d20", value: toNumber(snapshot.dxy_d20 ?? snapshot.dxy_d5), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" }
        : { label: "dxy_d5", value: toNumber(snapshot.dxy_d5), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" },
    timeframeKey === "current_month"
      ? { label: "us_2y_d20_bps", value: toNumber(snapshot.us_2y_d20_bps ?? snapshot.us_2y_d5_bps), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" }
      : { label: "us_2y_d5_bps", value: toNumber(snapshot.us_2y_d5_bps), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" },
    timeframeKey === "current_month"
      ? { label: "us_10y_real_yield_d20_bps", value: toNumber(snapshot.us_10y_real_yield_d20_bps ?? snapshot.us_10y_real_yield_d5_bps), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" }
      : { label: "us_10y_real_yield_d5_bps", value: toNumber(snapshot.us_10y_real_yield_d5_bps), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" },
    timeframeKey === "following_24hrs"
      ? { label: "vix_d1", value: toNumber(snapshot.vix_d1), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" }
      : { label: "vix_d5", value: toNumber(snapshot.vix_d5), positive: "BULLISH_LEAN", negative: "BEARISH_LEAN" }
  ];

  for (const series of tiebreakSeries) {
    if (series.value === null || series.value === 0) continue;
    return {
      direction: series.value > 0 ? series.positive : series.negative,
      via_tiebreak: true,
      tiebreak_reason: series.label
    };
  }

  return {
    direction: "NO_CLEAR_BIAS",
    via_tiebreak: true,
    tiebreak_reason: "no_flat_breaker"
  };
}

function convictionStrengthLabel(conviction) {
  if (conviction <= 55) return "Very Weak";
  if (conviction <= 64) return "Weak";
  if (conviction <= 74) return "Moderate";
  if (conviction <= 84) return "Strong";
  return "Very Strong";
}

function deriveLiveConfidenceStrength(confidence, netEdge, participation, direction) {
  if (direction === "NO_CALL" || direction === "NO 24H CALL") return "NO_CALL";
  if (confidence === null || confidence === undefined) return "PENDING";

  const edge = Math.abs(Number(netEdge) || 0);
  const active = Number(participation) || 0;

  if (confidence >= 80 && edge >= 25 && active >= 50) return "VERY_STRONG";
  if (confidence >= 65 && edge >= 18 && active >= 35) return "STRONG";
  if (confidence >= 50 && edge >= 10 && active >= 25) return "MODERATE";
  if (confidence > 0) return "WEAK";
  return "NO_CALL";
}

function computeLiveHeadlineConfidence({
  bullCase,
  bearCase,
  participation,
  netEdge,
  direction,
  warnings = [],
  missingInputs = [],
  weeklyCandleStatus = ""
}) {
  const safeBullCase = toNumber(bullCase);
  const safeBearCase = toNumber(bearCase);
  const safeParticipation = toNumber(participation);
  const safeNetEdge = toNumber(netEdge);

  if ([safeBullCase, safeBearCase, safeParticipation, safeNetEdge].some((value) => value === null)) {
    return {
      value: null,
      strength: deriveLiveConfidenceStrength(null, safeNetEdge, safeParticipation, direction)
    };
  }

  let confidence =
    ((Math.max(safeBullCase, safeBearCase) / 100) * 0.45) +
    ((safeParticipation / 100) * 0.35) +
    ((Math.abs(safeNetEdge) / 100) * 0.20);

  if (safeParticipation < 40) confidence -= 0.10;
  if (safeParticipation < 25) confidence -= 0.20;
  if (Math.abs(safeNetEdge) < 20) confidence -= 0.10;

  const missingCount = asArray(missingInputs).filter(Boolean).length;
  if (missingCount >= 3) confidence -= 0.05;
  if (missingCount >= 6) confidence -= 0.10;

  const flagText = asArray(warnings).join(" ").toLowerCase();
  const weeklyStatus = String(weeklyCandleStatus || "").toLowerCase();

  if (
    flagText.includes("event risk") ||
    flagText.includes("high impact event") ||
    flagText.includes("tier 1 event")
  ) {
    confidence -= 0.10;
  }

  if (weeklyStatus === "consolidating" || flagText.includes("weekly consolidation")) {
    confidence -= 0.05;
  }

  if (
    flagText.includes("conviction audit") ||
    flagText.includes("audit flag") ||
    flagText.includes("audit warning")
  ) {
    confidence -= 0.05;
  }

  if (flagText.includes("o layer")) confidence -= 0.05;
  if (flagText.includes("adr warning") || flagText.includes("session warning")) confidence -= 0.05;

  const finalConfidence = Math.round(clamp(confidence, 0, 1) * 100);

  return {
    value: finalConfidence,
    strength: deriveLiveConfidenceStrength(finalConfidence, safeNetEdge, safeParticipation, direction)
  };
}

function computeConviction(snapshot, timeframeKey, weighted, factors, directionInfo, missingInputs) {
  const primaryKeys = [
    "F2 US 2Y Yield Delta",
    "F3 US-DE 2Y Spread Delta",
    "F4 US 10Y Real Yield Delta",
    "F5 DXY Delta",
    "F7 US Economic Surprise",
    "F8 Fed Bias"
  ];

  const primarySignals = primaryKeys
    .map((key) => factors[key]?.signal)
    .filter((signal) => signal === "BULLISH" || signal === "BEARISH");
  const primaryBull = primarySignals.filter((signal) => signal === "BULLISH").length;
  const primaryBear = primarySignals.filter((signal) => signal === "BEARISH").length;
  const primaryConflict = primaryBull > 0 && primaryBear > 0;

  const dxySignal = factors["F5 DXY Delta"]?.signal;
  const rateSignals = [
    factors["F2 US 2Y Yield Delta"]?.signal,
    factors["F3 US-DE 2Y Spread Delta"]?.signal,
    factors["F4 US 10Y Real Yield Delta"]?.signal
  ].filter((signal) => signal === "BULLISH" || signal === "BEARISH");
  const rateMajority = rateSignals.length
    ? rateSignals.filter((signal) => signal === "BULLISH").length >= rateSignals.filter((signal) => signal === "BEARISH").length
      ? "BULLISH"
      : "BEARISH"
    : null;

  const fedSignal = factors["F8 Fed Bias"]?.signal;
  const dxyRatesConflict = dxySignal && rateMajority && dxySignal !== rateMajority;
  const fedRatesConflict = fedSignal && rateMajority && fedSignal !== rateMajority && fedSignal !== "NEUTRAL";

  const weightedEdge = Math.abs(weighted.bullish_weight - weighted.bearish_weight) / 100;
  let conviction = 50 + (weightedEdge * 50);

  let participationCap = 92;
  if (weighted.active_weight < 30) participationCap = 55;
  else if (weighted.active_weight < 50) participationCap = 62;
  else if (weighted.active_weight < 70) participationCap = 72;
  else if (weighted.active_weight < 85) participationCap = 82;
  conviction = Math.min(conviction, participationCap);

  let missingPenalty = 0;
  if (missingInputs.length >= 5) missingPenalty = 12;
  else if (missingInputs.length >= 3) missingPenalty = 7;
  else if (missingInputs.length >= 1) missingPenalty = 3;
  conviction -= missingPenalty;

  let conflictPenalty = 0;
  if (primaryConflict) conflictPenalty += 5;
  if (dxyRatesConflict) conflictPenalty += 5;
  if (fedRatesConflict) conflictPenalty += 5;
  conviction -= conflictPenalty;

  const agreementBoosts = [];
  if (weighted.active_weight >= 50 && dxySignal && rateMajority && dxySignal === rateMajority) {
    conviction = Math.max(conviction, 65);
    agreementBoosts.push("dxy_and_rates_agree");
  }
  if (
    weighted.active_weight >= 60 &&
    fedSignal &&
    fedSignal !== "NEUTRAL" &&
    rateMajority &&
    fedSignal === rateMajority
  ) {
    conviction = Math.max(conviction, 70);
    agreementBoosts.push("fed_rates_real_yield_agree");
  }
  if (
    toNumber(snapshot.vix_level) !== null &&
    toNumber(snapshot.vix_level) > 25 &&
    dxySignal === "BULLISH" &&
    rateMajority === "BULLISH"
  ) {
    conviction = Math.max(conviction, 80);
    agreementBoosts.push("crisis_regime_confirmation");
  }

  conviction = Math.round(clamp(conviction, 50, 100));

  return {
    final_conviction: conviction,
    confidence_strength: convictionStrengthLabel(conviction),
    participation_cap: participationCap,
    missing_input_penalty: missingPenalty,
    conflict_penalty: conflictPenalty,
    agreement_boosts: agreementBoosts,
    primary_conflict: primaryConflict,
    dxy_rates_conflict: dxyRatesConflict,
    fed_rates_conflict: fedRatesConflict,
    final_conviction_logic: {
      weighted_edge: weightedEdge,
      active_weight: weighted.active_weight,
      via_tiebreak: directionInfo.via_tiebreak,
      tiebreak_reason: directionInfo.tiebreak_reason
    }
  };
}

function buildPrediction(snapshot, timeframeKey, logicDocumentVersion) {
  const { factors, warnings, missingInputs } = factorSignal(snapshot, timeframeKey);
  const weighted = computeWeightedSummary(factors);
  const directionInfo = determineDirection(snapshot, timeframeKey, weighted, factors);
  const legacyConvictionModel = computeConviction(snapshot, timeframeKey, weighted, factors, directionInfo, missingInputs);

  let direction = directionInfo.direction;
  const needsLean = (
    direction === "BULLISH" || direction === "BEARISH"
  ) && (
    weighted.active_weight < 50 ||
    weighted.weight_margin < 15 ||
    legacyConvictionModel.primary_conflict ||
    directionInfo.via_tiebreak ||
    legacyConvictionModel.final_conviction < 65 ||
    missingInputs.length > 0
  );

  if (needsLean) {
    direction = direction === "BULLISH" ? "BULLISH_LEAN" : "BEARISH_LEAN";
  }

  const bullCase = weighted.bullish_weight;
  const bearCase = weighted.bearish_weight;
  const neutralPct = 100 - weighted.active_weight;
  const netEdge = weighted.bullish_weight - weighted.bearish_weight;
  const liveConfidence = computeLiveHeadlineConfidence({
    bullCase,
    bearCase,
    participation: weighted.active_weight,
    netEdge,
    direction,
    warnings,
    missingInputs,
    weeklyCandleStatus: snapshot.weekly_candle_status || null
  });

  return {
    timeframe: TIMEFRAME_CONFIG[timeframeKey].timeframe,
    legacy_timeframe_key: TIMEFRAME_CONFIG[timeframeKey].legacy_timeframe_key,
    predicted_direction: direction,
    predicted_conviction: liveConfidence.value,
    bull_case_pct: bullCase,
    bear_case_pct: bearCase,
    net_edge_pct: netEdge,
    participation_pct: weighted.active_weight,
    neutral_pct: neutralPct,
    verdict_strength: liveConfidence.strength,
    reason_text: `${direction} from weighted USD factor scoring on ${snapshot.snapshot_date}.`,
    weighted_score: weighted,
    conviction_model: {
      ...legacyConvictionModel,
      bullish_argument_pct: bullCase,
      bearish_argument_pct: bearCase,
      net_edge_pct: netEdge,
      directional_participation_pct: weighted.active_weight,
      active_participation_pct: weighted.active_weight,
      final_confidence: liveConfidence.value,
      confidence_strength: liveConfidence.strength,
      legacy_floor_conviction: legacyConvictionModel.final_conviction,
      legacy_floor_strength: legacyConvictionModel.confidence_strength,
      confidence_model_source: "live_dashboard_confidence_v1"
    },
    factor_breakdown: factors,
    warnings,
    missing_inputs: missingInputs,
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: logicDocumentVersion,
    replay_version: REPLAY_VERSION
  };
}

function buildReplayOutput(snapshot, logicDocumentVersion) {
  const timeframeEntries = Object.keys(TIMEFRAME_CONFIG).map((timeframeKey) => [timeframeKey, buildPrediction(snapshot, timeframeKey, logicDocumentVersion)]);
  const timeframeMap = Object.fromEntries(timeframeEntries);
  const allWarnings = Array.from(new Set(timeframeEntries.flatMap(([, prediction]) => prediction.warnings)));
  const allMissingInputs = Array.from(new Set(timeframeEntries.flatMap(([, prediction]) => prediction.missing_inputs)));

  return {
    asset: "USD",
    layer: "layer_1_raw",
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: logicDocumentVersion,
    replay_version: REPLAY_VERSION,
    snapshot_date: snapshot.snapshot_date,
    direction_24h: timeframeMap.following_24hrs.predicted_direction,
    conviction_24h: timeframeMap.following_24hrs.predicted_conviction,
    direction_3_day: timeframeMap["3d_from_call"].predicted_direction,
    conviction_3_day: timeframeMap["3d_from_call"].predicted_conviction,
    direction_current_week: timeframeMap.current_week.predicted_direction,
    conviction_current_week: timeframeMap.current_week.predicted_conviction,
    direction_current_month: timeframeMap.current_month.predicted_direction,
    conviction_current_month: timeframeMap.current_month.predicted_conviction,
    score_bullish: timeframeMap.following_24hrs.weighted_score.bullish_weight,
    score_bearish: timeframeMap.following_24hrs.weighted_score.bearish_weight,
    score_neutral: timeframeMap.following_24hrs.weighted_score.neutral_weight,
    non_neutral_count: timeframeMap.following_24hrs.weighted_score.bullish_count + timeframeMap.following_24hrs.weighted_score.bearish_count,
    weighted_score: timeframeMap.following_24hrs.weighted_score,
    conviction_model: timeframeMap.following_24hrs.conviction_model,
    missing_inputs: allMissingInputs,
    factor_breakdown: timeframeMap.following_24hrs.factor_breakdown,
    reasoning_summary: `USD replay generated from current production logic for ${snapshot.snapshot_date}.`,
    risk_flags: allWarnings,
    timeframe_models: timeframeEntries.reduce((accumulator, [timeframeKey, prediction]) => {
      accumulator[timeframeKey] = {
        direction: prediction.predicted_direction,
        conviction: prediction.predicted_conviction,
        weighted_score: prediction.weighted_score,
        conviction_model: prediction.conviction_model,
        factor_breakdown: prediction.factor_breakdown
      };
      return accumulator;
    }, {}),
    created_at: new Date().toISOString()
  };
}

async function fetchExistingObservation(supabaseUrl, serviceRoleKey, sourceSnapshotId) {
  const url = new URL(`${supabaseUrl}/rest/v1/research_observations`);
  url.searchParams.set("select", "id");
  url.searchParams.set("source_workflow", `eq.${SOURCE_WORKFLOW}`);
  url.searchParams.set("source_snapshot_id", `eq.${sourceSnapshotId}`);
  url.searchParams.set("agent_name", "eq.USD");
  url.searchParams.set("limit", "1");
  const rows = await fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });
  return rows[0] || null;
}

async function upsertObservation(supabaseUrl, serviceRoleKey, snapshot) {
  const sourceSnapshotId = snapshot.id || `USD|${snapshot.snapshot_date}`;
  const existing = await fetchExistingObservation(supabaseUrl, serviceRoleKey, sourceSnapshotId);
  const payload = {
    observation_time: snapshot.observation_time,
    snapshot_date: snapshot.snapshot_date,
    agent_name: "USD",
    asset_code: "USD",
    layer: 1,
    source_workflow: SOURCE_WORKFLOW,
    source_run_id: REPLAY_VERSION,
    source_snapshot_id: sourceSnapshotId,
    market_status: snapshot.market_data_coverage_status,
    weekend_rule_active: false,
    market_snapshot: normalizeSnapshotPayload(snapshot),
    market_regime: {
      equities_regime: snapshot.equities_regime || null,
      fed_bias: snapshot.fed_bias || null
    },
    warnings: snapshot.warnings || [],
    missing_inputs: snapshot.missing_inputs || [],
    data_quality: {
      source_status: snapshot.source_status,
      event_coverage_status: snapshot.event_coverage_status,
      market_data_coverage_status: snapshot.market_data_coverage_status
    }
  };

  if (existing) {
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/research_observations`);
    patchUrl.searchParams.set("id", `eq.${existing.id}`);
    patchUrl.searchParams.set("select", "id");
    const rows = await fetchJson(patchUrl.toString(), {
      method: "PATCH",
      headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify(payload)
    });
    return rows[0];
  }

  const createUrl = `${supabaseUrl}/rest/v1/research_observations`;
  const rows = await fetchJson(createUrl, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function upsertSingletonByObservation(supabaseUrl, serviceRoleKey, tableName, observationId, payload) {
  const url = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
  url.searchParams.set("observation_id", `eq.${observationId}`);
  url.searchParams.set("select", "id");
  const existing = await fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });

  if (existing[0]) {
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
    patchUrl.searchParams.set("id", `eq.${existing[0].id}`);
    patchUrl.searchParams.set("select", "id");
    const rows = await fetchJson(patchUrl.toString(), {
      method: "PATCH",
      headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify(payload)
    });
    return rows[0];
  }

  const rows = await fetchJson(`${supabaseUrl}/rest/v1/${tableName}`, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function fetchPredictionByLegacyKey(supabaseUrl, serviceRoleKey, observationId, legacyKey) {
  const url = new URL(`${supabaseUrl}/rest/v1/research_timeframe_predictions`);
  url.searchParams.set("select", "id");
  url.searchParams.set("observation_id", `eq.${observationId}`);
  url.searchParams.set("legacy_timeframe_key", `eq.${legacyKey}`);
  url.searchParams.set("limit", "1");
  const rows = await fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });
  return rows[0] || null;
}

async function upsertPrediction(supabaseUrl, serviceRoleKey, observationId, verdictId, prediction) {
  const payload = {
    observation_id: observationId,
    agent_verdict_id: verdictId,
    timeframe: prediction.timeframe,
    legacy_timeframe_key: prediction.legacy_timeframe_key,
    mapping_status: "mapped",
    mapping_notes: "Historical USD replay writes canonical Phase 1 timeframe predictions directly.",
    predicted_direction: prediction.predicted_direction,
    predicted_conviction: prediction.predicted_conviction,
    bull_case_pct: prediction.bull_case_pct,
    bear_case_pct: prediction.bear_case_pct,
    net_edge_pct: prediction.net_edge_pct,
    participation_pct: prediction.participation_pct,
    neutral_pct: prediction.neutral_pct,
    verdict_strength: prediction.verdict_strength,
    reason_text: prediction.reason_text,
    weighted_score: prediction.weighted_score,
    conviction_model: prediction.conviction_model,
    prediction_status: "replayed",
    factor_breakdown: prediction.factor_breakdown,
    warnings: prediction.warnings,
    missing_inputs: prediction.missing_inputs,
    logic_document: prediction.logic_document,
    logic_document_version: prediction.logic_document_version,
    replay_version: prediction.replay_version
  };

  const existing = await fetchPredictionByLegacyKey(
    supabaseUrl,
    serviceRoleKey,
    observationId,
    prediction.legacy_timeframe_key
  );

  if (existing) {
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/research_timeframe_predictions`);
    patchUrl.searchParams.set("id", `eq.${existing.id}`);
    patchUrl.searchParams.set("select", "id");
    const rows = await fetchJson(patchUrl.toString(), {
      method: "PATCH",
      headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify(payload)
    });
    return rows[0];
  }

  const rows = await fetchJson(`${supabaseUrl}/rest/v1/research_timeframe_predictions`, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function upsertFactorObservations(supabaseUrl, serviceRoleKey, observationId, verdictId, predictionId, prediction) {
  const rows = Object.entries(prediction.factor_breakdown).map(([factorKey, factorValue], index) => ({
    observation_id: observationId,
    agent_verdict_id: verdictId,
    timeframe_prediction_id: predictionId,
    timeframe: prediction.timeframe,
    legacy_timeframe_key: prediction.legacy_timeframe_key,
    mapping_status: "mapped",
    factor_key: factorKey,
    factor_name: factorKey,
    factor_signal: factorValue.signal || null,
    factor_weight: toNumber(factorValue.weight),
    factor_reason: factorValue.reason || null,
    factor_evidence: factorValue.evidence || null,
    factor_family: "usd_macro",
    factor_payload: factorValue,
    observation_order: index + 1
  }));

  if (!rows.length) return 0;

  const url = new URL(`${supabaseUrl}/rest/v1/research_factor_observations`);
  url.searchParams.set("on_conflict", "timeframe_prediction_id,factor_key");
  await fetchJson(url.toString(), {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(rows)
  });

  return rows.length;
}

async function loadSnapshots(supabaseUrl, serviceRoleKey, startDate, endDate) {
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_usd_market_snapshots",
    (url) => {
      url.searchParams.set("select", "*");
      url.searchParams.set("snapshot_date", `gte.${startDate}`);
      url.searchParams.append("snapshot_date", `lte.${endDate}`);
      url.searchParams.set("order", "snapshot_date.asc");
    }
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || "2018-01-01";
  const endDate = args.end || "2024-12-31";
  const limit = args.limit ? Number(args.limit) : null;

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const logicDocumentVersion = parseLogicVersion();

  const snapshots = await loadSnapshots(supabaseUrl, serviceRoleKey, startDate, endDate);
  const selectedSnapshots = limit ? snapshots.slice(0, limit) : snapshots;

  let observationsProcessed = 0;
  let predictionsWritten = 0;
  let factorsWritten = 0;

  for (const snapshot of selectedSnapshots) {
    const replayOutput = buildReplayOutput(snapshot, logicDocumentVersion);
    const observation = await upsertObservation(supabaseUrl, serviceRoleKey, snapshot);
    const modelContext = await upsertSingletonByObservation(
      supabaseUrl,
      serviceRoleKey,
      "research_model_contexts",
      observation.id,
      {
        observation_id: observation.id,
        logic_document: LOGIC_DOCUMENT,
        logic_document_version: logicDocumentVersion,
        collector_versions: {
          snapshot_builder: snapshot.collector_version || null,
          replay_engine: REPLAY_VERSION
        },
        prompt_version: null,
        weight_model_version: "usd_weighted_logic_v1",
        conviction_model_version: "usd_conviction_logic_v2",
        workflow_version_id: REPLAY_VERSION,
        repo_commit_sha: null,
        notes: "Historical USD replay generated inside /backtester."
      }
    );

    const verdict = await upsertSingletonByObservation(
      supabaseUrl,
      serviceRoleKey,
      "research_agent_verdicts",
      observation.id,
      {
        observation_id: observation.id,
        agent_name: "USD",
        reasoning_summary: replayOutput.reasoning_summary,
        raw_agent_output: replayOutput,
        full_output: replayOutput,
        score_bullish: replayOutput.score_bullish,
        score_bearish: replayOutput.score_bearish,
        score_neutral: replayOutput.score_neutral,
        verdict_status: "replayed"
      }
    );

    void modelContext;

    for (const timeframeKey of Object.keys(TIMEFRAME_CONFIG)) {
      const prediction = replayOutput.timeframe_models[timeframeKey];
      const predictionRow = await upsertPrediction(supabaseUrl, serviceRoleKey, observation.id, verdict.id, {
        timeframe: TIMEFRAME_CONFIG[timeframeKey].timeframe,
        legacy_timeframe_key: TIMEFRAME_CONFIG[timeframeKey].legacy_timeframe_key,
        predicted_direction: prediction.direction,
        predicted_conviction: prediction.conviction,
        bull_case_pct: prediction.conviction_model.bullish_argument_pct,
        bear_case_pct: prediction.conviction_model.bearish_argument_pct,
        net_edge_pct: prediction.conviction_model.net_edge_pct,
        participation_pct: prediction.conviction_model.directional_participation_pct,
        neutral_pct: 100 - prediction.weighted_score.active_weight,
        verdict_strength: prediction.conviction_model.confidence_strength,
        reason_text: `${prediction.direction} generated by ${REPLAY_VERSION}.`,
        weighted_score: prediction.weighted_score,
        conviction_model: prediction.conviction_model,
        factor_breakdown: prediction.factor_breakdown,
        warnings: replayOutput.risk_flags,
        missing_inputs: replayOutput.missing_inputs,
        logic_document: LOGIC_DOCUMENT,
        logic_document_version: logicDocumentVersion,
        replay_version: REPLAY_VERSION
      });

      factorsWritten += await upsertFactorObservations(
        supabaseUrl,
        serviceRoleKey,
        observation.id,
        verdict.id,
        predictionRow.id,
        {
          timeframe: TIMEFRAME_CONFIG[timeframeKey].timeframe,
          legacy_timeframe_key: TIMEFRAME_CONFIG[timeframeKey].legacy_timeframe_key,
          factor_breakdown: prediction.factor_breakdown
        }
      );
      predictionsWritten += 1;
    }

    observationsProcessed += 1;
  }

  console.log(JSON.stringify({
    replay_version: REPLAY_VERSION,
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: logicDocumentVersion,
    date_range: {
      start: startDate,
      end: endDate
    },
    observations_processed: observationsProcessed,
    predictions_written: predictionsWritten,
    factor_rows_written: factorsWritten
  }, null, 2));
}

run().catch((error) => {
  console.error("USD historical replay failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
