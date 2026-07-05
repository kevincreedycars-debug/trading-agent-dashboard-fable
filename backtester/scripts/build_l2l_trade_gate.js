#!/usr/bin/env node

"use strict";

// Builds data/l2l-trade-gate.json, the downstream artifact behind the
// dashboard's "L2L Trade Gate" and "Directional Call Trust" tabs.
//
// Everything here is derived from data/adr-reach-research.json plus the same
// checked-in hourly caches its builder used. No replay, checker, confidence,
// pair-selection, or L2L semantics are recalculated or changed.
//
// Two distinct questions are answered per call type (leans separated):
//
//   1. L2L trade gate — when this call appears, how often did price make a
//      guaranteed swing of at least 50/55/60% of ADR20 in the call direction
//      at some point during the day (1H-verified lower bounds)? Each rate is
//      shown next to the any-day base rate for that same direction, so base
//      rate and added edge stay visibly separate. The trust summary applies
//      the agreed rule: trusted = hit rate at the 55% threshold > 60%.
//
//   2. Directional call trust — when this call appears, how often was the
//      close-to-close checker verdict CORRECT (ex-flat, ex-not-evaluable)?
//      Same trust rule: accuracy > 60%.
//
// Layer 2 directional trust joins tradable pair rows back to the target
// asset's checker verdict via predictionId (the pair instrument is the same
// instrument each Layer 1 asset is benchmarked against).

const fs = require("fs");
const path = require("path");
const { parseDelimited } = require("../lib/historical_common");
const { computeGuaranteedDirectionalMoves } = require("../lib/l2l_range_logic");

const ARTIFACT_PATH = path.resolve(__dirname, "../../data/adr-reach-research.json");
const OUTPUT_PATH = path.resolve(__dirname, "../../data/l2l-trade-gate.json");
const CACHE_DIR = path.resolve(__dirname, "../cache/ohlc");

const HOURLY_CACHE_BY_ASSET = {
  EUR: path.resolve(CACHE_DIR, "eur_usd_h1_oanda.csv"),
  GOLD: path.resolve(CACHE_DIR, "xau_usd_h1_oanda.csv"),
  NQ: path.resolve(CACHE_DIR, "nas100_usd_h1_oanda.csv"),
  BTC: path.resolve(CACHE_DIR, "btcusdt_h1_binance.csv")
};
const TARGET_ASSET_BY_PAIR = { EUR_USD: "EUR", XAU_USD: "GOLD", NQ_USD: "NQ", BTC_USD: "BTC" };
const THRESHOLDS = [50, 55, 60];
const TRUST_THRESHOLD_PCT = 55;
const TRUST_CUTOFF_PCT = 60;
const SMALL_SAMPLE_BELOW = 30;

const CALL_TYPE_ORDER = [
  { key: "BULLISH", label: "Bullish (clear)", direction: "BULLISH" },
  { key: "BULLISH_LEAN", label: "Bullish lean", direction: "BULLISH" },
  { key: "BEARISH", label: "Bearish (clear)", direction: "BEARISH" },
  { key: "BEARISH_LEAN", label: "Bearish lean", direction: "BEARISH" }
];
const SIDE_ORDER = [
  { key: "BUY", label: "Buy signal", direction: "BULLISH" },
  { key: "SELL", label: "Sell signal", direction: "BEARISH" }
];
const BUCKET_ORDER = [
  { key: "WEAK", label: "Weak" },
  { key: "MODERATE", label: "Moderate" },
  { key: "STRONG", label: "Strong" },
  { key: "VERY_STRONG", label: "Very Strong" }
];

function round1(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function pct(numerator, denominator) {
  return denominator ? round1((100 * numerator) / denominator) : null;
}

function loadHourlyByDate(cachePath) {
  const rows = parseDelimited(fs.readFileSync(cachePath, "utf8"));
  const byDate = new Map();
  for (const row of rows) {
    if (String(row.complete || "").trim().toLowerCase() === "false") continue;
    const date = String(row.date || "").trim();
    const candle = {
      time: String(row.time || "").trim(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close)
    };
    if (!date || !candle.time || [candle.open, candle.high, candle.low, candle.close].some((v) => !Number.isFinite(v))) {
      continue;
    }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(candle);
  }
  byDate.forEach((candles) => candles.sort((a, b) => a.time.localeCompare(b.time)));
  return byDate;
}

// One enriched record per evaluated artifact row: guaranteed moves in both
// directions plus the fields the gate and trust views group by.
function enrichRows(rows, hourlyByDate) {
  const enriched = [];
  let outcomeMismatches = 0;

  for (const row of rows) {
    const candles = hourlyByDate.get(row.date) || [];
    const moves = computeGuaranteedDirectionalMoves(candles);
    if (!moves.candlesUsed) continue;
    const adr20 = Number(row.adr20) || 2 * Number(row.l2lDistance);
    if (!Number.isFinite(adr20) || adr20 <= 0) continue;

    const direction = String(row.callDirection || "").toUpperCase();
    const callMove = direction === "BULLISH" ? moves.maxUp : moves.maxDown;
    if ((row.outcomeKey === "WIN") !== (callMove >= Number(row.l2lDistance))) outcomeMismatches += 1;

    enriched.push({
      predictionId: row.predictionId || null,
      date: row.date,
      raw: String(row.directionRaw || direction).toUpperCase(),
      direction,
      bucketKey: row.bucketKey || null,
      adr20,
      maxUp: moves.maxUp,
      maxDown: moves.maxDown,
      checkerResult: row.checkerResult || null
    });
  }

  return { enriched, outcomeMismatches };
}

function hitAtThreshold(record, direction, thresholdPct) {
  const distance = record.adr20 * (thresholdPct / 100);
  return (direction === "BULLISH" ? record.maxUp : record.maxDown) >= distance;
}

function hitRates(records, direction) {
  const rates = {};
  for (const t of THRESHOLDS) {
    rates[t] = pct(records.filter((r) => hitAtThreshold(r, direction, t)).length, records.length);
  }
  return rates;
}

function baseRates(records) {
  const base = {};
  for (const t of THRESHOLDS) {
    base[t] = {
      up: pct(records.filter((r) => hitAtThreshold(r, "BULLISH", t)).length, records.length),
      down: pct(records.filter((r) => hitAtThreshold(r, "BEARISH", t)).length, records.length)
    };
  }
  return base;
}

function buildGateGroup(records, splitDefs, splitField) {
  const base = baseRates(records);
  const splits = [];

  for (const def of splitDefs) {
    const subset = records.filter((r) => r[splitField] === def.key);
    if (!subset.length) continue;
    const hits = hitRates(subset, def.direction);
    const edge = {};
    for (const t of THRESHOLDS) {
      const baseline = def.direction === "BULLISH" ? base[t].up : base[t].down;
      edge[t] = hits[t] === null || baseline === null ? null : round1(hits[t] - baseline);
    }
    splits.push({
      key: def.key,
      label: def.label,
      direction: def.direction,
      n: subset.length,
      smallSample: subset.length < SMALL_SAMPLE_BELOW,
      hitPct: hits,
      edgePct: edge,
      trusted: hits[TRUST_THRESHOLD_PCT] !== null && hits[TRUST_THRESHOLD_PCT] > TRUST_CUTOFF_PCT
    });
  }

  const buckets = [];
  for (const bucket of BUCKET_ORDER) {
    const subset = records.filter((r) => r.bucketKey === bucket.key);
    if (!subset.length) continue;
    const hits = {};
    for (const t of THRESHOLDS) {
      hits[t] = pct(subset.filter((r) => hitAtThreshold(r, r.direction, t)).length, subset.length);
    }
    buckets.push({ bucketKey: bucket.key, bucketLabel: bucket.label, n: subset.length, hitPct: hits });
  }

  return { n: records.length, baseRates: base, splits, buckets };
}

function directionalStats(records, resolveResult) {
  let correct = 0;
  let wrong = 0;
  let flat = 0;
  let unmatched = 0;

  for (const record of records) {
    const result = resolveResult(record);
    if (result === "CORRECT") correct += 1;
    else if (result === "WRONG") wrong += 1;
    else if (result === "FLAT") flat += 1;
    else unmatched += 1;
  }

  const evaluable = correct + wrong;
  const accuracyPct = pct(correct, evaluable);
  return {
    evaluable,
    correct,
    wrong,
    flat,
    unmatched,
    accuracyPct,
    smallSample: evaluable < SMALL_SAMPLE_BELOW,
    trusted: accuracyPct !== null && accuracyPct > TRUST_CUTOFF_PCT
  };
}

function main() {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const hourlyCache = new Map();
  const layer1 = [];
  const layer2 = [];
  const directionalLayer1 = [];
  const directionalLayer2 = [];
  const trustSummary = [];
  let totalMismatches = 0;

  const enrichedByAsset = new Map();
  const checkerByPredictionId = new Map();

  for (const asset of artifact.layer1.assets) {
    if (!asset.available || !Array.isArray(asset.evaluatedRows)) continue;
    const cachePath = HOURLY_CACHE_BY_ASSET[asset.assetCode];
    if (!cachePath || !fs.existsSync(cachePath)) {
      throw new Error(`Hourly cache missing for ${asset.assetCode}: ${cachePath}`);
    }
    if (!hourlyCache.has(asset.assetCode)) hourlyCache.set(asset.assetCode, loadHourlyByDate(cachePath));

    const { enriched, outcomeMismatches } = enrichRows(asset.evaluatedRows, hourlyCache.get(asset.assetCode));
    totalMismatches += outcomeMismatches;
    enrichedByAsset.set(asset.assetCode, enriched);
    for (const record of enriched) {
      if (record.predictionId) checkerByPredictionId.set(record.predictionId, record.checkerResult);
    }

    const gate = buildGateGroup(enriched, CALL_TYPE_ORDER, "raw");
    layer1.push({ assetCode: asset.assetCode, assetLabel: asset.assetLabel, ...gate });

    const callTypes = [];
    for (const def of CALL_TYPE_ORDER) {
      const subset = enriched.filter((r) => r.raw === def.key);
      if (!subset.length) continue;
      callTypes.push({
        key: def.key,
        label: def.label,
        direction: def.direction,
        ...directionalStats(subset, (r) => r.checkerResult)
      });
    }
    directionalLayer1.push({ assetCode: asset.assetCode, assetLabel: asset.assetLabel, callTypes });

    for (const split of gate.splits) {
      trustSummary.push({
        layer: "layer1",
        groupLabel: asset.assetLabel,
        signalLabel: split.label,
        n: split.n,
        smallSample: split.smallSample,
        hitPctAtTrustThreshold: split.hitPct[TRUST_THRESHOLD_PCT],
        edgePctAtTrustThreshold: split.edgePct[TRUST_THRESHOLD_PCT],
        trusted: split.trusted
      });
    }
  }

  for (const pair of artifact.layer2.pairs) {
    if (!pair.available || !Array.isArray(pair.tradableRows)) continue;
    const targetAsset = TARGET_ASSET_BY_PAIR[pair.pairCode];
    const cachePath = HOURLY_CACHE_BY_ASSET[targetAsset];
    if (!cachePath || !fs.existsSync(cachePath)) {
      throw new Error(`Hourly cache missing for pair ${pair.pairCode}`);
    }
    if (!hourlyCache.has(targetAsset)) hourlyCache.set(targetAsset, loadHourlyByDate(cachePath));

    const { enriched, outcomeMismatches } = enrichRows(pair.tradableRows, hourlyCache.get(targetAsset));
    totalMismatches += outcomeMismatches;
    for (const record of enriched) {
      record.side = record.direction === "BULLISH" ? "BUY" : "SELL";
    }

    const gate = buildGateGroup(enriched, SIDE_ORDER, "side");
    layer2.push({ pairCode: pair.pairCode, pairLabel: pair.pairLabel, targetAssetCode: targetAsset, ...gate });

    const sides = [];
    for (const def of SIDE_ORDER) {
      const subset = enriched.filter((r) => r.side === def.key);
      if (!subset.length) continue;
      sides.push({
        key: def.key,
        label: def.label,
        direction: def.direction,
        ...directionalStats(subset, (r) => (r.predictionId ? checkerByPredictionId.get(r.predictionId) || null : null))
      });
    }
    directionalLayer2.push({ pairCode: pair.pairCode, pairLabel: pair.pairLabel, targetAssetCode: targetAsset, sides });

    for (const split of gate.splits) {
      trustSummary.push({
        layer: "layer2",
        groupLabel: pair.pairLabel,
        signalLabel: split.label,
        n: split.n,
        smallSample: split.smallSample,
        hitPctAtTrustThreshold: split.hitPct[TRUST_THRESHOLD_PCT],
        edgePctAtTrustThreshold: split.edgePct[TRUST_THRESHOLD_PCT],
        trusted: split.trusted
      });
    }
  }

  if (totalMismatches > 0) {
    throw new Error(`Recomputed L2L outcomes disagree with the source artifact on ${totalMismatches} rows`);
  }

  const output = {
    meta: {
      generated_at: new Date().toISOString(),
      source: "backtester/scripts/build_l2l_trade_gate.js",
      upstream_artifact: "data/adr-reach-research.json",
      thresholds_pct_of_adr20: THRESHOLDS,
      hit_definition: "A hit means a guaranteed complete swing of at least the threshold percentage of ADR20 occurred in the call direction at some point during the trading day, verified from 1-hour candles as lower bounds (within-hour sequence never assumed).",
      edge_definition: "Edge = hit rate minus the any-day base rate for the same direction over the same evaluated days: what the call adds over taking that direction with no call at all.",
      trust_rule: `Trusted = hit rate at the ${TRUST_THRESHOLD_PCT}% of ADR20 threshold above ${TRUST_CUTOFF_PCT}%.`,
      directional_trust_rule: `Trusted = close-to-close checker accuracy (ex-flat, ex-not-evaluable) above ${TRUST_CUTOFF_PCT}%.`,
      confidence_note: "At present the signal strength / confidence score is unreliable for this kind of directional confluence: hit rates do not rise with confidence and Very Strong is the worst bucket in most groups. Do not size or filter by it.",
      small_sample_below: SMALL_SAMPLE_BELOW
    },
    layer1,
    layer2,
    trustSummary,
    directional: {
      layer1: directionalLayer1,
      layer2: directionalLayer2
    }
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(path.resolve(__dirname, "../.."), OUTPUT_PATH)}`);
  console.log(`Layer 1 groups: ${layer1.length}, Layer 2 groups: ${layer2.length}, trust rows: ${trustSummary.length}`);
}

main();
