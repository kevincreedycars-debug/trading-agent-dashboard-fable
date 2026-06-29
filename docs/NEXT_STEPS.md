# Next Steps

Last updated: 2026-06-29

## Priority 1 — Finish AI Development Environment

### GitHub

- Maintain GitHub as the single source of truth.
- Store architecture, state, decisions, bugs, and workflow exports in the repository.
- Keep all sensitive credentials out of source control.

### n8n

- Connect by direct n8n API first.
- Add MCP later if it improves workflow browsing/editing inside AI tooling.
- Required from user before direct connection:
  - n8n workspace base URL
  - API key stored securely outside GitHub

### Codex / ChatGPT Roles

ChatGPT:

- architecture
- debugging
- reasoning
- planning
- documentation
- review

Codex:

- file edits
- workflow JSON edits
- commits
- implementation
- structured refactors

## Priority 2 — Fix Master Workflow Issues

1. Fix Eco Events duplicate insert handling.
2. Fix EUR Agent parser to support object|string OpenAI output.
3. Add final execution success/failure summary to the Master Orchestrator.
4. Eventually publish the Master Orchestrator status summary to the dashboard.

## Priority 3 — Repository Organisation

Create and maintain:

- `CODEX_STARTUP.md`
- `docs/CURRENT_STATE.md`
- `docs/CURRENT_TASK.md`
- `docs/NEXT_STEPS.md`
- `docs/CHANGELOG.md`
- `docs/SESSION_LOG.md`
- `docs/SESSION_NOTES.md`
- `docs/PROJECT_HISTORY.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `issues/active_bugs.md`
- `issues/fixed_bugs.md`
- `logic/`
- `workflows/`
- `exports/`

## Priority 4 — Future Layer 2

After Layer 1 and developer workflow are stable, build Layer 2 Economic Event Adjustment.

Layer 2 may read:

- Layer 1 raw calls
- economic calendar events
- event outcomes
- surprise scores
- timing/catalyst risk

Layer 2 must not contaminate Layer 1.

## Priority 5 - Multi-Asset Research Rollout

Before moving the historical research framework from USD to EUR and the other assets:

1. Keep USD 24H benchmark evaluation documented as `DXY`, using the `09:30 ET` call-date to `16:00 ET` next-valid-session outcome window.
2. Keep the current USD fixed flat band documented as `+-0.15%`, with the current visible matrix reading `251 / 544 = 46.1%`.
3. Treat the USD flat-band result as a research warning, not an immediate production-threshold change.
4. Compare fixed flat bands against ATR- or volatility-normalised outcome bands before finalising EUR or multi-asset benchmark evaluation.
5. Do not blindly copy USD fixed-band settings into EUR, Gold, NQ, or BTC evaluation.
