
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

const LIVE_24H_FACTOR_WEIGHTS = Object.freeze({
  "F1 VIX": 10,
  "F2 US 2Y Yield Delta": 14,
  "F3 US-DE 2Y Spread Delta": 10,
  "F4 US 10Y Real Yield Delta": 10,
  "F5 DXY Delta": 14,
  "F6 Gold Delta": 4,
  "F7 US Economic Surprise": 24,
  "F8 Fed Bias": 12,
  "F9 Dollar Smile": 1,
  "F10 Equity Regime": 1
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

function buildLive24hFactorSignal(snapshot) {
  const selectedDxy = selectSeriesValue(snapshot, ["dxy_d1", "dxy_d5"]);
  const selectedGold = selectSeriesValue(snapshot, ["gold_d5_pct", "gold_d1_pct"]);
  const selectedNq = selectSeriesValue(snapshot, ["nq_d1_pct", "nq_d5_pct"]);
  const selectedUs2y = selectSeriesValue(snapshot, ["us_2y_d5_bps"]);
  const selectedRealYield = selectSeriesValue(snapshot, ["us_10y_real_yield_d5_bps"]);

  const factors = {};
  const missingInputs = new Set();
  const warnings = new Set(asArray(snapshot.warnings).filter(Boolean));

  const vixLevel = toNumber(snapshot.vix_level);
  const fedBias = snapshot.fed_bias ? String(snapshot.fed_bias).toLowerCase() : "";

  let f1Signal = "NEUTRAL";
  let f1Reason = "Domestic drivers dominate.";
  if (vixLevel === null) {
    missingInputs.add("vix_level");
    f1Reason = "Missing input";
  } else if (vixLevel > 25) {
    f1Signal = "BULLISH";
    f1Reason = "Safe-haven USD demand active.";
  } else if (vixLevel < 16) {
    f1Signal = "BEARISH";
    f1Reason = "Risk-on rotation away from USD.";
  }
  factors["F1 VIX"] = {
    signal: f1Signal,
    weight: LIVE_24H_FACTOR_WEIGHTS["F1 VIX"],
    evidence: vixLevel === null ? "Missing VIX" : `VIX ${vixLevel}`,
    reason: f1Reason
  };

  const f2Signal = directionFromSignedValue(selectedUs2y.value, "BULLISH", "BEARISH", 5);
  if (selectedUs2y.value === null) missingInputs.add(selectedUs2y.key);
  factors["F2 US 2Y Yield Delta"] = {
    signal: f2Signal || "NEUTRAL",
    weight: LIVE_24H_FACTOR_WEIGHTS["F2 US 2Y Yield Delta"],
    evidence: selectedUs2y.value === null ? "Missing US 2Y 5d bps" : `US 2Y 5d bps ${selectedUs2y.value}`,
    reason: selectedUs2y.value === null ? "Missing input" : (f2Signal ? "US front-end yields support USD" : "Move below threshold")
  };

  const spreadD5 = toNumber(snapshot.us_de_2y_spread_d5_bps);
  const f3Signal = directionFromSignedValue(spreadD5, "BULLISH", "BEARISH", 5);
  if (spreadD5 === null) missingInputs.add("us_de_2y_spread_d5_bps");
  factors["F3 US-DE 2Y Spread Delta"] = {
    signal: f3Signal || "NEUTRAL",
    weight: LIVE_24H_FACTOR_WEIGHTS["F3 US-DE 2Y Spread Delta"],
    evidence: spreadD5 === null ? "Missing US-DE 2Y spread 5d bps" : `US-DE 2Y spread 5d bps ${spreadD5}`,
    reason: spreadD5 === null ? "Missing input" : (f3Signal ? "Relative rates support USD" : "Move below threshold")
  };

  const f4Signal = directionFromSignedValue(selectedRealYield.value, "BULLISH", "BEARISH", 5);
  if (selectedRealYield.value === null) missingInputs.add(selectedRealYield.key);
  factors["F4 US 10Y Real Yield Delta"] = {
    signal: f4Signal || "NEUTRAL",
    weight: LIVE_24H_FACTOR_WEIGHTS["F4 US 10Y Real Yield Delta"],
    evidence: selectedRealYield.value === null ? "Missing Real yield 5d bps" : `Real yield 5d bps ${selectedRealYield.value}`,
    reason: selectedRealYield.value === null ? "Missing input" : (f4Signal ? "Rising real yields support USD" : "Move below threshold")
  };

  const f5Signal = directionFromSignedValue(selectedDxy.value, "BULLISH", "BEARISH", 0.15);
  if (selectedDxy.value === null) missingInputs.add(selectedDxy.key);
  factors["F5 DXY Delta"] = {
    signal: f5Signal || "NEUTRAL",
    weight: LIVE_24H_FACTOR_WEIGHTS["F5 DXY Delta"],
    evidence: selectedDxy.value === null ? "Missing DXY delta" : `DXY 1d % ${selectedDxy.value}`,
    reason: selectedDxy.value === null ? "Missing input" : (f5Signal ? "DXY confirms USD strength" : "Move below threshold")
  };

  let f6Signal = "NEUTRAL";
  let f6Reason = "Gold flat";
  if (selectedGold.value === null) {
    missingInputs.add(selectedGold.key);
    f6Reason = "Missing input";
  } else if (selectedGold.value < -0.1) {
    f6Signal = "BULLISH";
    f6Reason = "Gold weakness supports USD";
  } else if (selectedGold.value > 0.1) {
    f6Signal = "BEARISH";
    f6Reason = "Gold strength pressures USD";
  }
  factors["F6 Gold Delta"] = {
    signal: f6Signal,
    weight: LIVE_24H_FACTOR_WEIGHTS["F6 Gold Delta"],
    evidence: selectedGold.value === null ? "Missing gold delta" : `Gold ${selectedGold.value}%`,
    reason: f6Reason
  };

  const latestEvent = snapshot.latest_us_event || null;
  const usdSignal = latestEvent?.usd_signal ? String(latestEvent.usd_signal).toUpperCase() : "";
  let f7Signal = "NEUTRAL";
  let f7Reason = "No clear USD surprise";
  if (!latestEvent) {
    missingInputs.add("latest_us_event");
    f7Reason = "No confirmed surprise";
  } else if (usdSignal === "BULLISH") {
    f7Signal = "BULLISH";
    f7Reason = "Positive US surprise supports USD";
  } else if (usdSignal === "BEARISH") {
    f7Signal = "BEARISH";
    f7Reason = "Negative US surprise pressures USD";
  }
  factors["F7 US Economic Surprise"] = {
    signal: f7Signal,
    weight: LIVE_24H_FACTOR_WEIGHTS["F7 US Economic Surprise"],
    evidence: latestEvent ? (latestEvent.event || JSON.stringify(latestEvent)) : "No recent US event",
    reason: f7Reason
  };

  let f8Signal = "NEUTRAL";
  let f8Reason = "No clear Fed impulse";
  if (!fedBias || fedBias === "unknown") {
    missingInputs.add("fed_bias");
    f8Reason = "Missing input";
  } else if (fedBias.includes("hawkish")) {
    f8Signal = "BULLISH";
    f8Reason = "Hawkish Fed supports USD";
  } else if (fedBias.includes("dovish")) {
    f8Signal = "BEARISH";
    f8Reason = "Dovish Fed pressures USD";
  }
  factors["F8 Fed Bias"] = {
    signal: f8Signal,
    weight: LIVE_24H_FACTOR_WEIGHTS["F8 Fed Bias"],
    evidence: !fedBias ? "Fed bias unknown" : `Fed bias ${fedBias}`,
    reason: f8Reason
  };

  let f9Signal = "NEUTRAL";
  let f9Reason = "Insufficient regime evidence";
  if (vixLevel !== null && vixLevel > 25) {
    f9Signal = "BULLISH";
    f9Reason = "Dollar Smile right-side safe-haven bid";
  } else if (vixLevel !== null && vixLevel < 16 && !fedBias.includes("hawkish")) {
    f9Signal = "BEARISH";
    f9Reason = "Risk-on Dollar Smile bottom weakens USD";
  }
  factors["F9 Dollar Smile"] = {
    signal: f9Signal,
    weight: LIVE_24H_FACTOR_WEIGHTS["F9 Dollar Smile"],
    evidence: vixLevel === null ? "No clear Dollar Smile edge" : `VIX ${vixLevel}`,
    reason: f9Reason
  };

  let f10Signal = "NEUTRAL";
  let f10Reason = "No clear equity/USD signal";
  if (selectedNq.value === null || vixLevel === null) {
    if (selectedNq.value === null) missingInputs.add(selectedNq.key);
    if (vixLevel === null) missingInputs.add("vix_level");
    f10Reason = "Missing input";
  } else if (vixLevel < 16 && selectedNq.value > 0) {
    f10Signal = "BEARISH";
    f10Reason = "Risk appetite reduces USD demand";
  } else if (vixLevel < 16 && selectedNq.value < 0) {
    f10Signal = "BULLISH";
    f10Reason = "Equity weakness supports USD";
  } else if (vixLevel > 25 && selectedNq.value < 0) {
    f10Signal = "BULLISH";
    f10Reason = "Risk-off supports USD";
  }
  factors["F10 Equity Regime"] = {
    signal: f10Signal,
    weight: LIVE_24H_FACTOR_WEIGHTS["F10 Equity Regime"],
    evidence: selectedNq.value === null || vixLevel === null ? "Missing NQ/VIX" : `NQ ${selectedNq.value}%, VIX ${vixLevel}`,
    reason: f10Reason
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

function strengthFromLive24hNetEdge(netEdge) {
  const absEdge = Math.abs(Number(netEdge) || 0);
  if (absEdge >= 40) return "VERY_STRONG";
  if (absEdge >= 25) return "STRONG";
  if (absEdge >= 15) return "MODERATE";
  return "WEAK";
}

function buildLive24hPrediction(snapshot, logicDocumentVersion) {
  const { factors, warnings, missingInputs } = buildLive24hFactorSignal(snapshot);
  const weighted = computeWeightedSummary(factors);
  const active = weighted.active_weight;
  const bullishArgument = active > 0 ? Math.round((weighted.bullish_weight / active) * 100) : 0;
  const bearishArgument = active > 0 ? Math.round((weighted.bearish_weight / active) * 100) : 0;
  const neutralPct = Math.round(weighted.neutral_weight);
  const netEdge = bullishArgument - bearishArgument;

  const baseDirection =
    weighted.bullish_weight > weighted.bearish_weight
      ? "BULLISH"
      : weighted.bearish_weight > weighted.bullish_weight
        ? "BEARISH"
        : "NO_CLEAR_BIAS";

  const direction =
    baseDirection === "NO_CLEAR_BIAS"
      ? "NO_CLEAR_BIAS"
      : Math.abs(netEdge) < 20
        ? `${baseDirection}_LEAN`
        : baseDirection;

  const winningSidePct =
    baseDirection === "BULLISH"
      ? bullishArgument
      : baseDirection === "BEARISH"
        ? bearishArgument
        : 0;

  const legacyStrength = strengthFromLive24hNetEdge(netEdge);
  const liveConfidence = computeLiveHeadlineConfidence({
    bullCase: bullishArgument,
    bearCase: bearishArgument,
    participation: active,
    netEdge,
    direction,
    warnings,
    missingInputs,
    weeklyCandleStatus: snapshot.weekly_candle_status || null
  });
  const reason = `24h deterministic score: bullish argument ${bullishArgument}%, bearish argument ${bearishArgument}%, neutral/inactive ${neutralPct}%, net edge ${netEdge > 0 ? "+" : ""}${netEdge} ${baseDirection.toLowerCase().replace("_", " ")}.`;

  return {
    timeframe: TIMEFRAME_CONFIG.following_24hrs.timeframe,
    legacy_timeframe_key: TIMEFRAME_CONFIG.following_24hrs.legacy_timeframe_key,
    predicted_direction: direction,
    predicted_conviction: liveConfidence.value,
    bull_case_pct: bullishArgument,
    bear_case_pct: bearishArgument,
    net_edge_pct: netEdge,
    participation_pct: active,
    neutral_pct: neutralPct,
    verdict_strength: liveConfidence.strength,
    reason_text: reason,
    weighted_score: weighted,
    conviction_model: {
      bullish_argument_pct: bullishArgument,
      bearish_argument_pct: bearishArgument,
      neutral_pct: neutralPct,
      active_participation_pct: active,
      directional_participation_pct: active,
      net_edge_pct: netEdge,
      final_confidence: liveConfidence.value,
      final_conviction: liveConfidence.value,
      verdict_strength: liveConfidence.strength,
      confidence_strength: liveConfidence.strength,
      final_conviction_logic: reason,
      weighted_edge: Math.abs(netEdge) / 100,
      raw_conviction: winningSidePct,
      base_conviction: winningSidePct,
      legacy_winning_side_conviction: winningSidePct,
      participation: active,
      participation_cap: active,
      conflict_penalty: 0,
      missing_input_penalty: 0,
      agreement_boost: 0,
      legacy_floor_strength: legacyStrength,
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

function buildPrediction(snapshot, timeframeKey, logicDocumentVersion) {
  if (timeframeKey === "following_24hrs") {
    return buildLive24hPrediction(snapshot, logicDocumentVersion);
  }

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
    score_bullish: timeframeMap.following_24hrs.weighted_score.bullish_count,
    score_bearish: timeframeMap.following_24hrs.weighted_score.bearish_count,
    score_neutral: timeframeMap.following_24hrs.weighted_score.neutral_count,
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

module.exports = {
  LOGIC_DOCUMENT,
  REPLAY_VERSION,
  SOURCE_WORKFLOW,
  TIMEFRAME_CONFIG,
  buildPrediction,
  buildReplayOutput,
  normalizeSnapshotPayload,
  parseLogicVersion
};

