#!/usr/bin/env node

const {
  fetchAllRows,
  fetchJson,
  getSupabaseHeaders,
  parseArgs,
  requireEnv
} = require("../../lib/historical_common");
const {
  buildReplayOutput,
  parseLogicVersion
} = require("./btc_replay_core");

const REPLAY_VERSION = "btc_historical_replay_v1";
const SOURCE_WORKFLOW = "btc_historical_replay";
const LOGIC_DOCUMENT = "agent_btc_direction.md";
const TIMEFRAME_CONFIG = Object.freeze({
  "24h": {
    timeframe: "following 24hrs",
    legacy_timeframe_key: "24h"
  }
});

async function fetchExistingObservation(supabaseUrl, serviceRoleKey, sourceSnapshotId) {
  const url = new URL(`${supabaseUrl}/rest/v1/research_observations`);
  url.searchParams.set("select", "id");
  url.searchParams.set("source_workflow", `eq.${SOURCE_WORKFLOW}`);
  url.searchParams.set("source_snapshot_id", `eq.${sourceSnapshotId}`);
  url.searchParams.set("agent_name", "eq.BTC");
  url.searchParams.set("limit", "1");
  const rows = await fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });
  return rows[0] || null;
}

async function upsertObservation(supabaseUrl, serviceRoleKey, snapshot) {
  const sourceSnapshotId = snapshot.id || `BTC|${snapshot.snapshot_date}`;
  const existing = await fetchExistingObservation(supabaseUrl, serviceRoleKey, sourceSnapshotId);
  const payload = {
    observation_time: snapshot.observation_time,
    snapshot_date: snapshot.snapshot_date,
    agent_name: "BTC",
    asset_code: "BTC",
    layer: 1,
    source_workflow: SOURCE_WORKFLOW,
    source_run_id: REPLAY_VERSION,
    source_snapshot_id: sourceSnapshotId,
    market_status: snapshot.market_data_coverage_status,
    weekend_rule_active: true,
    market_snapshot: snapshot,
    market_regime: {
      equities_regime: snapshot.equities_regime || null,
      fed_bias: snapshot.fed_bias || null
    },
    warnings: snapshot.warnings || [],
    missing_inputs: snapshot.missing_inputs || [],
    data_quality: {
      source_status: snapshot.source_status,
      event_coverage_status: snapshot.event_coverage_status,
      market_data_coverage_status: snapshot.market_data_coverage_status
    }
  };

  if (existing) {
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/research_observations`);
    patchUrl.searchParams.set("id", `eq.${existing.id}`);
    patchUrl.searchParams.set("select", "id");
    const rows = await fetchJson(patchUrl.toString(), {
      method: "PATCH",
      headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify(payload)
    });
    return rows[0];
  }

  const rows = await fetchJson(`${supabaseUrl}/rest/v1/research_observations`, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function upsertSingletonByObservation(supabaseUrl, serviceRoleKey, tableName, observationId, payload) {
  const url = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
  url.searchParams.set("observation_id", `eq.${observationId}`);
  url.searchParams.set("select", "id");
  const existing = await fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });

  if (existing[0]) {
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
    patchUrl.searchParams.set("id", `eq.${existing[0].id}`);
    patchUrl.searchParams.set("select", "id");
    const rows = await fetchJson(patchUrl.toString(), {
      method: "PATCH",
      headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify(payload)
    });
    return rows[0];
  }

  const rows = await fetchJson(`${supabaseUrl}/rest/v1/${tableName}`, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function fetchPredictionByLegacyKey(supabaseUrl, serviceRoleKey, observationId, legacyKey) {
  const url = new URL(`${supabaseUrl}/rest/v1/research_timeframe_predictions`);
  url.searchParams.set("select", "id");
  url.searchParams.set("observation_id", `eq.${observationId}`);
  url.searchParams.set("legacy_timeframe_key", `eq.${legacyKey}`);
  url.searchParams.set("limit", "1");
  const rows = await fetchJson(url.toString(), {
    headers: getSupabaseHeaders(serviceRoleKey)
  });
  return rows[0] || null;
}

async function upsertPrediction(supabaseUrl, serviceRoleKey, observationId, verdictId, prediction) {
  const payload = {
    observation_id: observationId,
    agent_verdict_id: verdictId,
    timeframe: prediction.timeframe,
    legacy_timeframe_key: prediction.legacy_timeframe_key,
    mapping_status: "mapped",
    mapping_notes: "Historical BTC replay writes canonical predictions from the parity-validated live deterministic export logic.",
    predicted_direction: prediction.predicted_direction,
    predicted_conviction: prediction.predicted_conviction,
    bull_case_pct: prediction.bull_case_pct,
    bear_case_pct: prediction.bear_case_pct,
    net_edge_pct: prediction.net_edge_pct,
    participation_pct: prediction.participation_pct,
    neutral_pct: prediction.neutral_pct,
    verdict_strength: prediction.verdict_strength,
    reason_text: prediction.reason_text,
    weighted_score: prediction.weighted_score,
    conviction_model: prediction.conviction_model,
    prediction_status: "replayed",
    factor_breakdown: prediction.factor_breakdown,
    warnings: prediction.warnings,
    missing_inputs: prediction.missing_inputs,
    logic_document: prediction.logic_document,
    logic_document_version: prediction.logic_document_version,
    replay_version: prediction.replay_version
  };

  const existing = await fetchPredictionByLegacyKey(
    supabaseUrl,
    serviceRoleKey,
    observationId,
    prediction.legacy_timeframe_key
  );

  if (existing) {
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/research_timeframe_predictions`);
    patchUrl.searchParams.set("id", `eq.${existing.id}`);
    patchUrl.searchParams.set("select", "id");
    const rows = await fetchJson(patchUrl.toString(), {
      method: "PATCH",
      headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify(payload)
    });
    return rows[0];
  }

  const rows = await fetchJson(`${supabaseUrl}/rest/v1/research_timeframe_predictions`, {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "return=representation"),
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function upsertFactorObservations(supabaseUrl, serviceRoleKey, observationId, verdictId, predictionId, prediction) {
  const rows = Object.entries(prediction.factor_breakdown).map(([factorKey, factorValue], index) => ({
    observation_id: observationId,
    agent_verdict_id: verdictId,
    timeframe_prediction_id: predictionId,
    timeframe: prediction.timeframe,
    legacy_timeframe_key: prediction.legacy_timeframe_key,
    mapping_status: "mapped",
    factor_key: factorKey,
    factor_name: factorKey,
    factor_signal: factorValue.signal || null,
    factor_weight: Number.isFinite(Number(factorValue.weight)) ? Number(factorValue.weight) : null,
    factor_reason: factorValue.reason || null,
    factor_evidence: factorValue.evidence || null,
    factor_family: "btc_macro",
    factor_payload: factorValue,
    observation_order: index + 1
  }));

  if (!rows.length) return 0;

  const url = new URL(`${supabaseUrl}/rest/v1/research_factor_observations`);
  url.searchParams.set("on_conflict", "timeframe_prediction_id,factor_key");
  await fetchJson(url.toString(), {
    method: "POST",
    headers: getSupabaseHeaders(serviceRoleKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(rows)
  });

  return rows.length;
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const startDate = args.start || "2024-01-02";
  const endDate = args.end || "2026-04-30";
  const limit = args.limit ? Number(args.limit) : null;

  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const logicDocumentVersion = parseLogicVersion();

  const snapshots = await loadSnapshots(supabaseUrl, serviceRoleKey, startDate, endDate);
  const selectedSnapshots = limit ? snapshots.slice(0, limit) : snapshots;

  let observationsProcessed = 0;
  let predictionsWritten = 0;
  let factorsWritten = 0;

  for (const snapshot of selectedSnapshots) {
    const replayOutput = buildReplayOutput(snapshot, logicDocumentVersion);
    const observation = await upsertObservation(supabaseUrl, serviceRoleKey, snapshot);
    await upsertSingletonByObservation(
      supabaseUrl,
      serviceRoleKey,
      "research_model_contexts",
      observation.id,
      {
        observation_id: observation.id,
        logic_document: LOGIC_DOCUMENT,
        logic_document_version: logicDocumentVersion,
        collector_versions: {
          snapshot_builder: snapshot.collector_version || null,
          replay_engine: REPLAY_VERSION
        },
        prompt_version: null,
        weight_model_version: "btc_weighted_logic_live_export_v1",
        conviction_model_version: "btc_conviction_logic_live_export_v1",
        workflow_version_id: REPLAY_VERSION,
        repo_commit_sha: null,
        notes: "Historical BTC replay generated inside /backtester from the parity-validated live deterministic export logic."
      }
    );

    const verdict = await upsertSingletonByObservation(
      supabaseUrl,
      serviceRoleKey,
      "research_agent_verdicts",
      observation.id,
      {
        observation_id: observation.id,
        agent_name: "BTC",
        reasoning_summary: replayOutput.reasoning_summary,
        raw_agent_output: replayOutput,
        full_output: replayOutput,
        score_bullish: replayOutput.score_bullish,
        score_bearish: replayOutput.score_bearish,
        score_neutral: replayOutput.score_neutral,
        verdict_status: "replayed"
      }
    );

    for (const timeframeKey of Object.keys(TIMEFRAME_CONFIG)) {
      const prediction = replayOutput.timeframe_models[timeframeKey];
      const headlineConfidence = prediction.conviction_model.headline_confidence_pct ?? prediction.conviction;
      const confidenceStrength = prediction.conviction_model.confidence_strength ?? prediction.conviction_model.verdict_strength;
      const predictionRow = await upsertPrediction(supabaseUrl, serviceRoleKey, observation.id, verdict.id, {
        timeframe: TIMEFRAME_CONFIG[timeframeKey].timeframe,
        legacy_timeframe_key: TIMEFRAME_CONFIG[timeframeKey].legacy_timeframe_key,
        predicted_direction: prediction.direction,
        predicted_conviction: headlineConfidence,
        bull_case_pct: prediction.conviction_model.bullish_argument_pct,
        bear_case_pct: prediction.conviction_model.bearish_argument_pct,
        net_edge_pct: prediction.conviction_model.net_edge_pct,
        participation_pct: prediction.conviction_model.directional_participation_pct,
        neutral_pct: prediction.conviction_model.neutral_pct,
        verdict_strength: confidenceStrength,
        reason_text: prediction.reason,
        weighted_score: prediction.weighted_score,
        conviction_model: prediction.conviction_model,
        factor_breakdown: prediction.factor_breakdown,
        warnings: replayOutput.warnings,
        missing_inputs: prediction.missing_inputs || replayOutput.missing_inputs || [],
        logic_document: LOGIC_DOCUMENT,
        logic_document_version: logicDocumentVersion,
        replay_version: REPLAY_VERSION
      });

      factorsWritten += await upsertFactorObservations(
        supabaseUrl,
        serviceRoleKey,
        observation.id,
        verdict.id,
        predictionRow.id,
        {
          timeframe: TIMEFRAME_CONFIG[timeframeKey].timeframe,
          legacy_timeframe_key: TIMEFRAME_CONFIG[timeframeKey].legacy_timeframe_key,
          factor_breakdown: prediction.factor_breakdown
        }
      );

      predictionsWritten += 1;
    }

    observationsProcessed += 1;
  }

  console.log(JSON.stringify({
    replay_version: REPLAY_VERSION,
    logic_document: LOGIC_DOCUMENT,
    logic_document_version: logicDocumentVersion,
    date_range: {
      start: startDate,
      end: endDate
    },
    observations_processed: observationsProcessed,
    predictions_written: predictionsWritten,
    factor_rows_written: factorsWritten
  }, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error("BTC historical replay failed.");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  run
};
