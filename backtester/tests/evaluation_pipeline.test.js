const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function getSupabaseEnv(repoRoot) {
  const apiKeys = JSON.parse(
    childProcess.execFileSync(
      "supabase",
      ["projects", "api-keys", "--project-ref", "eaolqbrlywczinfordvg", "-o", "json"],
      { cwd: repoRoot }
    ).toString()
  );

  const serviceRole = apiKeys.find((key) => key.name === "service_role")?.api_key;
  assert.ok(serviceRole, "Expected Supabase CLI to return a service_role key");

  return {
    SUPABASE_URL: "https://eaolqbrlywczinfordvg.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: serviceRole
  };
}

function getCliEnv(repoRoot, env) {
  const tempHome = path.join(repoRoot, ".tmp-supabase-home");
  fs.mkdirSync(tempHome, { recursive: true });
  return {
    ...env,
    HOME: tempHome,
    USERPROFILE: tempHome
  };
}

function runNodeScript(repoRoot, env, scriptPath, args = []) {
  return childProcess.execFileSync(
    process.execPath,
    [scriptPath, ...args],
    { cwd: repoRoot, env }
  ).toString();
}

function runInlineNode(repoRoot, env, source) {
  return childProcess.execFileSync(
    process.execPath,
    ["-e", source],
    { cwd: repoRoot, env }
  ).toString();
}

function runSupabaseQuery(repoRoot, env, args) {
  return childProcess.execFileSync(
    "supabase",
    ["db", "query", "--linked", ...args],
    { cwd: repoRoot, env: getCliEnv(repoRoot, env) }
  ).toString();
}

test("Evaluation runner and research SQL layer work end-to-end for January 2024", { timeout: 240000 }, () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const env = {
    ...process.env,
    ...getSupabaseEnv(repoRoot)
  };

  const buildOutput = runNodeScript(
    repoRoot,
    env,
    path.join(repoRoot, "backtester", "builders", "usd", "build_usd_historical_snapshots.js"),
    ["--start=2024-01-01", "--end=2024-01-31"]
  );
  const buildSummary = JSON.parse(buildOutput);
  assert.ok(buildSummary.submitted_rows >= 22, "Expected snapshot rebuild to submit January rows");

  const replayOutput = runNodeScript(
    repoRoot,
    env,
    path.join(repoRoot, "backtester", "replay", "usd", "run_usd_historical_replay.js"),
    ["--start=2024-01-01", "--end=2024-01-31"]
  );
  const replaySummary = JSON.parse(replayOutput);
  assert.equal(replaySummary.observations_processed, 22);
  assert.equal(replaySummary.predictions_written, 88);
  assert.equal(replaySummary.factor_rows_written, 880);

  const evaluationScriptPath = path.join(repoRoot, "backtester", "scripts", "run_prediction_outcome_evaluations.js");
  const firstEvaluationOutput = runNodeScript(
    repoRoot,
    env,
    evaluationScriptPath,
    ["--start=2018-01-01", "--end=2024-12-31"]
  );
  const firstEvaluationSummary = JSON.parse(firstEvaluationOutput);

  assert.equal(firstEvaluationSummary.predictions_processed, 88);
  assert.equal(firstEvaluationSummary.evaluation_rows_written, 440);
  assert.equal(firstEvaluationSummary.realised_outcome_rows_written, 88);
  assert.equal(firstEvaluationSummary.result_counts.CORRECT, 91);
  assert.equal(firstEvaluationSummary.result_counts.WRONG, 87);
  assert.equal(firstEvaluationSummary.result_counts.FLAT, 74);
  assert.equal(firstEvaluationSummary.result_counts.NOT_EVALUABLE, 188);

  const secondEvaluationOutput = runNodeScript(
    repoRoot,
    env,
    evaluationScriptPath,
    ["--start=2018-01-01", "--end=2024-12-31"]
  );
  const secondEvaluationSummary = JSON.parse(secondEvaluationOutput);
  assert.equal(secondEvaluationSummary.evaluation_rows_written, 440);
  assert.equal(secondEvaluationSummary.realised_outcome_rows_written, 88);

  const countScript = `
    const { fetchAllRows } = require("./backtester/lib/historical_common");
    (async () => {
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const [predictions, evaluations, realised] = await Promise.all([
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_timeframe_predictions", (url) => {
          url.searchParams.set("select", "id,observation_id");
        }),
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_prediction_evaluations", (url) => {
          url.searchParams.set("select", "prediction_id,evaluation_mode,result,evaluation_version");
          url.searchParams.set("evaluation_version", "eq.phase1_outcome_eval_v1");
        }),
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_realised_outcomes", (url) => {
          url.searchParams.set("select", "timeframe_prediction_id");
        })
      ]);

      const januaryObservationIds = new Set(
        (await fetchAllRows(supabaseUrl, serviceRoleKey, "research_observations", (url) => {
          url.searchParams.set("select", "id,snapshot_date,source_workflow,agent_name");
          url.searchParams.set("snapshot_date", "gte.2024-01-01");
          url.searchParams.append("snapshot_date", "lte.2024-01-31");
          url.searchParams.set("agent_name", "eq.USD");
          url.searchParams.set("source_workflow", "eq.usd_historical_replay");
        })).map((row) => row.id)
      );

      const januaryPredictionIds = new Set(
        predictions.filter((row) => januaryObservationIds.has(row.observation_id)).map((row) => row.id)
      );

      const januaryEvaluations = evaluations.filter((row) => januaryPredictionIds.has(row.prediction_id));
      const januaryRealised = realised.filter((row) => januaryPredictionIds.has(row.timeframe_prediction_id));

      const primaryByPrediction = new Map();
      for (const row of januaryEvaluations.filter((r) => r.evaluation_mode === "primary")) {
        const bucket = primaryByPrediction.get(row.prediction_id) || [];
        bucket.push(row.result);
        primaryByPrediction.set(row.prediction_id, bucket);
      }

      const combined = { CORRECT: 0, WRONG: 0, FLAT: 0, MIXED: 0, NO_CALL: 0, NOT_EVALUABLE: 0 };
      for (const results of primaryByPrediction.values()) {
        const unique = [...new Set(results)];
        let label = "MIXED";
        if (unique.length === 1) {
          label = unique[0];
        } else if (unique.includes("CORRECT") && unique.includes("WRONG")) {
          label = "MIXED";
        } else {
          label = "MIXED";
        }
        combined[label] += 1;
      }

      console.log(JSON.stringify({
        predictions: januaryPredictionIds.size,
        evaluation_rows: januaryEvaluations.length,
        realised_outcomes: januaryRealised.length,
        combined
      }));
    })().catch((error) => {
      console.error(error.stack || error.message || String(error));
      process.exit(1);
    });
  `;

  const counts = JSON.parse(runInlineNode(repoRoot, env, countScript));
  assert.equal(counts.predictions, 88);
  assert.equal(counts.evaluation_rows, 440);
  assert.equal(counts.realised_outcomes, 88);
  assert.equal(counts.combined.MIXED, 84);
  assert.equal(counts.combined.NOT_EVALUABLE, 4);
  assert.equal(counts.combined.CORRECT, 0);
  assert.equal(counts.combined.WRONG, 0);
  assert.equal(counts.combined.FLAT, 0);
  assert.equal(counts.combined.NO_CALL, 0);

  runSupabaseQuery(
    repoRoot,
    env,
    ["-f", path.join(repoRoot, "backtester", "sql", "006_research_query_layer.sql")]
  );

  const viewsScript = `
    const { fetchAllRows } = require("./backtester/lib/historical_common");
    (async () => {
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const viewNames = [
        "research_overall_win_rate",
        "research_win_rate_by_timeframe",
        "research_win_rate_by_conviction_bucket",
        "research_win_rate_by_weekday",
        "research_win_rate_by_magnitude_bucket",
        "research_win_rate_by_market_regime",
        "research_factor_reliability",
        "research_factor_contribution",
        "research_best_factor_combinations"
      ];

      const counts = {};
      for (const viewName of viewNames) {
        const rows = await fetchAllRows(supabaseUrl, serviceRoleKey, viewName, (url) => {
          url.searchParams.set("select", "*");
        });
        counts[viewName] = rows.length;
      }

      const overall = await fetchAllRows(supabaseUrl, serviceRoleKey, "research_overall_win_rate", (url) => {
        url.searchParams.set("select", "*");
      });

      console.log(JSON.stringify({
        counts,
        overall: overall[0] || null
      }));
    })().catch((error) => {
      console.error(error.stack || error.message || String(error));
      process.exit(1);
    });
  `;

  const views = JSON.parse(runInlineNode(repoRoot, env, viewsScript));
  assert.ok(views.counts.research_overall_win_rate > 0);
  assert.ok(views.counts.research_win_rate_by_timeframe > 0);
  assert.ok(views.counts.research_win_rate_by_conviction_bucket > 0);
  assert.ok(views.counts.research_win_rate_by_weekday > 0);
  assert.ok(views.counts.research_win_rate_by_magnitude_bucket > 0);
  assert.ok(views.counts.research_win_rate_by_market_regime > 0);
  assert.ok(views.counts.research_factor_reliability > 0);
  assert.ok(views.counts.research_factor_contribution > 0);
  assert.ok(views.counts.research_best_factor_combinations > 0);
  assert.equal(views.overall.evaluated_predictions, 84);
});
