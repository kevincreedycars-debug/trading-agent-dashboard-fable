# Current Task

Last updated: 2026-06-29

## Task

Validate the USD historical replay and deterministic backtester checker.

## Objective

Confirm that the USD Data Checker is producing reliable deterministic results before expanding its coverage window.

## Current Status

In progress.

## Completed

- GitHub repository confirmed: `kevincreedycars-debug/trading-agent-dashboard`
- GitHub connector has admin/push access
- Project memory documentation scaffold created
- `docs/CURRENT_STATE.md` created
- `docs/CURRENT_TASK.md` created
- `docs/ACTIVE_MILESTONE.md` created
- `docs/NEXT_STEPS.md` created
- `docs/ARCHITECTURE.md` created
- `docs/CHANGELOG.md` created
- `docs/SESSION_LOG.md` created
- `docs/DECISIONS.md` created
- `issues/active_bugs.md` created
- `issues/fixed_bugs.md` created
- `logic/README.md` created
- `workflows/README.md` created
- `exports/README.md` created
- `docs/N8N_INTEGRATION.md` created
- `workflows/WORKFLOW_INVENTORY.md` created
- `CODEX_STARTUP.md` created to define mandatory startup and end-of-session memory behaviour
- `CODEX.md` updated to read `CODEX_STARTUP.md` first
- `docs/SESSION_NOTES.md` created for latest-session handoff notes
- `docs/PROJECT_HISTORY.md` created for concise high-level milestones
- Initial workflow documents added for Master Orchestrator, EUR Layer 1 Agent, and Eco Events Collector
- Live n8n workflow JSON snapshots exported into `exports/`
- Dashboard Master Orchestrator control panel added
- Dashboard workflow status and error report rendering added
- `data/workflow-control.json` added for non-secret webhook configuration
- `data/workflow-status.json` added for run status published by n8n
- Live Master Orchestrator configured with a production Webhook Trigger
- Referenced child workflows published so the Master Orchestrator webhook can run
- Master Orchestrator configured to publish run status to `data/workflow-status.json`
- Dashboard overview updated to display confidence as the headline call-quality metric instead of reusing raw conviction as-is
- Overview definitions legend added under the Layer 1 calls
- Shared dashboard card top strips changed from the orange/green/blue gradient to a single navy strip
- Shared Layer 1 dashboard normalization now derives explicit `confidence` values and generates a 7-day direction outlook from the latest timeframe calls
- `data/layer1.json` now carries `confidence` and `seven_day_outlook` in the current repository snapshot
- Deployment verification confirmed the active public host is GitHub Pages, not Netlify, and that earlier local changes had not yet been pushed
- Eco Events duplicate insert handling fixed in the live workflow on 2026-06-21
- Master Orchestrator latest published status is successful as of 2026-06-28
- Deterministic USD Backtester Checker added
- Current checker scope verified for USD 24H January 2024
- Latest checker result recorded as 22 checked / 22 pass / 0 fail / 0 missing

## n8n Workspace

Base URL:

```text
https://silver17.app.n8n.cloud
```

Project UI:

```text
https://silver17.app.n8n.cloud/projects/ISQG9XU7TGTT6Fcu/workflows
```

## Next Immediate Steps

1. Review the Data Checker UI for the current USD 24H January 2024 checker output.
2. Expand the USD 24H checker scope to full-year 2024 after the UI review is complete.

## Current Blocker

No current repository-side blocker.

The immediate risk is making checker-scope changes before the current Data Checker UI has been reviewed against the committed deterministic January 2024 result.

The n8n API key was supplied in chat and must not be committed to GitHub.

Recommended after setup is proven:

1. Revoke the exposed key.
2. Generate a fresh key.
3. Store it only in the secure execution environment used by Codex/automation.

## Target Outcome

A future session should be able to begin with:

> Continue.

and then read:

- `CODEX_STARTUP.md`
- `docs/CURRENT_TASK.md`
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_MILESTONE.md`
- `docs/NEXT_STEPS.md`
- `docs/CHANGELOG.md`
- `docs/DECISIONS.md`
- `docs/SESSION_NOTES.md`
- `docs/PROJECT_HISTORY.md`
- `docs/N8N_INTEGRATION.md`
- `workflows/WORKFLOW_INVENTORY.md`
- `issues/active_bugs.md`

before making any changes.

The immediate working outcome for the current task is:

> review the USD Data Checker UI for January 2024, then extend the USD 24H checker to full-year 2024 without changing runtime production behavior
