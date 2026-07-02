#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("../lib/historical_common");

const DEFAULT_INPUT = path.resolve(__dirname, "../../data/backtester-checker-btc-24h-2024-2026.json");

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input || DEFAULT_INPUT);
  const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const summary = payload.summary || {};
  const totals = {
    artifact_path: inputPath,
    rows_checked: summary.rows_checked || 0,
    pass: summary.pass || 0,
    tolerance_pass: summary.tolerance_pass || 0,
    fail: summary.fail || 0,
    missing_data: summary.missing_data || 0
  };

  console.log(JSON.stringify(totals, null, 2));

  if (totals.fail > 0 || totals.missing_data > 0 || totals.tolerance_pass > 0) {
    process.exitCode = 1;
  }
}

main();
