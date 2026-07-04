const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveLayer2PairSignal } = require("../lib/layer2_pair_logic");

test("weak target leg and strong USD leg stay weak at Layer 2", () => {
  const result = deriveLayer2PairSignal({
    instrument: "EUR/USD",
    targetDirection: "BEARISH",
    usdDirection: "BULLISH",
    targetConfidence: 42,
    usdConfidence: 86
  });

  assert.equal(result.tradable, true);
  assert.equal(result.direction, "SELL");
  assert.equal(result.combinedConfidence, 42);
  assert.equal(result.strengthBucketKey, "WEAK");
  assert.equal(result.strengthBucket, "Weak");
});

test("same-direction legs are conflict no-trade", () => {
  const result = deriveLayer2PairSignal({
    instrument: "BTC/USD",
    targetDirection: "BULLISH",
    usdDirection: "BULLISH",
    targetConfidence: 63,
    usdConfidence: 86
  });

  assert.equal(result.tradable, false);
  assert.equal(result.reasonKey, "same_direction_conflict");
  assert.equal(result.combinedConfidence, null);
});

test("non-directional or missing-confidence legs are no-trade", () => {
  const nonDirectional = deriveLayer2PairSignal({
    instrument: "XAU/USD",
    targetDirection: "BULLISH_LEAN",
    usdDirection: "BULLISH",
    targetConfidence: 63,
    usdConfidence: 86
  });
  const missingConfidence = deriveLayer2PairSignal({
    instrument: "NQ/USD",
    targetDirection: "BEARISH",
    usdDirection: "BULLISH",
    targetConfidence: null,
    usdConfidence: 86
  });

  assert.equal(nonDirectional.tradable, false);
  assert.equal(nonDirectional.reasonKey, "unsupported_target_direction");
  assert.equal(missingConfidence.tradable, false);
  assert.equal(missingConfidence.reasonKey, "missing_combined_confidence");
});
