# Current Task

Last updated: 2026-07-03

## Task

Expand supportable OHLC coverage for blocked `ADR Reach Research` assets and pairs.

## Objective

The downstream-only ADR reach module has now been added. The current objective is to broaden supportable OHLC coverage so the blocked assets can move from unavailable into real ADR measurement without changing any frozen research semantics.

The module answers:

> Did price move at least 50% of the rolling 20-day ADR in the direction of the Layer 1 or Layer 2 call at any point during that trading day?

This work must sit alongside the existing Layer 1 and Pair Trade Research views, require historical OHLC data, keep existing replay/checker logic untouched, and record unavailable assets as unavailable rather than estimating intraday reach from close-only data.

## Current Status

ADR Reach Research supportable OHLC expansion is partially complete. Current platform state is stable and validated.

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
- Backtest Checker workspace UI added under the Backtest / Accuracy dashboard area
- Live-vs-replay audit completed for USD and confirmed that live USD remains the production source of truth
- Audit confirmed the current checker result proves replay-vs-replay reproducibility, not live-vs-replay parity
- EUR 24H live-vs-replay one-snapshot parity fixture added and now passes against the frozen live export target
- EUR historical replay generated for `2024-01-02` through `2026-04-30` where warehouse data allows
- EUR/USD historical outcome evaluation is now working end-to-end without using DXY benchmark logic
- EUR/USD provisional 24H flat band set to `0.15` in the EUR-specific evaluation/checker path
- EUR deterministic checker artifact generated with result `602 / 0 / 0 / 0`
- Dashboard support added for the EUR 24H matrix and EUR checker alongside the existing USD views
- Full Layer 1 historical replay rollout completed and validated for USD, EUR, Gold, NQ, and BTC
- New `Weekday Breakdown` Backtest / Accuracy tab added using stored checker-artifact headline confidence and evaluation results
- New weekday reconciliation validator added and passing for USD `604`, EUR `602`, Gold `608`, NQ `604`, and BTC `850`
- Dashboard smoke updated and passing for matrices, checker views, and the new weekday breakdown tab
- Weekday Breakdown updated so flat outcomes are shown separately and ex-flat directional win rate excludes flats
- Each weekday cell now shows ex-flat win rate plus `W / L / F / T` counts, with `Flat only` handling when a cell has no directional rows
- Each asset now includes a `Day Totals` table above the bucket breakdown, aggregating Monday-Friday for USD/EUR/Gold/NQ and Monday-Sunday for BTC
- Updated weekday validation confirms day totals reconcile to bucket rows and checker totals while preserving BTC weekends and non-BTC weekday-only coverage
- New `Pair Trade Research` Backtest / Accuracy tab added for EUR/USD, XAU/USD, NQ/USD, and BTC/USD
- Pair trade research uses same-date target + USD checker rows and combined confidence `min(target, USD)` without changing Layer 1 confidence logic
- Added pair-trade coverage summary, accuracy summary, combined-confidence bucket table, day totals, weekday breakdown, and conflict/no-trade summary
- Added `backtester/scripts/validate_layer2_pairing_analysis.js` and confirmed pair-trade research validation passes
- Dashboard smoke updated and passing for the new Pair Trade Research tab
- Pair Trade Research UI refined and validated, including top-summary layout improvements, confidence-table spacing improvements, and terminology updates for matched-day trade-share metrics
- New `ADR Reach Research` Backtest / Accuracy sub-tab added downstream of the canonical checker artifacts
- Added `backtester/scripts/validate_adr_reach_research.js` and generated `data/adr-reach-research.json`
- Confirmed repo-local supportable OHLC coverage for `NQ` via `backtester/tmp/qqq_daily_yahoo.csv`
- ADR reach now evaluates `NQ` Layer 1 and `NQ/USD` Layer 2 using evaluation-day `Open` as the reference price and rolling previous-20-session ADR20
- Added deterministic repo-local `EUR/USD` daily OHLC coverage in `backtester/tmp/eurusd_daily_alpha_vantage.csv` using Alpha Vantage `FX_DAILY`
- Added deterministic repo-local `BTC/USD` daily OHLC coverage in `backtester/tmp/btcusd_daily_coinbase.csv` using Coinbase Exchange daily candles
- ADR reach now evaluates `EUR`, `NQ`, and `BTC` Layer 1 assets using supportable daily OHLC with evaluation-day `Open` as the reference price and previous-close fallback preserved
- ADR reach now evaluates `EUR/USD`, `NQ/USD`, and `BTC/USD` Layer 2 pairs by reusing existing Pair Trade Research tradable-signal selection against the same supportable OHLC sources
- `Gold`, `USD`, and `XAU/USD` remain unavailable in ADR Reach Research because repo evidence still does not include supportable true `XAU/USD` or `DXY` High/Low history
- Updated dashboard smoke and validation passes for the new ADR Reach Research tab while leaving replay, checker, confidence, and Pair Trade Research logic unchanged

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

1. Source supportable true `XAU/USD` spot OHLC history so `Gold` Layer 1 and `XAU/USD` Layer 2 can move from unavailable to real ADR measurement.
2. Source supportable `DXY` or other accepted USD benchmark OHLC history only if a real non-estimated source can be staged repo-locally.
3. Keep replay, checker, pair-calculation, confidence, and flat-band semantics frozen while ADR coverage expands downstream-only.

## Current Blocker

No current repository-side blocker.

Known research limitations in individual historical inputs remain, but they do not block the validated full Layer 1 replay rollout or the new weekday breakdown view because that view is computed entirely from canonical checker artifacts.

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

> expand the shipped ADR Reach Research module beyond its current `NQ` / `NQ/USD` support without changing replay outputs, checker semantics, pair logic, flat bands, or headline confidence logic
