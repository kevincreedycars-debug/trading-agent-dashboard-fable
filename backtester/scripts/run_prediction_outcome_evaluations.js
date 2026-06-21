#!/usr/bin/env node

const {
  fetchAllRows,
  getSupabaseHeaders,
  parseArgs,
  requireEnv,
  upsertRows
} = require("../lib/historical_common");
const {
  PHASE1_ASSET_MARKET_MAPPINGS,
  evaluateSingleMarket,
  normalizeAssetCode
} = require("../lib/outcome_evaluation");

const EVALUATION_VERSION = "phase1_outcome_eval_v1";
const DEFAULT_START = "2018-01-01";
const DEFAULT_END = "2024-12-31";
const DEFAULT_CALL_TIME_ET = "09:30:00";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildSeriesMap(rows, keyField, valueField = "value") {
  const map = new Map();
  for (const row of rows) {
    const key = `${row[keyField]}|${row.observation_date}`;
    map.set(key, toNumber(row[valueField]));
  }
  return map;
}

function marketValueFromSnapshot(market, marketSnapshot) {
  if (market === "DXY") return toNumber(marketSnapshot?.dxy_level);
  if (market === "XAUUSD") return toNumber(marketSnapshot?.gold_price);
  if (market === "QQQ_NQ_PROXY") return toNumber(marketSnapshot?.nq_price);
  return null;
}

function marketValueFromSeries(market, closeDate, macroMap, priceMap) {
  if (market === "DXY") return macroMap.get(`dxy_level|${closeDate}`) ?? null;
  if (market === "XAUUSD") return priceMap.get(`gold_spot_usd|${closeDate}`) ?? null;
  if (market === "QQQ_NQ_PROXY") return priceMap.get(`qqq_nq_proxy|${closeDate}`) ?? null;
  return null;
}

async function loadPredictions(supabaseUrl, serviceRoleKey, startDate, endDate) {
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
          "agent_verdict_id",
          "timeframe",
          "legacy_timeframe_key",
          "predicted_direction",
          "predicted_conviction",
          "verdict_strength",
          "observation:research_observations!inner(id,snapshot_date,asset_code,agent_name,source_workflow,market_snapshot,market_regime)"
        ].join(",")
      );
      url.searchParams.set("observation.snapshot_date", `gte.${startDate}`);
      url.searchParams.append("observation.snapshot_date", `lte.${endDate}`);
      url.searchParams.set("observation.agent_name", "eq.USD");
      url.searchParams.set("observation.source_workflow", "eq.usd_historical_replay");
      url.searchParams.set("order", "created_at.asc");
    }
  );
}

async function loadMacroSeries(supabaseUrl, serviceRoleKey, startDate, endDate) {
  return fetchAllRows(
    supabaseUrl,
    serviceRoleKey,
    "historical_macro_series",
    (url) => {
      url.searchParams.set("select", "series_key,observation_date,value_numeric");
      url.searchParams.set("series_key", "in.(dxy_level)");
      url.searchParams.set("observation_date", `gte.${startDate}`);
      url.searchParams.append("observation_date", `lte.${endDate}`);
      url.searchParams.set("order", "observation_date.asc");
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
      url.searchParams.set("instrument_key", "in.(gold_spot_usd,qqq_nq_proxy)");
      url.searchParams.set("interval", "eq.daily");
      url.searchParams.set("observation_date", `gte.${startDate}`);
      url.searchParams.append("observation_date", `lte.${endDate}`);
      url.searchParams.set("order", "observation_date.asc");
    }
  );
}

function summarizePrimaryEvaluations(evaluations) {
  const primary = evaluations.filter((row) => row.evaluation_mode === "primary");
  const pctValues = primary.map((row) => row.pct_change).filter((value) => value !== null);
  const outcomeLabels = primary.map((row) => row.result);

  let combinedLabel = "NOT_EVALUABLE";
  if (outcomeLabels.length) {
    const unique = Array.from(new Set(outcomeLabels));
    if (unique.length === 1) {
      combinedLabel = unique[0];
    } else if (unique.includes("CORRECT") && unique.includes("WRONG")) {
      combinedLabel = "MIXED";
    } else {
      combinedLabel = "MIXED";
    }
  }

  const first = primary[0] || evaluations[0] || null;

  return {
    evaluation_status: combinedLabel,
    entry_time: first?.open_time_et || null,
    horizon_end_time: first?.close_time_et || null,
    settlement_time: first?.close_time_et || null,
    entry_price: primary.length === 1 ? first?.open_price ?? null : null,
    exit_price: primary.length === 1 ? first?.close_price ?? null : null,
    realised_return_pct: pctValues.length ? pctValues.reduce((sum, value) => sum + value, 0) / pctValues.length : null,
    realised_direction: primary.length === 1 ? first?.comparable_market_direction || null : null,
    outcome_label: combinedLabel,
    settlement_source: "phase1_primary_evaluation_summary",
    settlement_payload: {
      evaluation_version: EVALUATION_VERSION,
      primary_market_count: primary.length,
      evaluated_markets: primary.map((row) => row.evaluated_market),
      results: primary.map((row) => ({
        evaluated_market: row.evaluated_market,
        result: row.result,
        pct_change: row.pct_change,
        market_outcome_direction: row.market_outcome_direction
      }))
    },
    evaluated_at: new Date().toISOString()
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || DEFAULT_START;
  const endDate = args.end || DEFAULT_END;
  const callTimeEt = args["call-time-et"] || DEFAULT_CALL_TIME_ET;

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const [predictions, macroRows, priceRows] = await Promise.all([
    loadPredictions(supabaseUrl, serviceRoleKey, startDate, endDate),
    loadMacroSeries(supabaseUrl, serviceRoleKey, startDate, endDate),
    loadPriceSeries(supabaseUrl, serviceRoleKey, startDate, endDate)
  ]);

  const macroMap = buildSeriesMap(
    macroRows.map((row) => ({
      series_key: row.series_key,
      observation_date: row.observation_date,
      value: row.value_numeric
    })),
    "series_key",
    "value"
  );
  const priceMap = buildSeriesMap(
    priceRows.map((row) => ({
      instrument_key: row.instrument_key,
      observation_date: row.observation_date,
      value: row.close
    })),
    "instrument_key",
    "value"
  );

  const evaluationRows = [];
  const realisedRows = [];

  for (const prediction of predictions) {
    const observation = prediction.observation;
    const assetCode = normalizeAssetCode(observation.asset_code);
    const callDate = observation.snapshot_date;
    const mappings = PHASE1_ASSET_MARKET_MAPPINGS[assetCode];
    const rowsForPrediction = [];

    for (const mapping of mappings) {
      const openPrice = marketValueFromSnapshot(mapping.evaluated_market, observation.market_snapshot)
        ?? marketValueFromSeries(mapping.evaluated_market, callDate, macroMap, priceMap);

      const evaluation = evaluateSingleMarket({
        assetCode,
        timeframe: prediction.timeframe,
        callDate,
        callTimeEt,
        agentDirection: prediction.predicted_direction,
        agentConviction: prediction.predicted_conviction,
        evaluatedMarket: mapping.evaluated_market,
        openPrice,
        closePrice: null,
        evaluationVersion: EVALUATION_VERSION,
        marketRelationship: mapping.market_relationship,
        evaluationMode: mapping.evaluation_mode
      });

      const closeDate = evaluation.close_time_et ? String(evaluation.close_time_et).slice(0, 10) : null;
      const closePrice = closeDate
        ? marketValueFromSeries(mapping.evaluated_market, closeDate, macroMap, priceMap)
        : null;

      const finalEvaluation = evaluateSingleMarket({
        assetCode,
        timeframe: prediction.timeframe,
        callDate,
        callTimeEt,
        agentDirection: prediction.predicted_direction,
        agentConviction: prediction.predicted_conviction,
        evaluatedMarket: mapping.evaluated_market,
        openPrice,
        closePrice,
        evaluationVersion: EVALUATION_VERSION,
        marketRelationship: mapping.market_relationship,
        evaluationMode: mapping.evaluation_mode
      });

      const row = {
        observation_id: prediction.observation_id,
        verdict_id: prediction.agent_verdict_id,
        prediction_id: prediction.id,
        asset_code: assetCode,
        evaluated_market: finalEvaluation.evaluated_market,
        timeframe: finalEvaluation.timeframe,
        call_date: finalEvaluation.call_date,
        call_day_of_week: finalEvaluation.call_day_of_week,
        call_time_et: finalEvaluation.call_time_et,
        open_time_et: finalEvaluation.open_time_et,
        close_time_et: finalEvaluation.close_time_et,
        open_price: finalEvaluation.open_price,
        close_price: finalEvaluation.close_price,
        pct_change: finalEvaluation.pct_change,
        abs_pct_change: finalEvaluation.abs_pct_change,
        flat_threshold_used: finalEvaluation.flat_threshold_used,
        move_magnitude_bucket: finalEvaluation.move_magnitude_bucket,
        conviction_bucket: finalEvaluation.conviction_bucket,
        conviction_move_alignment: finalEvaluation.conviction_move_alignment,
        evaluation_quality: finalEvaluation.evaluation_quality,
        expected_move_threshold: finalEvaluation.expected_move_threshold,
        exceeded_expected_move: finalEvaluation.exceeded_expected_move,
        calibration_notes: finalEvaluation.evaluable
          ? null
          : `not_evaluable_reason=${finalEvaluation.result_reason}`,
        market_outcome_direction: finalEvaluation.market_outcome_direction,
        agent_direction: finalEvaluation.agent_direction,
        agent_conviction: finalEvaluation.agent_conviction,
        result: finalEvaluation.result,
        result_reason: finalEvaluation.result_reason,
        evaluation_version: EVALUATION_VERSION,
        evaluation_mode: finalEvaluation.evaluation_mode,
        market_relationship: finalEvaluation.market_relationship,
        evaluation_payload: {
          call_time_et_local: finalEvaluation.call_time_et_local,
          open_time_et_local: finalEvaluation.open_time_et_local,
          close_time_et_local: finalEvaluation.close_time_et_local,
          comparable_market_direction: finalEvaluation.comparable_market_direction,
          evaluable: finalEvaluation.evaluable
        }
      };

      rowsForPrediction.push(row);
      evaluationRows.push(row);
    }

    const realisedSummary = summarizePrimaryEvaluations(rowsForPrediction);
    realisedRows.push({
      observation_id: prediction.observation_id,
      timeframe_prediction_id: prediction.id,
      timeframe: prediction.timeframe,
      evaluation_status: realisedSummary.evaluation_status,
      entry_time: realisedSummary.entry_time,
      horizon_end_time: realisedSummary.horizon_end_time,
      settlement_time: realisedSummary.settlement_time,
      entry_price: realisedSummary.entry_price,
      exit_price: realisedSummary.exit_price,
      realised_return_pct: realisedSummary.realised_return_pct,
      realised_direction: realisedSummary.realised_direction,
      outcome_label: realisedSummary.outcome_label,
      settlement_source: realisedSummary.settlement_source,
      settlement_payload: realisedSummary.settlement_payload,
      evaluated_at: realisedSummary.evaluated_at
    });
  }

  const evaluationsWritten = await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "research_prediction_evaluations",
    evaluationRows,
    ["prediction_id", "evaluated_market", "evaluation_version"]
  );

  const realisedWritten = await upsertRows(
    supabaseUrl,
    serviceRoleKey,
    "research_realised_outcomes",
    realisedRows,
    ["timeframe_prediction_id"]
  );

  const counts = evaluationRows.reduce((accumulator, row) => {
    accumulator[row.result] = (accumulator[row.result] || 0) + 1;
    return accumulator;
  }, {});

  console.log(JSON.stringify({
    evaluation_version: EVALUATION_VERSION,
    date_range: {
      start: startDate,
      end: endDate
    },
    predictions_processed: predictions.length,
    evaluation_rows_written: evaluationsWritten,
    realised_outcome_rows_written: realisedWritten,
    result_counts: counts
  }, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Prediction outcome evaluation run failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
