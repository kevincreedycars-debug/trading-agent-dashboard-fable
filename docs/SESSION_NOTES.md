# Session Notes

Last updated: 2026-06-20

## Work Completed

- Reviewed the existing dashboard use of conviction and confirmed the headline metric was being rendered directly from the deterministic `final_conviction` model output.
- Added a front-end derived confidence score that combines evidence dominance, participation, and net edge, then applies penalties when missing inputs or risk flags are present in the live data.
- Updated the Overview and asset detail views to label the headline metric as Confidence while keeping Bull Case, Bear Case, Net Edge, and Participation visible.
- Added a compact definitions legend under the Overview Layer 1 calls.
- Replaced the shared card top strip gradient with a single navy strip.
- Validated the updated front-end syntax with `node --check script.js`.

## Unfinished Work

- Re-run the Master Orchestrator from the dashboard and verify the status/error report in the updated UI.
- Fix EUR Layer 1 parser handling for OpenAI object|string output.
- Fix Eco Events Collector duplicate insert handling.
- Refine Master Orchestrator status parsing after observing real failure payloads.

## Blockers

- No repository-side blocker.
- Runtime validation still depends on running the live n8n Master Orchestrator.
- Any n8n API key previously exposed in chat should be revoked and replaced after setup is proven.

## Assumptions

- Canonical memory documents live in `docs/`, with `CODEX_STARTUP.md` kept at the repository root.
- `docs/ACTIVE_MILESTONE.md` is the current checkpoint only; completed milestone history belongs in `docs/CHANGELOG.md`.
- GitHub remains the source of truth, n8n remains execution, Supabase remains data, and Netlify/dashboard remains presentation.
- Existing uncommitted dashboard and design-reference changes are user work and should not be altered unless explicitly requested.

## Exact Next Task

Run the Master Orchestrator from the dashboard and verify whether `data/workflow-status.json` receives a useful success or failure report in the updated dashboard UI.
