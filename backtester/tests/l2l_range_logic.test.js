const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("node:child_process");

const {
  ADR_WINDOW_SESSIONS,
  RANGE_AVAILABILITY_NOTE,
  DIRECTIONAL_MOVE_NOTE,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateL2lRangeAvailability,
  computeGuaranteedDirectionalMoves,
  evaluateL2lDirectionalMove
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

test("a midday rally of at least L2L wins a bullish call even on a down day", () => {
  // Price opens 110, bleeds to 100, rallies to 105.2 (a 5.2 upswing), then
  // breaks lower into the close. The day closes far below its open, yet the
  // bullish call wins because a complete L2L-sized upmove happened intraday.
  const candles = [
    { open: 110, high: 110.5, low: 107, close: 107.2 },
    { open: 107.2, high: 107.5, low: 100, close: 100.4 },
    { open: 100.4, high: 103, low: 100.2, close: 102.8 },
    { open: 102.8, high: 105.2, low: 102.5, close: 103 },
    { open: 103, high: 103.2, low: 98, close: 98.5 }
  ];
  const result = evaluateL2lDirectionalMove({ direction: "BULLISH", candles, l2lDistance: 5 });
  assert.equal(result.status, "MOVED");
  assert.equal(result.moveAchieved, true);
  assert.ok(result.maxDirectionalMove >= 5.2 - 1e-9);
  assert.equal(result.note, DIRECTIONAL_MOVE_NOTE);
});

test("a sub-L2L recovery does not win a bullish call", () => {
  // Same down-day shape, but the best recovery is only 4.9: a miss.
  const candles = [
    { open: 110, high: 110.4, low: 106, close: 106.2 },
    { open: 106.2, high: 106.4, low: 100, close: 100.5 },
    { open: 100.5, high: 104.9, low: 100.3, close: 104.5 },
    { open: 104.5, high: 104.7, low: 99, close: 99.2 }
  ];
  const result = evaluateL2lDirectionalMove({ direction: "BULLISH", candles, l2lDistance: 5 });
  assert.equal(result.status, "NOT_MOVED");
  assert.equal(result.moveAchieved, false);
  assert.ok(Math.abs(result.maxDirectionalMove - 4.9) < 1e-9);
});

test("a midday drop of at least L2L wins a bearish call even when the day closes higher", () => {
  const candles = [
    { open: 100, high: 100.5, low: 99.8, close: 100.2 },
    { open: 100.2, high: 100.4, low: 95, close: 95.3 },
    { open: 95.3, high: 101.5, low: 95.2, close: 101.2 }
  ];
  const result = evaluateL2lDirectionalMove({ direction: "BEARISH", candles, l2lDistance: 5 });
  assert.equal(result.status, "MOVED");
});

test("within-hour sequence is never assumed: only provable moves count", () => {
  // One candle, range 5.5. For a bullish call the only PROVABLE upswings are
  // high - open (0.5) and close - low (0.2), so bullish misses. For a bearish
  // call open - low (5) and high - close (5.3) are provable, so bearish wins.
  const candle = { open: 105, high: 105.5, low: 100, close: 100.2 };
  const bullish = evaluateL2lDirectionalMove({ direction: "BULLISH", candles: [candle], l2lDistance: 5 });
  const bearish = evaluateL2lDirectionalMove({ direction: "BEARISH", candles: [candle], l2lDistance: 5 });
  assert.equal(bullish.status, "NOT_MOVED");
  assert.equal(bearish.status, "MOVED");
  // Daily range availability alone would have called both directions available.
  const range = evaluateL2lRangeAvailability({ direction: "BULLISH", high: 105.5, low: 100, l2lDistance: 5 });
  assert.equal(range.rangeAvailable, true);
});

test("cross-candle swings combine an earlier low with a later high", () => {
  const moves = computeGuaranteedDirectionalMoves([
    { open: 104, high: 105, low: 103.5, close: 103.8 },
    { open: 103.8, high: 104, low: 99.9, close: 100 },
    { open: 100, high: 104.99, low: 99.95, close: 104.9 }
  ]);
  assert.ok(Math.abs(moves.maxUp - (104.99 - 99.9)) < 1e-9);
  assert.ok(Math.abs(moves.maxDown - (105 - 99.9)) < 1e-9);
  assert.equal(moves.candlesUsed, 3);
});

test("directional evaluation is invalid without intraday candles or L2L distance", () => {
  assert.equal(evaluateL2lDirectionalMove({ direction: "BULLISH", candles: [], l2lDistance: 5 }).reason, "missing_intraday_ohlc");
  assert.equal(evaluateL2lDirectionalMove({ direction: "BULLISH", candles: [{ open: 1, high: 2, low: 0.5, close: 1.5 }], l2lDistance: null }).reason, "missing_l2l_distance");
  assert.equal(evaluateL2lDirectionalMove({ direction: "FLAT", candles: [{ open: 1, high: 2, low: 0.5, close: 1.5 }], l2lDistance: 5 }).status, "NO_TRADE");
});

test("contract: artifact groups results by Layer 1 asset, Layer 2 pair, and strength bucket", () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.ok(artifact.meta.win_definition.includes("L2L Move"), "definition must be labelled L2L Move");
  assert.ok(artifact.meta.win_definition.includes("direction of the call"), "definition must require the move in the call direction");
  assert.ok(artifact.meta.win_definition.includes("1-hour"), "definition must state 1-hour verification");
  assert.ok(!artifact.meta.win_definition.toLowerCase().includes("adr reach"), "definition must not be called ADR Reach");
  assert.equal(artifact.meta.intraday_granularity, "H1");
  assert.equal(artifact.meta.directional_move_note, DIRECTIONAL_MOVE_NOTE);
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
      for (const field of ["date", "asset", "layer", "callDirection", "bucketKey", "ohlcSource", "ohlcInstrument", "open", "high", "low", "close", "dayRange", "l2lDistance", "maxDirectionalMove", "moveAchieved", "moveMargin", "hourlyCandleCount", "rangeAvailable", "rangeMargin"]) {
        assert.ok(field in sample, `${asset.assetCode}: evaluated row diagnostics must include ${field}`);
      }
      asset.evaluatedRows.forEach((row) => {
        if (row.outcomeKey === "WIN") {
          assert.ok(row.rangeAvailable, `${asset.assetCode} ${row.date}: a directional win requires the day range to contain the L2L distance`);
        }
      });
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
      for (const field of ["date", "pair", "layer", "callDirection", "bucketKey", "ohlcSource", "ohlcInstrument", "high", "low", "dayRange", "l2lDistance", "maxDirectionalMove", "moveAchieved", "moveMargin", "hourlyCandleCount", "rangeAvailable", "rangeMargin"]) {
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
