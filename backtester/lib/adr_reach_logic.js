"use strict";

// Shared ADR/L2L intraday reach semantics for backtester research.
//
// A reach WIN is defined purely intraday: starting from the call day's open,
// price must travel at least the L2L target distance in the called direction
// at some point inside that day's high/low range. The close is ignored.
// This is deliberately not close-to-close accuracy.

const ADR_WINDOW_SESSIONS = 20;
const ADR_THRESHOLD_PCT = 50;

const CONFIDENCE_BUCKETS = [
  { key: "WEAK", label: "Weak", min: 0, max: 49 },
  { key: "MODERATE", label: "Moderate", min: 50, max: 64 },
  { key: "STRONG", label: "Strong", min: 65, max: 79 },
  { key: "VERY_STRONG", label: "Very Strong", min: 80, max: 100 }
];

// Number(null) and Number("") are 0, so absent inputs must be rejected before
// numeric conversion or a missing open would silently evaluate as a 0 price.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeReachDirection(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized.startsWith("BULLISH") || normalized === "LONG" || normalized === "BUY") return "BULLISH";
  if (normalized.startsWith("BEARISH") || normalized === "SHORT" || normalized === "SELL") return "BEARISH";
  return null;
}

// Mean high-low range of the given completed sessions. Returns null unless
// exactly `windowSessions` rows with finite high/low are provided, so callers
// cannot silently compute an ADR from a short window.
function computeAdrFromSessions(sessions, windowSessions = ADR_WINDOW_SESSIONS) {
  if (!Array.isArray(sessions) || sessions.length !== windowSessions) return null;

  let sum = 0;
  for (const session of sessions) {
    const high = toFiniteNumber(session?.high);
    const low = toFiniteNumber(session?.low);
    if (high === null || low === null || high < low) return null;
    sum += high - low;
  }

  return sum / windowSessions;
}

function resolveL2lDistance(adr, thresholdPct = ADR_THRESHOLD_PCT) {
  const numericAdr = toFiniteNumber(adr);
  const numericPct = toFiniteNumber(thresholdPct);
  if (numericAdr === null || numericAdr <= 0) return null;
  if (numericPct === null || numericPct <= 0) return null;
  return numericAdr * (numericPct / 100);
}

// Core win definition. Returns one of:
// - { status: "NO_TRADE", reason: "non_directional" }
// - { status: "INVALID", reason: "missing_open" | "missing_high_low" | "missing_l2l_distance" }
// - { status: "WIN" | "MISS", direction, requiredTarget, reachedVia }
//
// Touching the target exactly counts as reached. The close never participates.
function evaluateIntradayReach({ direction, open, high, low, l2lDistance } = {}) {
  const normalizedDirection = normalizeReachDirection(direction);
  if (!normalizedDirection) {
    return { status: "NO_TRADE", reason: "non_directional" };
  }

  const numericOpen = toFiniteNumber(open);
  const numericHigh = toFiniteNumber(high);
  const numericLow = toFiniteNumber(low);
  const numericDistance = toFiniteNumber(l2lDistance);

  if (numericOpen === null) {
    return { status: "INVALID", reason: "missing_open" };
  }
  if (numericHigh === null || numericLow === null) {
    return { status: "INVALID", reason: "missing_high_low" };
  }
  if (numericDistance === null || numericDistance <= 0) {
    return { status: "INVALID", reason: "missing_l2l_distance" };
  }

  if (normalizedDirection === "BULLISH") {
    const requiredTarget = numericOpen + numericDistance;
    return {
      status: numericHigh >= requiredTarget ? "WIN" : "MISS",
      direction: normalizedDirection,
      requiredTarget,
      reachedVia: "high"
    };
  }

  const requiredTarget = numericOpen - numericDistance;
  return {
    status: numericLow <= requiredTarget ? "WIN" : "MISS",
    direction: normalizedDirection,
    requiredTarget,
    reachedVia: "low"
  };
}

function bucketKeyFromConfidence(confidence) {
  const numeric = Number(confidence);
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.max(0, Math.min(100, numeric));
  return CONFIDENCE_BUCKETS.find((bucket) => clamped >= bucket.min && clamped <= bucket.max)?.key || null;
}

function bucketLabelFromKey(bucketKey) {
  return CONFIDENCE_BUCKETS.find((bucket) => bucket.key === bucketKey)?.label || bucketKey;
}

module.exports = {
  ADR_WINDOW_SESSIONS,
  ADR_THRESHOLD_PCT,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateIntradayReach,
  bucketKeyFromConfidence,
  bucketLabelFromKey
};
