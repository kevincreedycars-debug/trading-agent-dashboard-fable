#!/usr/bin/env node

"use strict";

// Downstream-only reliability analysis for the L2L Move Research artifact.
//
// The L2L Move win definition ("price made a complete move of at least the
// L2L distance in the call direction at some point during the day") can be
// satisfied on many days by BOTH directions at once, because 50% of ADR20 is
// a small fraction of a typical day's total travel. A headline win rate near
// 70% is therefore not evidence of directional skill by itself.
//
// This script separates base rate from skill. For every evaluated call row in
// data/adr-reach-research.json it recomputes the guaranteed directional move
// in BOTH directions from the same hourly caches the builder used, then
// reports, per asset and per pair:
//
//   1. the base rates: how often a permanent-bull or permanent-bear caller
//      would have "won" on the same days, and how often both directions win
//      at once (days where the call direction cannot matter);
//   2. the skill test: on discriminating days (exactly one direction wins),
//      how often the model picked the winning direction, with a binomial
//      z-test against the 50% coin-flip null;
//   3. the no-skill expectation: expected win rate for a caller with the
//      model's bull/bear call frequencies but no day-level information, and
//      the z-score of the model's observed wins against that null;
//   4. confidence calibration on discriminating days per bucket;
//   5. the close-to-close checker verdict for the same rows, as a second lens.
//
// Reads only checked-in artifacts and caches. Changes nothing.

const fs = require("fs");
const path = require("path");
const { parseDelimited } = require("../lib/historical_common");
const { computeGuaranteedDirectionalMoves } = require("../lib/l2l_range_logic");

const ARTIFACT_PATH = path.resolve(__dirname, "../../data/adr-reach-research.json");
const CACHE_DIR = path.resolve(__dirname, "../cache/ohlc");

const HOURLY_CACHE_BY_ASSET = {
  EUR: path.resolve(CACHE_DIR, "eur_usd_h1_oanda.csv"),
  GOLD: path.resolve(CACHE_DIR, "xau_usd_h1_oanda.csv"),
  NQ: path.resolve(CACHE_DIR, "nas100_usd_h1_oanda.csv"),
  BTC: path.resolve(CACHE_DIR, "btcusdt_h1_binance.csv")
};
const TARGET_ASSET_BY_PAIR = {
  EUR_USD: "EUR",
  XAU_USD: "GOLD",
  NQ_USD: "NQ",
  BTC_USD: "BTC"
};
const BUCKET_ORDER = ["WEAK", "MODERATE", "STRONG", "VERY_STRONG"];

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

// Standard normal two-sided p-value from a z-score (erfc approximation).
function twoSidedP(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function fmtPct(value) {
  return value === null ? "--" : `${value.toFixed(1)}%`;
}

function analyzeRows(label, rows, hourlyByDate) {
  const enriched = [];
  let outcomeMismatches = 0;

  for (const row of rows) {
    const candles = hourlyByDate.get(row.date) || [];
    const moves = computeGuaranteedDirectionalMoves(candles);
    if (!moves.candlesUsed) continue;
    const distance = Number(row.l2lDistance);
    if (!Number.isFinite(distance) || distance <= 0) continue;

    const bullWin = moves.maxUp >= distance;
    const bearWin = moves.maxDown >= distance;
    const direction = String(row.callDirection || "").toUpperCase();
    const callWin = direction === "BULLISH" ? bullWin : bearWin;
    if ((row.outcomeKey === "WIN") !== callWin) outcomeMismatches += 1;

    enriched.push({
      date: row.date,
      year: String(row.date).slice(0, 4),
      direction,
      bucketKey: row.bucketKey || null,
      confidence: Number(row.confidencePct ?? row.combinedConfidencePct),
      bullWin,
      bearWin,
      callWin,
      checkerResult: row.checkerResult || null
    });
  }

  const n = enriched.length;
  if (!n) {
    console.log(`\n=== ${label}: no analyzable rows ===`);
    return null;
  }

  const wins = enriched.filter((r) => r.callWin).length;
  const bullDays = enriched.filter((r) => r.bullWin).length;
  const bearDays = enriched.filter((r) => r.bearWin).length;
  const bothDays = enriched.filter((r) => r.bullWin && r.bearWin).length;
  const neitherDays = enriched.filter((r) => !r.bullWin && !r.bearWin).length;
  const bullCalls = enriched.filter((r) => r.direction === "BULLISH").length;
  const bullCallFreq = bullCalls / n;

  // Discriminating days: exactly one direction reached the L2L distance, so
  // the call direction decides the outcome. This is where skill can show up.
  const disc = enriched.filter((r) => r.bullWin !== r.bearWin);
  const discCorrect = disc.filter((r) => r.callWin).length;
  const discN = disc.length;
  const discZ = discN ? (discCorrect - discN / 2) / Math.sqrt(discN / 4) : null;

  // No-skill null preserving the model's call frequency: on each day a caller
  // with no information picks bull with probability bullCallFreq.
  let expectedWins = 0;
  let varianceWins = 0;
  for (const r of enriched) {
    const p = bullCallFreq * (r.bullWin ? 1 : 0) + (1 - bullCallFreq) * (r.bearWin ? 1 : 0);
    expectedWins += p;
    varianceWins += p * (1 - p);
  }
  const skillZ = varianceWins > 0 ? (wins - expectedWins) / Math.sqrt(varianceWins) : null;

  const checkerEvaluable = enriched.filter((r) => r.checkerResult === "CORRECT" || r.checkerResult === "WRONG");
  const checkerCorrect = checkerEvaluable.filter((r) => r.checkerResult === "CORRECT").length;

  console.log(`\n=== ${label} ===`);
  console.log(`rows analyzed: ${n} (outcome mismatches vs artifact: ${outcomeMismatches})`);
  console.log(`model L2L win rate:        ${fmtPct(pct(wins, n))} (${wins}/${n})`);
  console.log(`always-BULL would win:     ${fmtPct(pct(bullDays, n))}   always-BEAR: ${fmtPct(pct(bearDays, n))}`);
  console.log(`BOTH directions win:       ${fmtPct(pct(bothDays, n))} (${bothDays})   neither: ${fmtPct(pct(neitherDays, n))} (${neitherDays})`);
  console.log(`no-skill expected (call-freq matched, bull freq ${(bullCallFreq * 100).toFixed(1)}%): ${fmtPct(pct(expectedWins, n))}`);
  if (skillZ !== null) {
    console.log(`skill vs no-skill null:    +${((wins - expectedWins) / n * 100).toFixed(1)} pts, z=${skillZ.toFixed(2)}, p=${twoSidedP(skillZ).toFixed(4)}`);
  }
  if (discN) {
    console.log(`discriminating days:       ${discN} (${fmtPct(pct(discN, n))} of rows) -> model correct ${fmtPct(pct(discCorrect, discN))} (${discCorrect}/${discN}), z=${discZ.toFixed(2)}, p=${twoSidedP(discZ).toFixed(4)}`);
  }
  if (checkerEvaluable.length) {
    console.log(`close-to-close (checker):  ${fmtPct(pct(checkerCorrect, checkerEvaluable.length))} correct (${checkerCorrect}/${checkerEvaluable.length} ex-flat ex-not-evaluable)`);
  }

  console.log(`by confidence bucket (all rows | discriminating days):`);
  for (const bucketKey of BUCKET_ORDER) {
    const all = enriched.filter((r) => r.bucketKey === bucketKey);
    if (!all.length) continue;
    const allWins = all.filter((r) => r.callWin).length;
    const d = all.filter((r) => r.bullWin !== r.bearWin);
    const dCorrect = d.filter((r) => r.callWin).length;
    console.log(
      `  ${bucketKey.padEnd(12)} n=${String(all.length).padStart(4)} win=${fmtPct(pct(allWins, all.length)).padStart(6)}` +
      ` | disc n=${String(d.length).padStart(4)} correct=${d.length ? fmtPct(pct(dCorrect, d.length)) : "--"}`
    );
  }

  console.log(`by year (model win | no-skill expected | disc correct):`);
  const years = [...new Set(enriched.map((r) => r.year))].sort();
  for (const year of years) {
    const yr = enriched.filter((r) => r.year === year);
    const yrWins = yr.filter((r) => r.callWin).length;
    const yrBullFreq = yr.filter((r) => r.direction === "BULLISH").length / yr.length;
    const yrExpected = yr.reduce((sum, r) => sum + yrBullFreq * (r.bullWin ? 1 : 0) + (1 - yrBullFreq) * (r.bearWin ? 1 : 0), 0);
    const d = yr.filter((r) => r.bullWin !== r.bearWin);
    const dCorrect = d.filter((r) => r.callWin).length;
    console.log(
      `  ${year} n=${String(yr.length).padStart(4)} win=${fmtPct(pct(yrWins, yr.length)).padStart(6)}` +
      ` exp=${fmtPct(pct(yrExpected, yr.length)).padStart(6)}` +
      ` | disc ${dCorrect}/${d.length}${d.length ? ` (${fmtPct(pct(dCorrect, d.length))})` : ""}`
    );
  }

  return {
    label,
    n,
    wins,
    bullDays,
    bearDays,
    bothDays,
    neitherDays,
    expectedWins,
    skillZ,
    discN,
    discCorrect,
    discZ,
    checkerCorrect,
    checkerEvaluable: checkerEvaluable.length,
    outcomeMismatches
  };
}

function main() {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const hourlyCache = new Map();
  const results = [];

  for (const asset of artifact.layer1.assets) {
    if (!asset.available || !Array.isArray(asset.evaluatedRows)) continue;
    const cachePath = HOURLY_CACHE_BY_ASSET[asset.assetCode];
    if (!cachePath || !fs.existsSync(cachePath)) {
      console.log(`\n=== Layer 1 ${asset.assetCode}: hourly cache missing, skipped ===`);
      continue;
    }
    if (!hourlyCache.has(asset.assetCode)) hourlyCache.set(asset.assetCode, loadHourlyByDate(cachePath));
    results.push(analyzeRows(`Layer 1 ${asset.assetCode}`, asset.evaluatedRows, hourlyCache.get(asset.assetCode)));
  }

  for (const pair of artifact.layer2.pairs) {
    if (!pair.available || !Array.isArray(pair.tradableRows)) continue;
    const targetAsset = TARGET_ASSET_BY_PAIR[pair.pairCode];
    const cachePath = HOURLY_CACHE_BY_ASSET[targetAsset];
    if (!cachePath || !fs.existsSync(cachePath)) continue;
    if (!hourlyCache.has(targetAsset)) hourlyCache.set(targetAsset, loadHourlyByDate(cachePath));
    results.push(analyzeRows(`Layer 2 ${pair.pairLabel}`, pair.tradableRows, hourlyCache.get(targetAsset)));
  }

  const mismatches = results.filter(Boolean).reduce((sum, r) => sum + r.outcomeMismatches, 0);
  console.log(`\nTotal outcome mismatches vs artifact across all groups: ${mismatches} (0 expected)`);
}

main();
