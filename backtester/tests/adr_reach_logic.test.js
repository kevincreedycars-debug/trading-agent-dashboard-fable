const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("node:child_process");

const {
  ADR_WINDOW_SESSIONS,
  CONFIDENCE_BUCKETS,
  normalizeReachDirection,
  computeAdrFromSessions,
  resolveL2lDistance,
  evaluateIntradayReach
} = require("../lib/adr_reach_logic");

const ARTIFACT_PATH = path.resolve(__dirname, "../../data/adr-reach-research.json");
const VALIDATOR_PATH = path.resolve(__dirname, "../scripts/validate_adr_reach_research.js");
const BUCKET_KEYS = CONFIDENCE_BUCKETS.map((bucket) => bucket.key);

test("bullish reach wins when the day high touches open + L2L distance", () => {
  const result = evaluateIntradayReach({ direction: "BULLISH", open: 100, high: 106, low: 98, l2lDistance: 5 });
  assert.equal(result.status, "WIN");
  assert.equal(result.requiredTarget, 105);
  assert.equal(result.reachedVia, "high");
});

test("bullish reach misses when the day high stops short of open + L2L distance", () => {
  const result = evaluateIntradayReach({ direction: "BULLISH", open: 100, high: 104.9, low: 98, l2lDistance: 5 });
  assert.equal(result.status, "MISS");
  assert.equal(result.requiredTarget, 105);
});

test("bearish reach wins when the day low touches open - L2L distance", () => {
  const result = evaluateIntradayReach({ direction: "BEARISH", open: 100, high: 101, low: 94, l2lDistance: 5 });
  assert.equal(result.status, "WIN");
  assert.equal(result.requiredTarget, 95);
  assert.equal(result.reachedVia, "low");
});

test("bearish reach misses when the day low stops short of open - L2L distance", () => {
  const result = evaluateIntradayReach({ direction: "BEARISH", open: 100, high: 101, low: 95.1, l2lDistance: 5 });
  assert.equal(result.status, "MISS");
  assert.equal(result.requiredTarget, 95);
});

test("touching the target exactly counts as reached", () => {
  const bullish = evaluateIntradayReach({ direction: "BULLISH", open: 100, high: 105, low: 99, l2lDistance: 5 });
  assert.equal(bullish.status, "WIN");
  const bearish = evaluateIntradayReach({ direction: "BEARISH", open: 100, high: 101, low: 95, l2lDistance: 5 });
  assert.equal(bearish.status, "WIN");
});

test("the close never changes the outcome once the intraday target was touched", () => {
  // Bullish call touches 105 intraday but the day closes far below the open:
  // still a WIN, because reach is measured against the high, never the close.
  const bullishReversal = evaluateIntradayReach({ direction: "BULLISH", open: 100, high: 106, low: 90, l2lDistance: 5 });
  assert.equal(bullishReversal.status, "WIN");

  // Bearish call touches 95 intraday but closes above the open: still a WIN.
  const bearishReversal = evaluateIntradayReach({ direction: "BEARISH", open: 100, high: 103, low: 94, l2lDistance: 5 });
  assert.equal(bearishReversal.status, "WIN");

  // Bullish day that closes up strongly but never touches the target: still a MISS.
  const bullishCloseUp = evaluateIntradayReach({ direction: "BULLISH", open: 100, high: 104.9, low: 99.5, l2lDistance: 5 });
  assert.equal(bullishCloseUp.status, "MISS");
});

test("long/short synonyms map onto bullish/bearish", () => {
  assert.equal(normalizeReachDirection("LONG"), "BULLISH");
  assert.equal(normalizeReachDirection("SHORT"), "BEARISH");
  assert.equal(evaluateIntradayReach({ direction: "LONG", open: 100, high: 106, low: 98, l2lDistance: 5 }).status, "WIN");
  assert.equal(evaluateIntradayReach({ direction: "SHORT", open: 100, high: 101, low: 94, l2lDistance: 5 }).status, "WIN");
});

test("non-directional calls are no-trade, not losses", () => {
  const flat = evaluateIntradayReach({ direction: "FLAT", open: 100, high: 106, low: 94, l2lDistance: 5 });
  assert.equal(flat.status, "NO_TRADE");
  assert.equal(flat.reason, "non_directional");
  assert.equal(evaluateIntradayReach({ direction: "", open: 100, high: 106, low: 94, l2lDistance: 5 }).status, "NO_TRADE");
});

test("missing inputs are invalid instead of silently evaluated", () => {
  assert.equal(evaluateIntradayReach({ direction: "BULLISH", open: null, high: 106, low: 98, l2lDistance: 5 }).reason, "missing_open");
  assert.equal(evaluateIntradayReach({ direction: "BULLISH", open: 100, high: NaN, low: 98, l2lDistance: 5 }).reason, "missing_high_low");
  assert.equal(evaluateIntradayReach({ direction: "BULLISH", open: 100, high: 106, low: 98, l2lDistance: null }).reason, "missing_l2l_distance");
});

test("ADR window is strict about session count and L2L distance derives from it", () => {
  const sessions = Array.from({ length: ADR_WINDOW_SESSIONS }, () => ({ high: 110, low: 100 }));
  const adr = computeAdrFromSessions(sessions);
  assert.equal(adr, 10);
  assert.equal(resolveL2lDistance(adr, 50), 5);
  assert.equal(computeAdrFromSessions(sessions.slice(0, ADR_WINDOW_SESSIONS - 1)), null);
  assert.equal(computeAdrFromSessions([...sessions.slice(0, ADR_WINDOW_SESSIONS - 1), { high: null, low: 100 }]), null);
});

test("contract: ADR reach artifact groups results by Layer 1 asset, Layer 2 pair, and strength bucket", () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

  assert.ok(artifact.meta.win_definition.includes("close is ignored"), "win definition must state that the close is ignored");
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
    assert.ok("strongPlusAdrReachWinPct" in asset.summary, `${asset.assetCode}: summary must report Strong+ win rate`);
    assert.ok(asset.diagnostics, `${asset.assetCode}: per-asset diagnostics must be published`);

    if (asset.available) {
      const bucketTotal = asset.bucketSummaryRows.reduce((sum, row) => sum + row.total, 0);
      assert.equal(bucketTotal, asset.summary.evaluatedCalls, `${asset.assetCode}: bucket totals must reconcile to evaluated calls`);
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
    assert.ok(pair.diagnostics, `${pair.pairCode}: per-pair diagnostics must be published`);

    if (pair.available) {
      const bucketTotal = pair.bucketSummaryRows.reduce((sum, row) => sum + row.total, 0);
      assert.equal(bucketTotal, pair.summary.tradableSignals, `${pair.pairCode}: bucket totals must reconcile to tradable signals`);
    }
  });
});

test("contract: the checked-in artifact is exactly what the builder produces", () => {
  const stdout = execFileSync(process.execPath, [VALIDATOR_PATH], { encoding: "utf8" });
  const report = JSON.parse(stdout);
  assert.equal(report.status, "PASS", `validator errors: ${JSON.stringify(report.errors)}`);
});
