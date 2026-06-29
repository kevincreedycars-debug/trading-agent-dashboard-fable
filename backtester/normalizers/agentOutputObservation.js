const {
  getLegacyTimeframeMapping,
  getCanonicalCoverage
} = require("../mappings/timeframes");

const LEGACY_TIMEFRAME_FIELDS = Object.freeze([
  {
    legacyKey: "24h",
    directionFields: ["call_24h_direction", "direction_24h"],
    convictionFields: ["call_24h_conviction", "conviction_24h"],
    reasonFields: ["call_24h_reason", "reason_24h"]
  },
  {
    legacyKey: "3d",
    directionFields: ["call_3d_direction", "direction_3_day"],
    convictionFields: ["call_3d_conviction", "conviction_3_day"],
    reasonFields: ["call_3d_reason", "reason_3_day"]
  },
  {
    legacyKey: "current_week",
    directionFields: ["call_current_week_direction", "direction_current_week"],
    convictionFields: ["call_current_week_conviction", "conviction_current_week"],
    reasonFields: ["call_current_week_reason", "reason_current_week"]
  },
  {
    legacyKey: "next_week",
    directionFields: ["call_next_week_direction", "direction_next_week"],
    convictionFields: ["call_next_week_conviction", "conviction_next_week"],
    reasonFields: ["call_next_week_reason", "reason_next_week"]
  },
  {
    legacyKey: "current_month",
    directionFields: ["call_current_month_direction", "direction_current_month"],
    convictionFields: ["call_current_month_conviction", "conviction_current_month"],
    reasonFields: ["call_current_month_reason", "reason_current_month"]
  }
]);

function parseMaybeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function parseMaybeArray(value) {
  if (Array.isArray(value)) return value;
  return parseMaybeJson(value, []);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeHeadlineConfidenceFromModel(convictionModel = {}) {
  const bullCase = toNumber(convictionModel.bullish_argument_pct ?? convictionModel.alignment ?? null);
  const bearCase = toNumber(convictionModel.bearish_argument_pct ?? null);
  const participation = toNumber(
    convictionModel.directional_participation_pct ??
    convictionModel.active_participation_pct ??
    convictionModel.participation ??
    null
  );
  const netEdge = toNumber(convictionModel.net_edge_pct ?? null);

  if ([bullCase, bearCase, participation, netEdge].some((value) => value === null)) {
    return null;
  }

  let confidence =
    ((Math.max(bullCase, bearCase) / 100) * 0.45) +
    ((participation / 100) * 0.35) +
    ((Math.abs(netEdge) / 100) * 0.20);

  if (participation < 40) confidence -= 0.10;
  if (participation < 25) confidence -= 0.20;
  if (Math.abs(netEdge) < 20) confidence -= 0.10;

  return Math.round(clamp(confidence, 0, 1) * 100);
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }

  return null;
}

function buildObservationRef(row) {
  return [
    String(row.agent_name || "UNKNOWN").toUpperCase(),
    row.snapshot_date || "unknown-date",
    row.run_time_et || row.created_at || "unknown-time"
  ].join("|");
}

function buildTimeframePrediction(row, fullOutput, spec, observationRef) {
  const mapping = getLegacyTimeframeMapping(spec.legacyKey);
  const timeframeModel = parseMaybeJson(fullOutput.timeframe_models, {})[spec.legacyKey] ||
    fullOutput.timeframe_models?.[spec.legacyKey] ||
    {};

  const direction = firstValue(row, spec.directionFields) || timeframeModel.direction || null;
  const conviction = toNumber(firstValue(row, spec.convictionFields) ?? timeframeModel.conviction ?? null);
  const reason = firstValue(row, spec.reasonFields) || timeframeModel.reason || null;
  const convictionModel = timeframeModel.conviction_model || {};
  const headlineConfidence = computeHeadlineConfidenceFromModel(convictionModel);
  const weightedScore = timeframeModel.weighted_score || {};
  const factorBreakdown = timeframeModel.factor_breakdown || fullOutput.factor_breakdown || {};

  if (!direction && conviction === null && !reason) {
    return null;
  }

  return {
    observation_ref: observationRef,
    legacy_timeframe_key: spec.legacyKey,
    canonical_timeframe: mapping.canonicalTimeframe,
    mapping_status: mapping.mappingStatus,
    mapping_notes: mapping.notes,
    predicted_direction: direction,
    predicted_conviction: headlineConfidence ?? conviction,
    bull_case_pct: toNumber(
      convictionModel.bullish_argument_pct ?? convictionModel.alignment ?? null
    ),
    bear_case_pct: toNumber(convictionModel.bearish_argument_pct ?? null),
    net_edge_pct: toNumber(convictionModel.net_edge_pct ?? null),
    participation_pct: toNumber(
      convictionModel.directional_participation_pct ??
      convictionModel.active_participation_pct ??
      convictionModel.participation ??
      null
    ),
    neutral_pct: toNumber(
      convictionModel.neutral_evidence_pct ?? convictionModel.neutral_pct ?? null
    ),
    verdict_strength: convictionModel.verdict_strength || null,
    reason_text: reason,
    weighted_score: weightedScore,
    conviction_model: convictionModel,
    factor_breakdown: factorBreakdown
  };
}

function flattenFactorObservations(prediction, fullOutput) {
  const factorBreakdown = prediction.factor_breakdown || {};

  return Object.entries(factorBreakdown).map(([factorKey, factorValue], index) => ({
    observation_ref: prediction.observation_ref,
    legacy_timeframe_key: prediction.legacy_timeframe_key,
    canonical_timeframe: prediction.canonical_timeframe,
    mapping_status: prediction.mapping_status,
    factor_key: factorKey,
    factor_name: factorKey,
    factor_signal: factorValue?.signal || null,
    factor_weight: toNumber(factorValue?.weight ?? null),
    factor_reason: factorValue?.reason || null,
    factor_evidence: factorValue?.evidence || null,
    factor_payload: factorValue,
    observation_order: index + 1,
    source_logic_document_version: fullOutput.logic_document_version || null
  }));
}

function normalizeAgentOutputRow(row) {
  const fullOutput = parseMaybeJson(
    row.full_output,
    parseMaybeJson(row.raw_agent_output, {})
  );
  const marketInputs = parseMaybeJson(row.market_inputs, {});
  const warnings = [
    ...parseMaybeArray(row.warnings),
    ...parseMaybeArray(fullOutput.warnings),
    ...parseMaybeArray(fullOutput.risk_flags),
    ...parseMaybeArray(fullOutput.model_reported_warnings),
    ...parseMaybeArray(fullOutput.input_validation_warnings)
  ];
  const missingInputs = [
    ...parseMaybeArray(row.missing_inputs),
    ...parseMaybeArray(fullOutput.missing_inputs)
  ];
  const observationRef = buildObservationRef(row);
  const predictions = LEGACY_TIMEFRAME_FIELDS
    .map((spec) => buildTimeframePrediction(row, fullOutput, spec, observationRef))
    .filter(Boolean);

  return {
    observation: {
      observation_ref: observationRef,
      observation_time: row.run_time_et || row.created_at || null,
      snapshot_date: row.snapshot_date || null,
      agent_name: row.agent_name || null,
      asset_code: row.agent_name || null,
      layer: toNumber(row.layer) ?? 1,
      source_workflow: "agent_outputs",
      source_run_id: null,
      source_snapshot_id: row.snapshot_id || null,
      market_status: null,
      weekend_rule_active: null,
      market_snapshot: marketInputs,
      market_regime: parseMaybeJson(fullOutput.market_regime, {}),
      warnings: Array.from(new Set(warnings.filter(Boolean))),
      missing_inputs: Array.from(new Set(missingInputs.filter(Boolean))),
      data_quality: parseMaybeJson(fullOutput.data_quality, {})
    },
    model_context: {
      observation_ref: observationRef,
      logic_document: row.logic_document || fullOutput.logic_document || null,
      logic_document_version: row.logic_document_version || fullOutput.logic_document_version || null,
      collector_versions: parseMaybeJson(fullOutput.collector_versions, {}),
      prompt_version: fullOutput.prompt_version || null,
      weight_model_version: fullOutput.weight_model_version || null,
      conviction_model_version: fullOutput.conviction_model_version || null,
      workflow_version_id: fullOutput.workflow_version_id || null,
      repo_commit_sha: fullOutput.repo_commit_sha || null
    },
    agent_verdict: {
      observation_ref: observationRef,
      reasoning_summary: row.reasoning_summary || fullOutput.reasoning_summary || null,
      raw_agent_output: parseMaybeJson(row.raw_agent_output, fullOutput),
      full_output: fullOutput,
      score_bullish: toNumber(row.score_bullish ?? fullOutput.score_bullish ?? null),
      score_bearish: toNumber(row.score_bearish ?? fullOutput.score_bearish ?? null),
      score_neutral: toNumber(row.score_neutral ?? fullOutput.score_neutral ?? null),
      verdict_status: "ingested"
    },
    timeframe_predictions: predictions.map((prediction) => {
      const { factor_breakdown: _factorBreakdown, ...rest } = prediction;
      return rest;
    }),
    factor_observations: predictions.flatMap((prediction) =>
      flattenFactorObservations(prediction, fullOutput)
    ),
    canonical_timeframe_coverage: getCanonicalCoverage()
  };
}

module.exports = {
  LEGACY_TIMEFRAME_FIELDS,
  normalizeAgentOutputRow
};
