(function initLayer2PairLogic(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  const globalRoot = root || (typeof globalThis !== "undefined" ? globalThis : this);
  globalRoot.Layer2PairLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function createLayer2PairLogic() {
  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function normalizeDirectionalSignalKey(value = "") {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "BULLISH" || normalized === "BEARISH") return normalized;
    return null;
  }

  function confidenceBucketFromValue(confidence) {
    const numeric = numberOrNull(confidence);
    if (numeric === null) return null;
    if (numeric >= 80) return { key: "VERY_STRONG", label: "Very Strong" };
    if (numeric >= 65) return { key: "STRONG", label: "Strong" };
    if (numeric >= 50) return { key: "MODERATE", label: "Moderate" };
    if (numeric >= 0) return { key: "WEAK", label: "Weak" };
    return null;
  }

  function deriveLayer2PairSignal(input = {}) {
    const instrument = input.instrument || input.pairLabel || "Pair";
    const targetDirection = normalizeDirectionalSignalKey(input.targetDirection);
    const usdDirection = normalizeDirectionalSignalKey(input.usdDirection);
    const targetConfidence = numberOrNull(input.targetConfidence);
    const usdConfidence = numberOrNull(input.usdConfidence);

    let reasonKey = null;
    let reason = "";

    if (!targetDirection) {
      reasonKey = "unsupported_target_direction";
      reason = "Target 24H signal is non-directional, so there is no Layer 2 pair trade.";
    } else if (!usdDirection) {
      reasonKey = "unsupported_usd_direction";
      reason = "USD 24H signal is non-directional, so there is no Layer 2 pair trade.";
    } else if (targetConfidence === null || usdConfidence === null) {
      reasonKey = "missing_combined_confidence";
      reason = "Missing Layer 1 headline confidence prevents a Layer 2 pair trade.";
    } else if (targetDirection === usdDirection) {
      reasonKey = "same_direction_conflict";
      reason = "Both assets point in the same 24H direction, so there is no clear relative edge.";
    }

    if (reasonKey) {
      return {
        instrument,
        tradable: false,
        direction: null,
        combinedConfidence: null,
        strengthBucket: null,
        strengthBucketKey: null,
        reasonKey,
        reason
      };
    }

    const combinedConfidence = Math.min(targetConfidence, usdConfidence);
    const bucket = confidenceBucketFromValue(combinedConfidence);
    const direction = targetDirection === "BULLISH" && usdDirection === "BEARISH" ? "BUY" : "SELL";

    return {
      instrument,
      tradable: true,
      direction,
      combinedConfidence,
      strengthBucket: bucket ? bucket.label : null,
      strengthBucketKey: bucket ? bucket.key : null,
      reasonKey: "tradable_pair",
      reason: `${instrument} is tradable because the target and USD 24H signals are opposite. Combined confidence is the lower Layer 1 confidence.`
    };
  }

  return {
    normalizeDirectionalSignalKey,
    confidenceBucketFromValue,
    deriveLayer2PairSignal
  };
});
