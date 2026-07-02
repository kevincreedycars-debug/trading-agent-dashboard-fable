#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  fetchAllRows,
  parseArgs,
  requireEnv
} = require("../lib/historical_common");
const { evaluateSingleMarket } = require("../lib/outcome_evaluation");
const { computeHeadlineConfidenceFromRow } = require("../lib/headline_confidence");
const { buildReplayOutput, parseLogicVersion } = require("../replay/btc/btc_replay_core");

const DEFAULT_START = "2024-01-02";
const DEFAULT_END = "2026-04-30";
const DEFAULT_OUTPUT = path.resolve(__dirname, "../../data/backtester-checker-btc-24h-2024-2026.json");
const DEFAULT_CALL_TIME_ET = "09:30:00";
const PERCENT_TOLERANCE = 0.5;
const BTC_24H_FLAT_THRESHOLD = 1.00;
const BTC_BENCHMARK_KEY = "btc_usd_spot";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function addDays(dateLiteral, days) {
  const date = new Date(`${dateLiteral}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDirection(value) {
  return value === null || value === undefined ? null : String(value).trim().toUpperCase();
}

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function compareExact(label, storedValue, rerunValue) {
  const stored = storedValue === null || storedValue === undefined ? null : String(storedValue);
  const rerun = rerunValue === null || rerunValue === undefined ? null : String(rerunValue);
  return {
    key: label,
    label,
    type: "exact",
    stored,
    rerun,
    difference: stored === rerun ? "0" : `${stored || "--"} -> ${rerun || "--"}`,
    status: stored === rerun ? "PASS" : "FAIL"
  };
}

function compareNumeric(label, storedValue, rerunValue, tolerance = PERCENT_TOLERANCE) {
  const stored = toNumber(storedValue);
  const rerun = toNumber(rerunValue);
  if (stored === null || rerun === null) {
    return {
      key: label,
      label,
      type: "numeric",
      stored,
      rerun,
      difference: null,
      tolerance,
      status: "MISSING"
    };
  }

  const difference = Number((rerun - stored).toFixed(3));
  const exact = Math.abs(difference) < 0.0001;
  return {
    key: label,
    label,
    type: "numeric",
    stored,
    rerun,
    difference,
    tolerance,
    status: exact ? "PASS" : (Math.abs(difference) <= tolerance ? "TOLERANCE" : "FAIL")
  };
}

function fieldStatusSummary(comparisons = []) {
  if (comparisons.some((item) => item.status === "MISSING")) return "MISSING_DATA";
  if (comparisons.some((item) => item.status === "FAIL")) return "FAIL";
  if (comparisons.some((item) => item.status === "TOLERANCE")) return "TOLERANCE_PASS";
  return "PASS";
}

async function loadStoredPredictions(supabaseUrl, serviceRoleKey, startDate, endDate) {
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "research_timeframe_predictions",
    (url) => {
      url.searchParams.set(
        "select",
        [
          "id",
          "observation_id",
          "timeframe",
          "legacy_timeframe_key",
          "predicted_direction",
          "predicted_conviction",
          "bull_case_pct",
          "bear_case_pct",
          "net_edge_pct",
          "participation_pct",
          "verdict_strength",
          "weighted_score",
          "conviction_model",
          "factor_breakdown",
          "logic_document_version",
          "observation:research_observations!inner(id,snapshot_date,asset_code,agent_name,source_workflow,market_snapshot)"
        ].join(",")
      );
      url.searchParams.set("timeframe", "eq.following 24hrs");
      url.searchParams.set("observation.snapshot_date", `gte.${startDate}`);
      url.searchParams.append("observation.snapshot_date", `lte.${endDate}`);
      url.searchParams.set("observation.agent_name", "eq.BTC");
      url.searchParams.set("observation.source_workflow", "eq.btc_historical_replay");
      url.searchParams.set("order", "observation(snapshot_date).asc");
    }
  );
}

async function loadStoredEvaluations(supabaseUrl, serviceRoleKey, startDate, endDate) {
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "research_prediction_evaluations",
    (url) => {
      url.searchParams.set(
        "select",
        [
          "prediction_id",
          "result",
          "result_reason",
          "open_price",
          "close_price",
          "pct_change",
          "flat_threshold_used",
          "evaluated_market",
          "evaluation_mode",
          "call_date",
          "call_time_et",
          "close_time_et",
          "agent_direction",
          "agent_conviction"
        ].join(",")
      );
      url.searchParams.set("timeframe", "eq.following 24hrs");
      url.searchParams.set("evaluated_market", "eq.BTCUSD");
      url.searchParams.set("evaluation_mode", "eq.primary");
      url.searchParams.set("call_date", `gte.${startDate}`);
      url.searchParams.append("call_date", `lte.${endDate}`);
      url.searchParams.set("asset_code", "eq.BTC");
      url.searchParams.set("order", "call_date.asc");
    }
  );
}

async function loadSnapshots(supabaseUrl, serviceRoleKey, startDate, endDate) {
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_btc_market_snapshots",
    (url) => {
      url.searchParams.set("select", "*");
      url.searchParams.set("snapshot_date", `gte.${startDate}`);
      url.searchParams.append("snapshot_date", `lte.${endDate}`);
      url.searchParams.set("order", "snapshot_date.asc");
    }
  );
}

async function loadPriceSeries(supabaseUrl, serviceRoleKey, startDate, endDate) {
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_price_series",
    (url) => {
      url.searchParams.set("select", "instrument_key,observation_date,close");
      url.searchParams.set("instrument_key", `in.(${BTC_BENCHMARK_KEY})`);
      url.searchParams.set("interval", "eq.daily");
      url.searchParams.set("observation_date", `gte.${startDate}`);
      url.searchParams.append("observation_date", `lte.${endDate}`);
      url.searchParams.set("order", "observation_date.asc");
    }
  );
}

function normalizeCallTimeEt(value) {
  if (!value) return DEFAULT_CALL_TIME_ET;
  const text = String(value);
  const timeMatch = text.match(/(\d{2}:\d{2}:\d{2})/);
  if (timeMatch) return timeMatch[1];
  const shortMatch = text.match(/(\d{2}:\d{2})/);
  if (shortMatch) return `${shortMatch[1]}:00`;
  return DEFAULT_CALL_TIME_ET;
}

function buildPriceMap(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.instrument_key}|${row.observation_date}`, toNumber(row.close));
  }
  return map;
}

function marketValueFromSnapshot(market, marketSnapshot) {
  if (market === "BTCUSD") return toNumber(marketSnapshot?.btc_price);
  return null;
}

function marketValueFromSeries(market, closeDate, priceMap) {
  if (market === "BTCUSD") return priceMap.get(`${BTC_BENCHMARK_KEY}|${closeDate}`) ?? null;
  return null;
}

function compareFactorBreakdown(storedBreakdown, rerunBreakdown) {
  const factorKeys = Array.from(new Set([
    ...Object.keys(safeObject(storedBreakdown)),
    ...Object.keys(safeObject(rerunBreakdown))
  ])).sort();

  return factorKeys.map((factorKey) => {
    const stored = safeObject(storedBreakdown)[factorKey] || {};
    const rerun = safeObject(rerunBreakdown)[factorKey] || {};
    const signal = compareExact(`${factorKey} signal`, stored.signal || null, rerun.signal || null);
    const weight = compareNumeric(`${factorKey} weight`, stored.weight, rerun.weight);
    return {
      factor_key: factorKey,
      signal,
      weight,
      status: fieldStatusSummary([signal, weight])
    };
  });
}

function storedPredictionConviction(prediction) {
  const convictionModel = safeObject(prediction?.conviction_model);
  return (
    toNumber(convictionModel.final_conviction) ??
    toNumber(convictionModel.raw_conviction) ??
    toNumber(prediction?.predicted_conviction)
  );
}

function buildRowComparison(prediction, snapshot, storedEvaluation, priceMap) {
  if (!snapshot || !storedEvaluation) {
    return {
      prediction_id: prediction.id,
      snapshot_date: prediction.observation?.snapshot_date || null,
      status: "MISSING_DATA",
      missing: {
        snapshot: !snapshot,
        evaluation: !storedEvaluation
      }
    };
  }

  const logicDocumentVersion = prediction.logic_document_version || parseLogicVersion();
  const rerunOutput = buildReplayOutput(snapshot, logicDocumentVersion);
  const rerun24h = rerunOutput.timeframe_models["24h"];
  const rerunConvictionModel = safeObject(rerun24h.conviction_model);
  const storedConvictionModel = safeObject(prediction.conviction_model);
  const storedWeighted = safeObject(prediction.weighted_score);
  const rerunWeighted = safeObject(rerun24h.weighted_score);
  const storedHeadlineConfidence = computeHeadlineConfidenceFromRow({
    ...prediction,
    predicted_direction: prediction.predicted_direction,
    conviction_model: storedConvictionModel
  }).value;
  const rerunHeadlineConfidence = computeHeadlineConfidenceFromRow({
    predicted_direction: rerun24h.direction,
    bull_case_pct: rerunConvictionModel.bullish_argument_pct,
    bear_case_pct: rerunConvictionModel.bearish_argument_pct,
    participation_pct: rerunConvictionModel.directional_participation_pct,
    net_edge_pct: rerunConvictionModel.net_edge_pct,
    conviction_model: rerunConvictionModel
  }).value;
  const storedReplayConviction = storedPredictionConviction(prediction);
  const rerunReplayConviction = storedPredictionConviction({
    conviction_model: rerunConvictionModel,
    predicted_conviction: rerun24h.conviction
  });

  const callTimeEt = normalizeCallTimeEt(storedEvaluation.call_time_et);
  const closeDate = storedEvaluation.close_time_et
    ? String(storedEvaluation.close_time_et).slice(0, 10)
    : addDays(snapshot.snapshot_date, 1);
  const openPrice = marketValueFromSnapshot("BTCUSD", snapshot) ?? toNumber(storedEvaluation.open_price);
  const closePrice = marketValueFromSeries("BTCUSD", closeDate, priceMap) ?? toNumber(storedEvaluation.close_price);
  const rerunEvaluation = evaluateSingleMarket({
    assetCode: "BTC",
    timeframe: "following 24hrs",
    callDate: snapshot.snapshot_date,
    callTimeEt,
    agentDirection: rerun24h.direction,
    agentConviction: rerunHeadlineConfidence,
    evaluatedMarket: "BTCUSD",
    openPrice,
    closePrice,
    evaluationVersion: "phase1_outcome_eval_v1",
    flatThresholdOverride: BTC_24H_FLAT_THRESHOLD,
    marketRelationship: "direct",
    evaluationMode: "primary"
  });

  const comparisons = [
    compareExact("Direction", normalizeDirection(prediction.predicted_direction), normalizeDirection(rerun24h.direction)),
    compareNumeric("Replay Conviction %", storedReplayConviction, rerunReplayConviction),
    compareNumeric("Displayed Headline Confidence %", storedHeadlineConfidence, rerunHeadlineConfidence),
    compareExact("Strength Bucket", prediction.verdict_strength || null, rerunConvictionModel.confidence_strength || null),
    compareNumeric("Bull Case %", prediction.bull_case_pct, rerunConvictionModel.bullish_argument_pct),
    compareNumeric("Bear Case %", prediction.bear_case_pct, rerunConvictionModel.bearish_argument_pct),
    compareNumeric("Net Edge %", prediction.net_edge_pct, rerunConvictionModel.net_edge_pct),
    compareNumeric("Participation %", prediction.participation_pct, rerunConvictionModel.directional_participation_pct),
    compareNumeric("Active Directional Weight", storedWeighted.active_weight, rerunWeighted.active_weight),
    compareNumeric("Bull Weighted Total", storedWeighted.bullish_weight, rerunWeighted.bullish_weight),
    compareNumeric("Bear Weighted Total", storedWeighted.bearish_weight, rerunWeighted.bearish_weight),
    compareExact("Evaluation Result", storedEvaluation.result || null, rerunEvaluation.result || null),
    compareExact("Evaluation Reason", storedEvaluation.result_reason || null, rerunEvaluation.result_reason || null),
    compareNumeric("Flat Threshold Used", storedEvaluation.flat_threshold_used, rerunEvaluation.flat_threshold_used, 0)
  ];

  const factorComparisons = compareFactorBreakdown(prediction.factor_breakdown, rerun24h.factor_breakdown);
  const overallStatus = fieldStatusSummary([
    ...comparisons,
    ...factorComparisons.flatMap((item) => [item.signal, item.weight])
  ]);

  return {
    prediction_id: prediction.id,
    snapshot_date: prediction.observation.snapshot_date,
    timeframe: prediction.timeframe,
    stored: {
      direction: prediction.predicted_direction,
      replay_conviction_pct: storedReplayConviction,
      displayed_headline_confidence_pct: storedHeadlineConfidence,
      headline_confidence_pct: storedHeadlineConfidence,
      strength_bucket: prediction.verdict_strength,
      bull_case_pct: prediction.bull_case_pct,
      bear_case_pct: prediction.bear_case_pct,
      net_edge_pct: prediction.net_edge_pct,
      participation_pct: prediction.participation_pct,
      active_directional_weight: storedWeighted.active_weight ?? null,
      bull_weighted_total: storedWeighted.bullish_weight ?? null,
      bear_weighted_total: storedWeighted.bearish_weight ?? null,
      evaluation_result: storedEvaluation.result || null,
      evaluation_reason: storedEvaluation.result_reason || null,
      flat_threshold_used: storedEvaluation.flat_threshold_used ?? null,
      weighted_score: storedWeighted,
      conviction_model: storedConvictionModel
    },
    checker: {
      direction: rerun24h.direction,
      replay_conviction_pct: rerunReplayConviction,
      displayed_headline_confidence_pct: rerunHeadlineConfidence,
      headline_confidence_pct: rerunHeadlineConfidence,
      strength_bucket: rerunConvictionModel.confidence_strength || null,
      bull_case_pct: rerunConvictionModel.bullish_argument_pct ?? null,
      bear_case_pct: rerunConvictionModel.bearish_argument_pct ?? null,
      net_edge_pct: rerunConvictionModel.net_edge_pct ?? null,
      participation_pct: rerunConvictionModel.directional_participation_pct ?? null,
      active_directional_weight: rerunWeighted.active_weight ?? null,
      bull_weighted_total: rerunWeighted.bullish_weight ?? null,
      bear_weighted_total: rerunWeighted.bearish_weight ?? null,
      evaluation_result: rerunEvaluation.result || null,
      evaluation_reason: rerunEvaluation.result_reason || null,
      flat_threshold_used: rerunEvaluation.flat_threshold_used ?? null,
      weighted_score: rerunWeighted,
      conviction_model: rerunConvictionModel
    },
    differences: comparisons,
    factor_comparisons: factorComparisons,
    status: overallStatus,
    evaluation_inputs: {
      open_price: openPrice,
      close_price: closePrice,
      close_date: closeDate
    }
  };
}

function summarizeRows(rows) {
  const summary = {
    rows_checked: rows.length,
    pass: 0,
    tolerance_pass: 0,
    fail: 0,
    missing_data: 0,
    exact_matches: 0
  };

  for (const row of rows) {
    if (row.status === "PASS") {
      summary.pass += 1;
      summary.exact_matches += 1;
    } else if (row.status === "TOLERANCE_PASS") {
      summary.tolerance_pass += 1;
    } else if (row.status === "FAIL") {
      summary.fail += 1;
    } else {
      summary.missing_data += 1;
    }
  }

  return summary;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || DEFAULT_START;
  const endDate = args.end || DEFAULT_END;
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const priceEndDate = addDays(endDate, 35);

  const [predictions, evaluations, snapshots, priceRows] = await Promise.all([
    loadStoredPredictions(supabaseUrl, serviceRoleKey, startDate, endDate),
    loadStoredEvaluations(supabaseUrl, serviceRoleKey, startDate, endDate),
    loadSnapshots(supabaseUrl, serviceRoleKey, startDate, endDate),
    loadPriceSeries(supabaseUrl, serviceRoleKey, startDate, priceEndDate)
  ]);

  const evaluationByPredictionId = new Map(evaluations.map((row) => [row.prediction_id, row]));
  const snapshotByDate = new Map(snapshots.map((row) => [row.snapshot_date, row]));
  const priceMap = buildPriceMap(priceRows);

  const rows = predictions.map((prediction) => {
    const snapshotDate = prediction.observation?.snapshot_date || null;
    return buildRowComparison(
      prediction,
      snapshotByDate.get(snapshotDate) || null,
      evaluationByPredictionId.get(prediction.id) || null,
      priceMap
    );
  });

  const summary = summarizeRows(rows);
  const selectedRowId = rows.find((row) => row.status === "FAIL")?.prediction_id
    || rows.find((row) => row.status === "TOLERANCE_PASS")?.prediction_id
    || rows[0]?.prediction_id
    || null;

  const payload = {
    meta: {
      generated_at: new Date().toISOString(),
      asset: "BTC",
      timeframe: "following 24hrs",
      date_range: { start: startDate, end: endDate },
      replay_logic_source: "backtester/replay/btc/btc_replay_core.js",
      evaluation_logic_source: "backtester/lib/outcome_evaluation.js",
      evaluation_market: "BTCUSD",
      benchmark_instrument_key: BTC_BENCHMARK_KEY,
      flat_threshold_used: BTC_24H_FLAT_THRESHOLD,
      tolerance_percentage_points: PERCENT_TOLERANCE,
      session_rule: "24_7"
    },
    summary,
    selected_row_id: selectedRowId,
    fields_compared: [
      "direction",
      "replay_conviction_pct",
      "headline_confidence_pct",
      "strength_bucket",
      "bull_case_pct",
      "bear_case_pct",
      "net_edge_pct",
      "participation_pct",
      "active_directional_weight",
      "bull_weighted_total",
      "bear_weighted_total",
      "factor_scores",
      "evaluation_result",
      "evaluation_reason",
      "flat_threshold_used"
    ],
    rows
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output_path: outputPath,
    rows_checked: summary.rows_checked,
    pass: summary.pass,
    tolerance_pass: summary.tolerance_pass,
    fail: summary.fail,
    missing_data: summary.missing_data
  }, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error("BTC backtester checker data build failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  run
};
