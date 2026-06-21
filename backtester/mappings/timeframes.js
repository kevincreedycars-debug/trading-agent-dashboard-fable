const { CANONICAL_TIMEFRAMES } = require("../constants/timeframes");

const LEGACY_AGENT_OUTPUT_TIMEFRAME_MAP = Object.freeze({
  "24h": {
    canonicalTimeframe: null,
    mappingStatus: "ambiguous",
    notes: "The current live `24h` output exists, but the missing backtester master logic document means it is not yet safe to map this automatically to either `current day` or `following 24hrs`."
  },
  "3d": {
    canonicalTimeframe: "3d from call",
    mappingStatus: "mapped",
    notes: "Safe direct mapping from legacy `3d` to canonical `3d from call`."
  },
  "current_week": {
    canonicalTimeframe: "current week",
    mappingStatus: "mapped",
    notes: "Safe direct mapping from live `current_week`."
  },
  "next_week": {
    canonicalTimeframe: "following week",
    mappingStatus: "mapped",
    notes: "Safe direct mapping from live `next_week`."
  },
  "current_month": {
    canonicalTimeframe: "current month",
    mappingStatus: "mapped",
    notes: "Safe direct mapping from live `current_month`."
  }
});

const UNAVAILABLE_CANONICAL_TIMEFRAMES = Object.freeze({
  "12hr": {
    source: null,
    mappingStatus: "unsupported",
    notes: "No live Layer 1 output field currently exposes a dedicated 12-hour verdict."
  },
  "current day": {
    source: "24h",
    mappingStatus: "ambiguous",
    notes: "Cannot safely infer `current day` from live `24h` output without the authoritative master logic mapping."
  },
  "following 24hrs": {
    source: "24h",
    mappingStatus: "ambiguous",
    notes: "Cannot safely infer `following 24hrs` from live `24h` output without the authoritative master logic mapping."
  },
  "following month": {
    source: null,
    mappingStatus: "unsupported",
    notes: "No live Layer 1 output field currently exposes a dedicated following-month verdict."
  }
});

function getLegacyTimeframeMapping(legacyKey) {
  return LEGACY_AGENT_OUTPUT_TIMEFRAME_MAP[legacyKey] || {
    canonicalTimeframe: null,
    mappingStatus: "unknown",
    notes: "No mapping rule exists for this legacy timeframe key."
  };
}

function getCanonicalCoverage() {
  return CANONICAL_TIMEFRAMES.map((timeframe) => {
    const directMatch = Object.entries(LEGACY_AGENT_OUTPUT_TIMEFRAME_MAP).find(
      ([, value]) => value.canonicalTimeframe === timeframe
    );

    if (directMatch) {
      return {
        canonicalTimeframe: timeframe,
        source: directMatch[0],
        mappingStatus: directMatch[1].mappingStatus,
        notes: directMatch[1].notes
      };
    }

    return {
      canonicalTimeframe: timeframe,
      ...(UNAVAILABLE_CANONICAL_TIMEFRAMES[timeframe] || {
        source: null,
        mappingStatus: "unknown",
        notes: "No coverage rule has been defined yet."
      })
    };
  });
}

module.exports = {
  LEGACY_AGENT_OUTPUT_TIMEFRAME_MAP,
  UNAVAILABLE_CANONICAL_TIMEFRAMES,
  getLegacyTimeframeMapping,
  getCanonicalCoverage
};
