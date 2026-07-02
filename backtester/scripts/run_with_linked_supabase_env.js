#!/usr/bin/env node

const childProcess = require("node:child_process");
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
  if (!serviceRole) {
    throw new Error("Expected Supabase CLI to return a service_role key");
  }

  return {
    SUPABASE_URL: "https://eaolqbrlywczinfordvg.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: serviceRole
  };
}

function main() {
  const [scriptPath, ...scriptArgs] = process.argv.slice(2);
  if (!scriptPath) {
    throw new Error("Usage: node backtester/scripts/run_with_linked_supabase_env.js <script> [args...]");
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const env = {
    ...process.env,
    ...getSupabaseEnv(repoRoot)
  };

  childProcess.execFileSync(
    process.execPath,
    [path.resolve(repoRoot, scriptPath), ...scriptArgs],
    {
      cwd: repoRoot,
      env,
      stdio: "inherit"
    }
  );
}

main();
