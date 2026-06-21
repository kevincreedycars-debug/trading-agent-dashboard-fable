const CANONICAL_TIMEFRAMES = Object.freeze([
  "12hr",
  "current day",
  "following 24hrs",
  "3d from call",
  "current week",
  "following week",
  "current month",
  "following month"
]);

const CANONICAL_TIMEFRAME_INDEX = Object.freeze(
  Object.fromEntries(
    CANONICAL_TIMEFRAMES.map((timeframe, index) => [timeframe, index])
  )
);

function isCanonicalTimeframe(value) {
  return CANONICAL_TIMEFRAME_INDEX[value] !== undefined;
}

module.exports = {
  CANONICAL_TIMEFRAMES,
  CANONICAL_TIMEFRAME_INDEX,
  isCanonicalTimeframe
};
