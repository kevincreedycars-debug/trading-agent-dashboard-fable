const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

function getSupabaseEnv() {
  const repoRoot = path.resolve(__dirname, "..", "..");
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

test("Replay smoke test can run January 2024 and produce research rows", { timeout: 120000 }, () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const env = {
    ...process.env,
    ...getSupabaseEnv()
  };

  const buildOutput = childProcess.execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "backtester", "builders", "usd", "build_usd_historical_snapshots.js"),
      "--start=2024-01-01",
      "--end=2024-01-31"
    ],
    { cwd: repoRoot, env }
  ).toString();
  const buildSummary = JSON.parse(buildOutput);
  assert.ok(buildSummary.submitted_rows >= 22, "Expected January 2024 snapshot rebuild to submit rows");

  const replayOutput = childProcess.execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "backtester", "replay", "usd", "run_usd_historical_replay.js"),
      "--start=2024-01-01",
      "--end=2024-01-31"
    ],
    { cwd: repoRoot, env }
  ).toString();
  const replaySummary = JSON.parse(replayOutput);

  assert.equal(replaySummary.observations_processed, 22);
  assert.equal(replaySummary.predictions_written, 88);
  assert.equal(replaySummary.factor_rows_written, 880);

  const countScript = `
    const { fetchAllRows } = require("./backtester/lib/historical_common");
    (async () => {
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const [observations, verdicts, predictions, factors] = await Promise.all([
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_observations", (url) => {
          url.searchParams.set("select", "id,snapshot_date,source_workflow");
          url.searchParams.set("snapshot_date", "gte.2024-01-01");
          url.searchParams.append("snapshot_date", "lte.2024-01-31");
          url.searchParams.set("agent_name", "eq.USD");
          url.searchParams.set("source_workflow", "eq.usd_historical_replay");
        }),
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_agent_verdicts", (url) => {
          url.searchParams.set("select", "id,observation_id");
        }),
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_timeframe_predictions", (url) => {
          url.searchParams.set("select", "id,observation_id");
        }),
        fetchAllRows(supabaseUrl, serviceRoleKey, "research_factor_observations", (url) => {
          url.searchParams.set("select", "id,timeframe_prediction_id");
        })
      ]);
      const observationIds = new Set(observations.map((row) => row.id));
      const predictionIds = new Set(predictions.filter((row) => observationIds.has(row.observation_id)).map((row) => row.id));
      const verdictCount = verdicts.filter((row) => observationIds.has(row.observation_id)).length;
      const predictionCount = predictions.filter((row) => observationIds.has(row.observation_id)).length;
      const factorCount = factors.filter((row) => predictionIds.has(row.timeframe_prediction_id)).length;
      console.log(JSON.stringify({
        observations: observations.length,
        verdicts: verdictCount,
        predictions: predictionCount,
        factors: factorCount
      }));
    })().catch((error) => {
      console.error(error.stack || error.message || String(error));
      process.exit(1);
    });
  `;

  const counts = JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", countScript], { cwd: repoRoot, env }).toString()
  );

  assert.equal(counts.observations, 22);
  assert.equal(counts.verdicts, 22);
  assert.equal(counts.predictions, 88);
  assert.equal(counts.factors, 880);
});
