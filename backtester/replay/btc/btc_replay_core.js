const fs = require("fs");
const path = require("path");
const {
  computeHeadlineConfidenceData,
  deriveConfidenceStrength
} = require("../../lib/headline_confidence");

const LOGIC_DOCUMENT = "agent_btc_direction.md";
const TIMEFRAME_WEIGHTS = Object.freeze({
  "24h": { F1: 16, F2: 14, F3: 10, F4: 10, F5: 16, F6: 14, F7: 6, F8: 8, F9: 3, F10: 3 },
  "3d": { F1: 12, F2: 15, F3: 14, F4: 12, F5: 14, F6: 12, F7: 7, F8: 8, F9: 4, F10: 2 },
  current_week: { F1: 10, F2: 15, F3: 16, F4: 13, F5: 13, F6: 10, F7: 6, F8: 9, F9: 5, F10: 3 },
  next_week: { F1: 6, F2: 14, F3: 18, F4: 16, F5: 10, F6: 7, F7: 5, F8: 11, F9: 9, F10: 4 },
  current_month: { F1: 7, F2: 14, F3: 18, F4: 17, F5: 9, F6: 6, F7: 4, F8: 12, F9: 9, F10: 4 }
});

function n(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function makeFactor(signal, evidence, reason) {
  return { signal, evidence, reason };
}

function parseLogicVersion() {
  const logicPath = path.resolve(__dirname, "../../../logic/agent_btc_direction.md");
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

function factorName(id) {
  return {
    F1: "BTC Own Price Delta",
    F2: "DXY / USD Pressure",
    F3: "US 10Y Real Yield Delta",
    F4: "Fed Bias / Policy Liquidity",
    F5: "VIX Level and Risk Regime",
    F6: "NQ / High-Beta Risk Confirmation",
    F7: "US Economic Surprise Direction",
    F8: "BTC ETF / Institutional Flow",
    F9: "Stablecoin / Crypto Liquidity",
    F10: "BTC Dominance / Crypto Structure"
  }[id] || id;
}

function signalFromDelta(value, upThreshold, downThreshold, bullishReason, bearishReason, neutralReason, label, invert = false) {
  const delta = n(value);
  if (delta === null) return makeFactor("NEUTRAL", `Missing ${label}`, "Missing input");

  if (!invert) {
    if (delta >= upThreshold) return makeFactor("BULLISH", `${label} ${delta}`, bullishReason);
    if (delta <= downThreshold) return makeFactor("BEARISH", `${label} ${delta}`, bearishReason);
  } else {
    if (delta >= upThreshold) return makeFactor("BEARISH", `${label} ${delta}`, bearishReason);
    if (delta <= downThreshold) return makeFactor("BULLISH", `${label} ${delta}`, bullishReason);
  }

  return makeFactor("NEUTRAL", `${label} ${delta}`, neutralReason);
}

function isWeekendRisk(snapshot) {
  const explicit = snapshot?.is_weekend_risk;
  if (typeof explicit === "boolean") return explicit;

  const basis =
    snapshot?.weekend_risk_date ||
    snapshot?.snapshot_date ||
    snapshot?.observation_date ||
    null;
  if (!basis) return false;

  const date = new Date(`${basis}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  return day === 0 || day === 5 || day === 6;
}

function selectedInputs(snapshot, timeframe) {
  const use20d = timeframe === "next_week" || timeframe === "current_month";
  return {
    btcDelta: timeframe === "24h" ? snapshot.btc_d1_pct : use20d ? snapshot.btc_d20_pct : snapshot.btc_d5_pct,
    dxyDelta: timeframe === "24h" ? snapshot.dxy_d1 : use20d ? snapshot.dxy_d20 : snapshot.dxy_d5,
    realYieldDelta: use20d ? snapshot.us_10y_real_yield_d20_bps : snapshot.us_10y_real_yield_d5_bps,
    nqDelta: timeframe === "24h" ? snapshot.nq_d1_pct : use20d ? snapshot.nq_d20_pct : snapshot.nq_d5_pct,
    etfFlow: timeframe === "24h" ? snapshot.btc_etf_net_flow_1d_usd : use20d ? snapshot.btc_etf_net_flow_20d_usd : snapshot.btc_etf_net_flow_5d_usd,
    stablecoinDelta: use20d ? snapshot.stablecoin_supply_d20_pct : snapshot.stablecoin_supply_d5_pct,
    dominanceDelta: use20d ? snapshot.btc_dominance_d20 : snapshot.btc_dominance_d5,
    totalCryptoMcapDelta: use20d ? snapshot.total_crypto_market_cap_d20_pct : snapshot.total_crypto_market_cap_d5_pct
  };
}

function factorSignals(snapshot, timeframe) {
  const selected = selectedInputs(snapshot, timeframe);
  const vix = n(snapshot.vix_level);
  const vixD5 = n(snapshot.vix_d5);
  const fed = String(snapshot.fed_bias || "").toLowerCase();
  const fearGreed = n(snapshot.crypto_fear_greed);

  const signals = {};

  signals.F1 = signalFromDelta(
    selected.btcDelta,
    3,
    -3,
    "BTC own trend is above noise threshold and supports upside pressure",
    "BTC own trend is below noise threshold and confirms downside pressure",
    "BTC move is inside normal noise threshold",
    timeframe === "24h" ? "BTC 1d %" : (timeframe === "next_week" || timeframe === "current_month") ? "BTC 20d %" : "BTC 5d %"
  );

  signals.F2 = signalFromDelta(
    selected.dxyDelta,
    timeframe === "24h" ? 0.15 : 0.3,
    timeframe === "24h" ? -0.15 : -0.3,
    "DXY weakness supports BTC/USD",
    "DXY strength pressures BTC/USD",
    "DXY move below threshold",
    timeframe === "24h" ? "DXY 1d %" : (timeframe === "next_week" || timeframe === "current_month") ? "DXY 20d %" : "DXY 5d %",
    true
  );

  signals.F3 = signalFromDelta(
    selected.realYieldDelta,
    5,
    -5,
    "Falling real yields reduce BTC opportunity-cost pressure",
    "Rising real yields tighten financial conditions and pressure BTC",
    "Real yield move below threshold",
    (timeframe === "next_week" || timeframe === "current_month") ? "Real yield 20d bps" : "Real yield 5d bps",
    true
  );

  signals.F4 = (() => {
    if (!fed || fed === "unknown") return makeFactor("NEUTRAL", "Fed bias unknown", "Missing input");
    if (fed.includes("dovish")) return makeFactor("BULLISH", `Fed bias ${fed}`, "Dovish Fed supports BTC through easier liquidity expectations");
    if (fed.includes("hawkish")) return makeFactor("BEARISH", `Fed bias ${fed}`, "Hawkish Fed pressures BTC through tighter liquidity expectations");
    return makeFactor("NEUTRAL", `Fed bias ${fed}`, "No clear Fed liquidity impulse");
  })();

  signals.F5 = (() => {
    if (vix === null) return makeFactor("NEUTRAL", "Missing VIX", "Missing input");
    if (vix > 30) return makeFactor("BEARISH", `VIX ${vix}`, "VIX above 30 signals BTC liquidation-risk regime");
    if (vix > 22) return makeFactor("BEARISH", `VIX ${vix}`, "Risk-off regime pressures BTC");
    if (vix < 16) return makeFactor("BULLISH", `VIX ${vix}`, "Low VIX supports risk appetite and BTC");
    if (vixD5 !== null && vixD5 > 2) return makeFactor("BEARISH", `VIX ${vix}, VIX d5 ${vixD5}`, "VIX rising materially increases BTC risk pressure");
    if (vixD5 !== null && vixD5 < -2) return makeFactor("BULLISH", `VIX ${vix}, VIX d5 ${vixD5}`, "VIX falling materially supports risk appetite");
    return makeFactor("NEUTRAL", `VIX ${vix}`, "Risk regime neutral");
  })();

  signals.F6 = signalFromDelta(
    selected.nqDelta,
    0.2,
    -0.2,
    "NQ strength confirms high-beta risk appetite for BTC",
    "NQ weakness confirms high-beta risk pressure on BTC",
    "NQ move below threshold",
    timeframe === "24h" ? "NQ 1d %" : (timeframe === "next_week" || timeframe === "current_month") ? "NQ 20d %" : "NQ 5d %"
  );

  signals.F7 = (() => {
    const event = snapshot.latest_us_event;
    const text = JSON.stringify(event || {}).toLowerCase();

    if (!event) return makeFactor("NEUTRAL", "No recent US event", "No confirmed surprise");

    const positive = text.includes("bullish") || text.includes("positive") || text.includes("beat");
    const negative = text.includes("bearish") || text.includes("negative") || text.includes("miss");

    if (positive && fed.includes("hawkish")) {
      return makeFactor("BEARISH", JSON.stringify(event), "Positive US surprise in hawkish Fed regime increases tightening pressure on BTC");
    }
    if (positive) {
      return makeFactor("BULLISH", JSON.stringify(event), "Positive US surprise supports growth/risk appetite without clear tightening override");
    }
    if (negative && fed.includes("hawkish")) {
      return makeFactor("BULLISH", JSON.stringify(event), "Negative US surprise may reduce tightening pressure and support BTC relief");
    }
    if (negative) {
      return makeFactor("BEARISH", JSON.stringify(event), "Negative US surprise raises growth-risk pressure on BTC");
    }

    return makeFactor("NEUTRAL", JSON.stringify(event), "No clear BTC surprise impulse");
  })();

  signals.F8 = (() => {
    const flow = n(selected.etfFlow);
    if (flow === null) return makeFactor("NEUTRAL", "Missing BTC ETF flow", "Missing or disabled input");
    if (flow > 0) return makeFactor("BULLISH", `ETF flow ${flow}`, "Confirmed BTC ETF net inflow supports BTC demand");
    if (flow < 0) return makeFactor("BEARISH", `ETF flow ${flow}`, "Confirmed BTC ETF net outflow pressures BTC demand");
    return makeFactor("NEUTRAL", `ETF flow ${flow}`, "ETF flow flat");
  })();

  signals.F9 = (() => {
    const stablecoinDelta = n(selected.stablecoinDelta);
    const marketCapDelta = n(selected.totalCryptoMcapDelta);

    if (stablecoinDelta !== null) {
      if (stablecoinDelta > 0.3) return makeFactor("BULLISH", `Stablecoin supply delta ${stablecoinDelta}%`, "Stablecoin supply expansion supports crypto liquidity");
      if (stablecoinDelta < -0.3) return makeFactor("BEARISH", `Stablecoin supply delta ${stablecoinDelta}%`, "Stablecoin supply contraction pressures crypto liquidity");
      return makeFactor("NEUTRAL", `Stablecoin supply delta ${stablecoinDelta}%`, "Stablecoin liquidity flat");
    }

    if (marketCapDelta !== null) {
      if (marketCapDelta > 1) return makeFactor("BULLISH", `Total crypto market cap delta ${marketCapDelta}%`, "Total crypto market cap expansion supports crypto liquidity");
      if (marketCapDelta < -1) return makeFactor("BEARISH", `Total crypto market cap delta ${marketCapDelta}%`, "Total crypto market cap contraction pressures crypto liquidity");
      return makeFactor("NEUTRAL", `Total crypto market cap delta ${marketCapDelta}%`, "Crypto market cap move below threshold");
    }

    return makeFactor("NEUTRAL", "Missing stablecoin and crypto market cap deltas", "Missing input");
  })();

  signals.F10 = (() => {
    const dominance = n(snapshot.btc_dominance);
    const dominanceDelta = n(selected.dominanceDelta);
    const btcDelta = n(selected.btcDelta);

    if (dominance === null && fearGreed === null) {
      return makeFactor("NEUTRAL", "Missing BTC dominance and fear/greed", "Missing input");
    }

    if (dominanceDelta !== null && btcDelta !== null) {
      if (dominanceDelta > 0 && btcDelta > 3) {
        return makeFactor("BULLISH", `BTC dominance delta ${dominanceDelta}, BTC delta ${btcDelta}%`, "BTC dominance rising with BTC price suggests BTC-led accumulation");
      }
      if (dominanceDelta < 0 && btcDelta < -3) {
        return makeFactor("BEARISH", `BTC dominance delta ${dominanceDelta}, BTC delta ${btcDelta}%`, "BTC dominance falling while BTC price weakens suggests BTC underperformance");
      }
    }

    if (fearGreed !== null) {
      if (btcDelta !== null && fearGreed <= 20 && btcDelta > -3) {
        return makeFactor("BULLISH", `Fear/Greed ${fearGreed}, BTC delta ${btcDelta}%`, "Extreme fear with stabilising BTC can support contrarian bullish pressure");
      }
      if (btcDelta !== null && fearGreed >= 80 && btcDelta < 3) {
        return makeFactor("BEARISH", `Fear/Greed ${fearGreed}, BTC delta ${btcDelta}%`, "Extreme greed with weakening BTC warns of exhaustion");
      }
      return makeFactor("NEUTRAL", `Fear/Greed ${fearGreed}`, "Sentiment alone is not enough to drive BTC factor");
    }

    return makeFactor("NEUTRAL", `BTC dominance ${dominance}`, "No clear BTC structure signal");
  })();

  return signals;
}

function collectMissingInputs(snapshot, timeframe, signals) {
  const selected = selectedInputs(snapshot, timeframe);
  const missing = [];

  if (n(selected.btcDelta) === null) missing.push(timeframe === "24h" ? "btc_d1_pct" : (timeframe === "next_week" || timeframe === "current_month") ? "btc_d20_pct" : "btc_d5_pct");
  if (n(selected.dxyDelta) === null) missing.push(timeframe === "24h" ? "dxy_d1" : (timeframe === "next_week" || timeframe === "current_month") ? "dxy_d20" : "dxy_d5");
  if (n(selected.realYieldDelta) === null) missing.push((timeframe === "next_week" || timeframe === "current_month") ? "us_10y_real_yield_d20_bps" : "us_10y_real_yield_d5_bps");
  if (!String(snapshot.fed_bias || "").trim() || String(snapshot.fed_bias || "").toLowerCase() === "unknown") missing.push("fed_bias");
  if (n(snapshot.vix_level) === null) missing.push("vix_level");
  if (n(selected.nqDelta) === null) missing.push(timeframe === "24h" ? "nq_d1_pct" : (timeframe === "next_week" || timeframe === "current_month") ? "nq_d20_pct" : "nq_d5_pct");

  if (signals.F8?.reason === "Missing or disabled input") {
    missing.push(timeframe === "24h" ? "btc_etf_net_flow_1d_usd" : (timeframe === "next_week" || timeframe === "current_month") ? "btc_etf_net_flow_20d_usd" : "btc_etf_net_flow_5d_usd");
  }
  if (signals.F9?.reason === "Missing input") {
    missing.push((timeframe === "next_week" || timeframe === "current_month") ? "stablecoin_supply_d20_pct" : "stablecoin_supply_d5_pct");
    missing.push((timeframe === "next_week" || timeframe === "current_month") ? "total_crypto_market_cap_d20_pct" : "total_crypto_market_cap_d5_pct");
  }
  if (signals.F10?.reason === "Missing input") {
    missing.push("btc_dominance");
    missing.push(timeframe === "next_week" || timeframe === "current_month" ? "btc_dominance_d20" : "btc_dominance_d5");
    missing.push("crypto_fear_greed");
  }

  return Array.from(new Set(missing));
}

function scoreTimeframe(snapshot, timeframe) {
  const weights = TIMEFRAME_WEIGHTS[timeframe];
  const signals = factorSignals(snapshot, timeframe);

  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  const factorBreakdown = {};
  const bullCase = [];
  const bearCase = [];
  const neutralCase = [];
  const warnings = [];

  for (const [id, signal] of Object.entries(signals)) {
    const weight = weights[id] || 0;
    const namedId = `${id} ${factorName(id)}`;
    factorBreakdown[namedId] = { ...signal, weight };

    if (signal.signal === "BULLISH") {
      bullish += weight;
      bullishCount += 1;
      bullCase.push(`${namedId} (${weight}): ${signal.evidence}`);
    } else if (signal.signal === "BEARISH") {
      bearish += weight;
      bearishCount += 1;
      bearCase.push(`${namedId} (${weight}): ${signal.evidence}`);
    } else {
      neutral += weight;
      neutralCount += 1;
      neutralCase.push(`${namedId} (${weight}): ${signal.evidence}`);
      if (String(signal.reason || "").toLowerCase().includes("missing")) {
        warnings.push(`Missing/neutral input: ${namedId}`);
      }
    }
  }

  const active = bullish + bearish;
  const bullishArgument = active > 0 ? Math.round((bullish / active) * 100) : 0;
  const bearishArgument = active > 0 ? Math.round((bearish / active) * 100) : 0;
  const neutralPct = Math.round(neutral);
  const participationPct = Math.round(active);
  const netEdge = bullishArgument - bearishArgument;
  const baseDirection = bullish > bearish ? "BULLISH" : bearish > bullish ? "BEARISH" : "NO_CLEAR_BIAS";
  const absEdge = Math.abs(netEdge);

  let direction = baseDirection === "NO_CLEAR_BIAS"
    ? "NO_CLEAR_BIAS"
    : absEdge < 20 || active < 50
      ? `${baseDirection}_LEAN`
      : baseDirection;

  if (baseDirection === "BULLISH" && n(snapshot.vix_level) > 30 && bearish > 0) {
    direction = "BULLISH_LEAN";
    warnings.push("VIX above 30: bullish BTC verdict capped to lean unless all macro risk factors confirm");
  }

  if (isWeekendRisk(snapshot) && timeframe === "24h") {
    warnings.push("WEEKEND_LIQUIDITY_RISK");
    if (direction === "BULLISH" && absEdge < 35) direction = "BULLISH_LEAN";
    if (direction === "BEARISH" && absEdge < 35) direction = "BEARISH_LEAN";
  }

  const conviction = baseDirection === "BULLISH" ? bullishArgument : baseDirection === "BEARISH" ? bearishArgument : 0;
  const strength = absEdge >= 40 ? "VERY_STRONG" : absEdge >= 25 ? "STRONG" : absEdge >= 15 ? "MODERATE" : "WEAK";
  const winningSide = baseDirection === "BULLISH" ? "BULLISH" : baseDirection === "BEARISH" ? "BEARISH" : "NONE";
  const missingInputs = collectMissingInputs(snapshot, timeframe, signals);

  const headlineConfidence = computeHeadlineConfidenceData({
    bullCase: bullishArgument,
    bearCase: bearishArgument,
    participation: participationPct,
    netEdge,
    direction,
    missingInputs,
    warnings
  }).value;
  const confidenceStrength = deriveConfidenceStrength(headlineConfidence, netEdge, participationPct, direction);

  const reason =
    `${timeframe} BTC deterministic score: bull case ${bullish} weight, bear case ${bearish} weight, neutral evidence ${neutral} weight. ` +
    `Winning side ${winningSide}, conviction ${conviction}%, net edge ${netEdge > 0 ? "+" : ""}${netEdge}, directional participation ${participationPct}%.`;

  return {
    direction,
    conviction,
    reason,
    factor_breakdown: factorBreakdown,
    bull_case: bullCase,
    bear_case: bearCase,
    neutral_case: neutralCase,
    warnings,
    missing_inputs: missingInputs,
    score_bullish: bullishCount,
    score_bearish: bearishCount,
    score_neutral: neutralCount,
    weighted_score: {
      bullish_weight: bullish,
      bearish_weight: bearish,
      neutral_weight: neutral,
      active_weight: active,
      weight_margin: Math.abs(bullish - bearish)
    },
    conviction_model: {
      bull_case_weight: bullish,
      bear_case_weight: bearish,
      winning_side: winningSide,
      bullish_argument_pct: bullishArgument,
      bearish_argument_pct: bearishArgument,
      neutral_evidence_pct: neutralPct,
      neutral_pct: neutralPct,
      directional_participation_pct: participationPct,
      active_participation_pct: participationPct,
      net_edge_pct: netEdge,
      final_conviction: conviction,
      final_confidence: headlineConfidence,
      headline_confidence_pct: headlineConfidence,
      verdict_strength: strength,
      confidence_strength: confidenceStrength,
      final_conviction_logic: reason,
      weighted_edge: Math.abs(netEdge) / 100,
      raw_conviction: conviction,
      base_conviction: conviction,
      participation: participationPct,
      participation_cap: participationPct,
      conflict_penalty: 0,
      missing_input_penalty: 0,
      agreement_boost: 0,
      neutral_weight: neutral,
      weighted_score: {
        bullish_weight: bullish,
        bearish_weight: bearish,
        neutral_weight: neutral,
        active_weight: active,
        weight_margin: Math.abs(bullish - bearish)
      },
      missing_inputs: missingInputs
    }
  };
}

function buildReplayOutput(snapshot, logicDocumentVersion = parseLogicVersion()) {
  const r24h = scoreTimeframe(snapshot, "24h");
  const r3d = scoreTimeframe(snapshot, "3d");
  const rWeek = scoreTimeframe(snapshot, "current_week");
  const rNextWeek = scoreTimeframe(snapshot, "next_week");
  const rMonth = scoreTimeframe(snapshot, "current_month");

  const allWarnings = Array.from(new Set([
    ...(Array.isArray(snapshot.warnings) ? snapshot.warnings : []),
    ...r24h.warnings,
    ...r3d.warnings,
    ...rWeek.warnings,
    ...rNextWeek.warnings,
    ...rMonth.warnings
  ]));

  const missingInputs = Array.from(new Set([
    ...(Array.isArray(snapshot.missing_inputs) ? snapshot.missing_inputs : []),
    ...r24h.missing_inputs,
    ...r3d.missing_inputs,
    ...rWeek.missing_inputs,
    ...rNextWeek.missing_inputs,
    ...rMonth.missing_inputs
  ]));

  return {
    asset: "BTC",
    agent_name: "BTC",
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: logicDocumentVersion,
    direction_24h: r24h.direction,
    conviction_24h: r24h.conviction,
    reason_24h: r24h.reason,
    direction_3_day: r3d.direction,
    conviction_3_day: r3d.conviction,
    reason_3_day: r3d.reason,
    direction_current_week: rWeek.direction,
    conviction_current_week: rWeek.conviction,
    reason_current_week: rWeek.reason,
    direction_next_week: rNextWeek.direction,
    conviction_next_week: rNextWeek.conviction,
    reason_next_week: rNextWeek.reason,
    direction_current_month: rMonth.direction,
    conviction_current_month: rMonth.conviction,
    reason_current_month: rMonth.reason,
    weighted_score: r24h.weighted_score,
    conviction_model: r24h.conviction_model,
    factor_breakdown: r24h.factor_breakdown,
    score_bullish: r24h.score_bullish,
    score_bearish: r24h.score_bearish,
    score_neutral: r24h.score_neutral,
    non_neutral_count: r24h.score_bullish + r24h.score_bearish,
    missing_inputs: missingInputs,
    warnings: allWarnings,
    risk_flags: allWarnings,
    timeframe_models: {
      "24h": r24h,
      "3d": r3d,
      current_week: rWeek,
      next_week: rNextWeek,
      current_month: rMonth
    },
    reasoning_summary:
      `BTC weighted verdicts calculated deterministically by timeframe. ` +
      `24h ${r24h.direction} ${r24h.conviction}%, ` +
      `3d ${r3d.direction} ${r3d.conviction}%, ` +
      `current week ${rWeek.direction} ${rWeek.conviction}%, ` +
      `next week ${rNextWeek.direction} ${rNextWeek.conviction}%, ` +
      `current month ${rMonth.direction} ${rMonth.conviction}%.`
  };
}

module.exports = {
  LOGIC_DOCUMENT,
  TIMEFRAME_WEIGHTS,
  buildReplayOutput,
  parseLogicVersion
};
