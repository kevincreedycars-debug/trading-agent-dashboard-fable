"use strict";

// Shared L2L Range Available semantics for backtester research.
//
// This is NOT open-anchored target reach and NOT close-to-close accuracy.
// With daily OHLC we cannot know the intraday sequence, so the question is
// only: did the day's high-low range contain enough directional movement for
// an L2L setup to be available at some point during that trading day?
//
//   available_range = high - low
//   range_available = available_range >= l2l_distance
//
// The call direction categorizes the row (bullish/long vs bearish/short); it
// never changes the range calculation. The open is diagnostic context only,
// never an anchor, and the close is irrelevant.
//
// Results must be labelled "L2L Range Available", not guaranteed executed:
// daily OHLC confirms range availability, not intraday sequence.

const ADR_WINDOW_SESSIONS = 20;
const ADR_THRESHOLD_PCT = 50;
const RANGE_AVAILABILITY_NOTE = "daily OHLC confirms range availability, not intraday sequence";
const DIRECTIONAL_MOVE_NOTE = "directional moves are verified from 1-hour candles without assuming any within-hour sequence; reported moves are guaranteed lower bounds, so misses are conservative";

const CONFIDENCE_BUCKETS = [
  { key: "WEAK", label: "Weak", min: 0, max: 49 },
  { key: "MODERATE", label: "Moderate", min: 50, max: 64 },
  { key: "STRONG", label: "Strong", min: 65, max: 79 },
  { key: "VERY_STRONG", label: "Very Strong", min: 80, max: 100 }
];

// Number(null) and Number("") are 0, so absent inputs must be rejected before
// numeric conversion or a missing high/low could silently evaluate as 0.
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

// Core L2L range availability. Returns one of:
// - { status: "NO_TRADE", reason: "non_directional" }
// - { status: "INVALID", reason: "missing_high_low" | "invalid_range" | "missing_l2l_distance" }
// - { status: "AVAILABLE" | "NOT_AVAILABLE", direction, dayRange, rangeAvailable, rangeMargin, note }
//
// The open and close play no part in the result; open may be passed for
// diagnostics but is ignored here. Direction only categorizes the call.
function evaluateL2lRangeAvailability({ direction, high, low, l2lDistance } = {}) {
  const normalizedDirection = normalizeReachDirection(direction);
  if (!normalizedDirection) {
    return { status: "NO_TRADE", reason: "non_directional" };
  }

  const numericHigh = toFiniteNumber(high);
  const numericLow = toFiniteNumber(low);
  const numericDistance = toFiniteNumber(l2lDistance);

  if (numericHigh === null || numericLow === null) {
    return { status: "INVALID", reason: "missing_high_low" };
  }
  if (numericHigh < numericLow) {
    return { status: "INVALID", reason: "invalid_range" };
  }
  if (numericDistance === null || numericDistance <= 0) {
    return { status: "INVALID", reason: "missing_l2l_distance" };
  }

  const dayRange = numericHigh - numericLow;
  const rangeAvailable = dayRange >= numericDistance;

  return {
    status: rangeAvailable ? "AVAILABLE" : "NOT_AVAILABLE",
    direction: normalizedDirection,
    dayRange,
    rangeAvailable,
    rangeMargin: dayRange - numericDistance,
    note: RANGE_AVAILABILITY_NOTE
  };
}

// Largest price move PROVABLE from a chronologically ordered list of intraday
// candles, per direction. Sequence facts used, and nothing more:
// - within one candle: open trades first and close trades last, so
//   high - open and close - low are guaranteed upswings, and
//   open - low and high - close are guaranteed downswings;
// - across candles: any price in an earlier candle precedes any price in a
//   later candle, so a later high minus an earlier low is a guaranteed upswing
//   (and vice versa for downswings).
// The high/low order INSIDE a single candle is never assumed, so the returned
// values are lower bounds on the true maximum excursion in each direction.
function computeGuaranteedDirectionalMoves(candles = []) {
  let maxUp = 0;
  let maxDown = 0;
  let minLowBefore = null;
  let maxHighBefore = null;
  let candlesUsed = 0;

  for (const candle of Array.isArray(candles) ? candles : []) {
    const open = toFiniteNumber(candle?.open);
    const high = toFiniteNumber(candle?.high);
    const low = toFiniteNumber(candle?.low);
    const close = toFiniteNumber(candle?.close);
    if (open === null || high === null || low === null || close === null || high < low) continue;

    candlesUsed += 1;
    maxUp = Math.max(maxUp, high - open, close - low);
    maxDown = Math.max(maxDown, open - low, high - close);
    if (minLowBefore !== null) maxUp = Math.max(maxUp, high - minLowBefore);
    if (maxHighBefore !== null) maxDown = Math.max(maxDown, maxHighBefore - low);
    minLowBefore = minLowBefore === null ? low : Math.min(minLowBefore, low);
    maxHighBefore = maxHighBefore === null ? high : Math.max(maxHighBefore, high);
  }

  if (!candlesUsed) {
    return { maxUp: null, maxDown: null, candlesUsed: 0 };
  }

  return { maxUp, maxDown, candlesUsed };
}

// Did price make a complete move of at least the L2L distance in the call
// direction at some point during the day? Returns one of:
// - { status: "NO_TRADE", reason: "non_directional" }
// - { status: "INVALID", reason: "missing_intraday_ohlc" | "missing_l2l_distance" }
// - { status: "MOVED" | "NOT_MOVED", direction, maxDirectionalMove, moveAchieved, moveMargin, candlesUsed, note }
function evaluateL2lDirectionalMove({ direction, candles, l2lDistance } = {}) {
  const normalizedDirection = normalizeReachDirection(direction);
  if (!normalizedDirection) {
    return { status: "NO_TRADE", reason: "non_directional" };
  }

  const numericDistance = toFiniteNumber(l2lDistance);
  if (numericDistance === null || numericDistance <= 0) {
    return { status: "INVALID", reason: "missing_l2l_distance" };
  }

  const moves = computeGuaranteedDirectionalMoves(candles);
  if (!moves.candlesUsed) {
    return { status: "INVALID", reason: "missing_intraday_ohlc" };
  }

  const maxDirectionalMove = normalizedDirection === "BULLISH" ? moves.maxUp : moves.maxDown;
  const moveAchieved = maxDirectionalMove >= numericDistance;

  return {
    status: moveAchieved ? "MOVED" : "NOT_MOVED",
    direction: normalizedDirection,
    maxDirectionalMove,
    moveAchieved,
    moveMargin: maxDirectionalMove - numericDistance,
    candlesUsed: moves.candlesUsed,
    note: DIRECTIONAL_MOVE_NOTE
  };
}

function bucketKeyFromConfidence(confidence) {
  const numeric = toFiniteNumber(confidence);
  if (numeric === null) return null;
  const clamped = Math.max(0, Math.min(100, numeric));
  return CONFIDENCE_BUCKETS.find((bucket) => clamped >= bucket.min && clamped <= bucket.max)?.key || null;
}

function bucketLabelFromKey(bucketKey) {
  return CONFIDENCE_BUCKETS.find((bucket) => bucket.key === bucketKey)?.label || bucketKey;
}

module.exports = {
  ADR_WINDOW_SESSIONS,
  ADR_THRESHOLD_PCT,
  RANGE_AVAILABILITY_NOTE,
  DIRECTIONAL_MOVE_NOTE,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateL2lRangeAvailability,
  computeGuaranteedDirectionalMoves,
  evaluateL2lDirectionalMove,
  bucketKeyFromConfidence,
  bucketLabelFromKey
};
