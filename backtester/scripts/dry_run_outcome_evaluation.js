#!/usr/bin/env node

const { evaluateSingleMarket } = require("../lib/outcome_evaluation");

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) continue;
    const [key, ...rest] = rawArg.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : "true";
  }

  return args;
}

function requireArg(args, name) {
  const value = args[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required argument: --${name}=...`);
  }
  return value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const evaluation = evaluateSingleMarket({
    assetCode: requireArg(args, "asset"),
    timeframe: requireArg(args, "timeframe"),
    callDate: requireArg(args, "call-date"),
    callTimeEt: args["call-time-et"] || "09:30:00",
    agentDirection: requireArg(args, "agent-direction"),
    agentConviction: args["agent-conviction"] || null,
    evaluatedMarket: requireArg(args, "market"),
    openPrice: requireArg(args, "open-price"),
    closePrice: requireArg(args, "close-price"),
    evaluationVersion: args["evaluation-version"] || "phase1_dry_run_v1",
    marketRelationship: args.relationship || "direct",
    evaluationMode: args.mode || "primary"
  });

  console.log(`Agent said: ${evaluation.agent_direction || "NO_CALL"}`);
  console.log(`Agent conviction: ${evaluation.agent_conviction === null ? "n/a" : `${evaluation.agent_conviction}%`}`);
  console.log(`Market: ${evaluation.evaluated_market}`);
  console.log(`Timeframe: ${evaluation.timeframe}`);
  console.log(`Call date: ${evaluation.call_date} (${evaluation.call_day_of_week})`);
  console.log(`Call time ET: ${evaluation.call_time_et_local}`);
  console.log(`Open window ET: ${evaluation.open_time_et_local || "n/a"}`);
  console.log(`Close window ET: ${evaluation.close_time_et_local || "n/a"}`);
  console.log(`Open price: ${evaluation.open_price}`);
  console.log(`Close price: ${evaluation.close_price}`);
  console.log(`Pct change: ${evaluation.pct_change === null ? "n/a" : `${evaluation.pct_change.toFixed(4)}%`}`);
  console.log(`Flat threshold: ${evaluation.flat_threshold_used.toFixed(2)}%`);
  console.log(`Market outcome: ${evaluation.market_outcome_direction || "n/a"}`);
  console.log(`Comparable outcome: ${evaluation.comparable_market_direction || "n/a"}`);
  console.log(`Move bucket: ${evaluation.move_magnitude_bucket || "n/a"}`);
  console.log(`Conviction bucket: ${evaluation.conviction_bucket || "n/a"}`);
  console.log(`Alignment: ${evaluation.conviction_move_alignment || "n/a"}`);
  console.log(`Quality: ${evaluation.evaluation_quality || "n/a"}`);
  console.log(`Exceeded expected move: ${evaluation.exceeded_expected_move === null ? "n/a" : evaluation.exceeded_expected_move}`);
  console.log(`Result: ${evaluation.result}`);
  console.log(`Reason: ${evaluation.result_reason}`);
  console.log("");
  console.log(JSON.stringify(evaluation, null, 2));
}

try {
  main();
} catch (error) {
  console.error("Dry-run outcome evaluation failed.");
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
