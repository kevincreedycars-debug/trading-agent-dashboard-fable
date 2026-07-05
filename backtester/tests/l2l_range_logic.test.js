const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("node:child_process");

const {
  ADR_WINDOW_SESSIONS,
  RANGE_AVAILABILITY_NOTE,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateL2lRangeAvailability
} = require("../lib/l2l_range_logic");

const ARTIFACT_PATH = path.resolve(__dirname, "../../data/adr-reach-research.json");
const VALIDATOR_PATH = path.resolve(__dirname, "../scripts/validate_adr_reach_research.js");
const BUCKET_KEYS = CONFIDENCE_BUCKETS.map((bucket) => bucket.key);

test("range is available when high - low is at least the L2L distance", () => {
  const result = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 105, low: 100, l2lDistance: 5 });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.rangeAvailable, true);
  assert.equal(result.dayRange, 5);
  assert.equal(result.rangeMargin, 0);
});

test("range is not available when high - low falls short of the L2L distance", () => {
  const result = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 104.99, low: 100, l2lDistance: 5 });
  assert.equal(result.status, "NOT_AVAILABLE");
  assert.equal(result.rangeAvailable, false);
  assert.ok(result.rangeMargin < 0);
});

test("a bullish call with high-low >= L2L counts as available", () => {
  const result = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 106, low: 100, l2lDistance: 5 });
  assert.equal(result.rangeAvailable, true);
  assert.equal(result.direction, "BULLISH");
});

test("a bearish call with high-low >= L2L counts as available", () => {
  const result = evaluateL2lRangeAvailability({ direction: "BEARISH", high: 106, low: 100, l2lDistance: 5 });
  assert.equal(result.rangeAvailable, true);
  assert.equal(result.direction, "BEARISH");
});

test("direction only categorizes the call; the range calculation is identical", () => {
  const bullish = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 104, low: 100, l2lDistance: 5 });
  const bearish = evaluateL2lRangeAvailability({ direction: "BEARISH", high: 104, low: 100, l2lDistance: 5 });
  assert.equal(bullish.rangeAvailable, bearish.rangeAvailable);
  assert.equal(bullish.dayRange, bearish.dayRange);
  assert.equal(bullish.rangeMargin, bearish.rangeMargin);
});

test("the close does not affect the result", () => {
  const closeHigh = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 105, low: 100, close: 105, l2lDistance: 5 });
  const closeLow = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 105, low: 100, close: 100.01, l2lDistance: 5 });
  assert.equal(closeHigh.rangeAvailable, true);
  assert.equal(closeLow.rangeAvailable, true);
});

test("the open does not affect the result; it is diagnostic context only", () => {
  const openAtLow = evaluateL2lRangeAvailability({ direction: "BEARISH", high: 105, low: 100, open: 100, l2lDistance: 5 });
  const openAtHigh = evaluateL2lRangeAvailability({ direction: "BEARISH", high: 105, low: 100, open: 105, l2lDistance: 5 });
  const openMissing = evaluateL2lRangeAvailability({ direction: "BEARISH", high: 105, low: 100, open: null, l2lDistance: 5 });
  assert.equal(openAtLow.rangeAvailable, true);
  assert.equal(openAtHigh.rangeAvailable, true);
  assert.equal(openMissing.rangeAvailable, true);
});

test("results carry the range-availability caveat, not an execution claim", () => {
  const result = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 105, low: 100, l2lDistance: 5 });
  assert.equal(result.note, RANGE_AVAILABILITY_NOTE);
  assert.ok(RANGE_AVAILABILITY_NOTE.includes("not intraday sequence"));
});

test("long/short synonyms map onto bullish/bearish", () => {
  assert.equal(normalizeReachDirection("LONG"), "BULLISH");
  assert.equal(normalizeReachDirection("SHORT"), "BEARISH");
});

test("non-directional calls are no-trade, not losses", () => {
  const flat = evaluateL2lRangeAvailability({ direction: "FLAT", high: 106, low: 94, l2lDistance: 5 });
  assert.equal(flat.status, "NO_TRADE");
  assert.equal(flat.reason, "non_directional");
});

test("missing inputs are invalid instead of silently evaluated", () => {
  assert.equal(evaluateL2lRangeAvailability({ direction: "BULLISH", high: null, low: 98, l2lDistance: 5 }).reason, "missing_high_low");
  assert.equal(evaluateL2lRangeAvailability({ direction: "BULLISH", high: 100, low: 105, l2lDistance: 5 }).reason, "invalid_range");
  assert.equal(evaluateL2lRangeAvailability({ direction: "BULLISH", high: 106, low: 98, l2lDistance: null }).reason, "missing_l2l_distance");
});

test("ADR window is strict about session count and L2L distance derives from it", () => {
  const sessions = Array.from({ length: ADR_WINDOW_SESSIONS }, () => ({ high: 110, low: 100 }));
  const adr = computeAdrFromSessions(sessions);
  assert.equal(adr, 10);
  assert.equal(resolveL2lDistance(adr, 50), 5);
  assert.equal(computeAdrFromSessions(sessions.slice(0, ADR_WINDOW_SESSIONS - 1)), null);
  assert.equal(computeAdrFromSessions([...sessions.slice(0, ADR_WINDOW_SESSIONS - 1), { high: null, low: 100 }]), null);
});

test("contract: artifact groups results by Layer 1 asset, Layer 2 pair, and strength bucket", () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.ok(artifact.meta.win_definition.includes("L2L Range Available"), "definition must be labelled L2L Range Available");
  assert.ok(!artifact.meta.win_definition.toLowerCase().includes("adr reach"), "definition must not be called ADR Reach");
  assert.equal(artifact.meta.range_availability_note, RANGE_AVAILABILITY_NOTE);
  assert.ok(artifact.meta.l2l_definition, "L2L definition must be documented in meta");
  assert.ok(artifact.meta.diagnostics, "diagnostics must be published in meta");

  const layer1Assets = artifact.layer1.assets;
  assert.deepEqual(layer1Assets.map((asset) => asset.assetCode).sort(), ["BTC", "EUR", "GOLD", "NQ", "USD"]);

  layer1Assets.forEach((asset) => {
    assert.deepEqual(
      asset.bucketSummaryRows.map((row) => row.bucketKey),
      BUCKET_KEYS,
      `${asset.assetCode}: bucket summary rows must cover every strength bucket in order`
    );
    assert.ok("strongPlusCalls" in asset.summary, `${asset.assetCode}: summary must separate Strong+ from all signals`);
    assert.ok(asset.diagnostics, `${asset.assetCode}: per-asset diagnostics must be published`);

    if (asset.available) {
      const bucketTotal = asset.bucketSummaryRows.reduce((sum, row) => sum + row.total, 0);
      assert.equal(bucketTotal, asset.summary.evaluatedCalls, `${asset.assetCode}: bucket totals must reconcile to evaluated calls`);
      assert.ok(Array.isArray(asset.evaluatedRows) && asset.evaluatedRows.length === asset.summary.evaluatedCalls,
        `${asset.assetCode}: per-row diagnostics must cover every evaluated call`);
      const sample = asset.evaluatedRows[0];
      for (const field of ["date", "asset", "layer", "callDirection", "bucketKey", "ohlcSource", "ohlcInstrument", "open", "high", "low", "close", "dayRange", "l2lDistance", "rangeAvailable", "rangeMargin"]) {
        assert.ok(field in sample, `${asset.assetCode}: evaluated row diagnostics must include ${field}`);
      }
    }
  });

  const layer2Pairs = artifact.layer2.pairs;
  assert.deepEqual(layer2Pairs.map((pair) => pair.pairCode).sort(), ["BTC_USD", "EUR_USD", "NQ_USD", "XAU_USD"]);

  layer2Pairs.forEach((pair) => {
    assert.deepEqual(
      pair.bucketSummaryRows.map((row) => row.bucketKey),
      BUCKET_KEYS,
      `${pair.pairCode}: bucket summary rows must cover every strength bucket in order`
    );
    assert.ok("strongPlusSignals" in pair.summary, `${pair.pairCode}: summary must separate Strong+ from all signals`);

    if (pair.available) {
      const bucketTotal = pair.bucketSummaryRows.reduce((sum, row) => sum + row.total, 0);
      assert.equal(bucketTotal, pair.summary.tradableSignals, `${pair.pairCode}: bucket totals must reconcile to tradable signals`);
      assert.ok(Array.isArray(pair.tradableRows) && pair.tradableRows.length === pair.summary.tradableSignals,
        `${pair.pairCode}: per-row diagnostics must cover every tradable signal`);
      const sample = pair.tradableRows[0];
      for (const field of ["date", "pair", "layer", "callDirection", "bucketKey", "ohlcSource", "ohlcInstrument", "high", "low", "dayRange", "l2lDistance", "rangeAvailable", "rangeMargin"]) {
        assert.ok(field in sample, `${pair.pairCode}: tradable row diagnostics must include ${field}`);
      }
    }
  });
});

test("contract: the checked-in artifact is exactly what the builder produces", () => {
  const stdout = execFileSync(process.execPath, [VALIDATOR_PATH], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const report = JSON.parse(stdout);
  assert.equal(report.status, "PASS", `validator errors: ${JSON.stringify(report.errors)}`);
});
