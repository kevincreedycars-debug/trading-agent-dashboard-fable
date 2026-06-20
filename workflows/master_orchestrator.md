# Master Orchestrator

## Purpose

Single-button workflow that runs the full trading-agent platform sequentially.

## Trigger

Should use manual trigger for user-started runs and call child workflows through `Execute Workflow` / sub-workflow execution.

Child workflows should expose `Execute Sub-workflow Trigger`.

## Expected Execution Order

```text
Eco Events Collector
USD Collector
EUR Collector
Gold Collector
NQ Collector
BTC Collector
USD Layer 1 Agent
EUR Layer 1 Agent
Gold Layer 1 Agent
NQ Layer 1 Agent
BTC Layer 1 Agent
Dashboard Writer
```

## Current Status

Sequential orchestration is believed to be working.

Dashboard-side trigger and status rendering have been added in GitHub.

The live n8n workflow now has:

- a production Webhook Trigger for dashboard runs
- final success/failure status writing to `data/workflow-status.json`
- child workflow calls configured to continue far enough to publish a dashboard-readable status file

## Known Issues

- Eco Events duplicate insert can break execution.
- EUR Agent parser can fail if OpenAI output is an object rather than a string.
- Final execution summary is not yet implemented.

## Dashboard Status Contract

The dashboard polls:

```text
data/workflow-status.json
```

Expected shape:

```json
{
  "status": "success",
  "last_run_started_at": "2026-06-20T10:00:00Z",
  "last_run_finished_at": "2026-06-20T10:03:00Z",
  "triggered_by": "dashboard",
  "message": "Manual Refresh Complete",
  "steps": [
    { "name": "Eco Events Collector", "status": "success" },
    { "name": "EUR Layer 1 Agent", "status": "failed", "error": "OpenAI invalid JSON" }
  ],
  "error": null
}
```

For failed runs, set `status` to `failed` and populate `error` with a string or object containing `step` and `reason`.

## Desired Final Output

```text
Manual Refresh Complete

SUCCESS

Eco Events ✓
USD Collector ✓
EUR Collector ✓
Gold Collector ✓
NQ Collector ✓
BTC Collector ✓

USD Agent ✓
EUR Agent ✓
Gold Agent ✓
NQ Agent ✓
BTC Agent ✓

Dashboard Writer ✓
```

or failure:

```text
FAILED

EUR Agent

Reason:
OpenAI invalid JSON
```
