# Handoff Brief: Trading Agent Dashboard

## 1. Project Purpose

This repository is an AI-assisted trading research and monitoring dashboard for a directional prediction system.

The core production goal is:

> For each covered asset, generate a sealed Layer 1 directional call for the next 24 hours, then expose those calls clearly enough that the team can monitor them live and measure them historically.

### Primary 24H directional prediction scope

Layer 1 covers these assets:

- `USD`
- `EUR`
- `GOLD` / `XAU`
- `NQ`
- `BTC`

The system also has a Layer 2 concept:

- Layer 2 is not a separate predictive model of its own.
- It is a downstream pairing/trade-selection layer built from Layer 1 outputs.
- Current production-style Layer 2 focuses on relative pair trades:
  - `EUR/USD`
  - `XAU/USD`
  - `NQ/USD`
  - `BTC/USD`

### What success looks like

At a high level, success means:

- The full pipeline can be triggered reliably from the dashboard.
- Market collectors populate current market context.
- Each Layer 1 workflow produces an independent raw directional call.
- The dashboard shows current live calls and workflow health without exposing secrets.
- Historical research can reproduce and audit the current production logic downstream, without mutating production logic.
- Layer 2 pair selection remains logically consistent with Layer 1, especially around confidence semantics.

More concretely, this project is trying to answer two different questions:

1. Production/live question:
   - "What is the current directional view for each asset over the next 24 hours?"

2. Research question:
   - "Historically, how did those production-style calls perform when judged using deterministic downstream analysis?"

The team has been careful to keep those two concerns separate.

---

## 2. Architecture As Built

### High-level pipeline

The built architecture is:

```text
GitHub Pages Dashboard
  -> dashboard webhook trigger
  -> n8n Master Orchestrator
  -> collectors write market context
  -> Layer 1 agents write raw calls
  -> Layer 2 trade-selection agent writes pair view
  -> Dashboard Writer publishes dashboard JSON back into GitHub
  -> GitHub Pages serves updated data files
```

There is also a separate historical research pipeline in this same repo:

- replay/build/checker scripts under `backtester/`
- checked-in artifacts under `data/`
- browser rendering in `script.js`

That research stack is downstream-only and should not change production behavior.

### Hosting and control plane

#### GitHub Pages dashboard

The live dashboard is a static site served from GitHub Pages. Main browser files:

- `index.html`
- `script.js`
- `styles.css`

Data consumed by the dashboard:

- `data/layer1.json`
- `data/layer2.json`
- `data/workflow-control.json`
- `data/workflow-status.json`
- research artifacts under `data/` such as:
  - `data/backtester-checker-usd-24h-2024-01.json`
  - `data/backtester-checker-eur-24h-2024-2026.json`
  - `data/backtester-checker-gold-24h-2024-2026.json`
  - `data/backtester-checker-nq-24h-2024-2026.json`
  - `data/backtester-checker-btc-24h-2024-2026.json`
  - `data/adr-reach-research.json`

#### Dashboard-triggered orchestration

The dashboard does not call the n8n API directly from the browser.

Instead:

- `data/workflow-control.json` contains the non-secret webhook config.
- `script.js` calls the webhook when the user triggers a run.
- n8n publishes status back into `data/workflow-status.json`.
- The dashboard polls `data/workflow-status.json` for run state.

This was chosen so the browser never needs the n8n API key.

### n8n execution engine

The live n8n workspace is documented in:

- `docs/N8N_INTEGRATION.md`
- `workflows/WORKFLOW_INVENTORY.md`

Base URL:

- `https://silver17.app.n8n.cloud`

Project UI:

- `https://silver17.app.n8n.cloud/projects/ISQG9XU7TGTT6Fcu/workflows`

### Core workflows and exported JSON

Exports live in `exports/`. These are the main workflow exports Fable 5 should inspect first:

- `exports/master_orchestrator.json`
- `exports/eco_events_collector.json`
- `exports/usd_collector.json`
- `exports/eur_collector.json`
- `exports/gold_collector.json`
- `exports/nq_collector.json`
- `exports/btc_collector.json`
- `exports/usd_layer1_agent.json`
- `exports/eur_layer1_agent.json`
- `exports/gold_layer1_agent.json`
- `exports/nq_layer1_agent.json`
- `exports/btc_layer1_agent.json`
- `exports/layer2_trade_selection_agent.json`
- `exports/dashboard_writer.json`

Workflow markdown docs are less complete than the exports. Current human-readable workflow docs exist for:

- `workflows/master_orchestrator.md`
- `workflows/eco_events_collector.md`
- `workflows/eur_layer1_agent.md`

### End-to-end execution order

Current orchestrator order, based on docs and `exports/master_orchestrator.json`:

1. `Eco Events Collector`
2. `USD Collector`
3. `EUR Collector`
4. `Gold Collector`
5. `NQ Collector`
6. `BTC Collector`
7. `USD Layer 1 Agent`
8. `EUR Layer 1 Agent`
9. `Gold Layer 1 Agent`
10. `NQ Layer 1 Agent`
11. `BTC Layer 1 Agent`
12. `Layer 2 Trade Selection Agent`
13. `Dashboard Writer`
14. Build and publish `data/workflow-status.json`

Important: older docs sometimes describe the system as if Layer 2 were absent from orchestration, but the current `master_orchestrator.json` export clearly includes `Layer 2 Trade Selection Agent`.

### What each workflow does

#### Master Orchestrator

Files:

- `exports/master_orchestrator.json`
- `workflows/master_orchestrator.md`

Job:

- Receives the dashboard/manual trigger.
- Calls child workflows sequentially.
- Builds a step-by-step status object.
- Publishes `data/workflow-status.json` back to GitHub.

Notable implementation detail:

- The export contains inline JS that assembles a final status payload with step names including `Layer 2 Trade Selection Agent`.

#### Eco Events Collector

Files:

- `exports/eco_events_collector.json`
- `workflows/eco_events_collector.md`

Job:

- Pulls economic calendar/event data.
- Writes into Supabase table `economic_events`.
- Supports later event-risk context and future Layer 2 adjustments.

Current implementation note:

- Duplicate inserts were previously a problem.
- Live workflow now dedupes rows, fetches existing date rows, updates matches, and creates only unmatched rows.

#### Market data collectors

Files:

- `exports/usd_collector.json`
- `exports/eur_collector.json`
- `exports/gold_collector.json`
- `exports/nq_collector.json`
- `exports/btc_collector.json`

Job:

- Collect asset-specific market inputs.
- Write usable market context into Supabase, centered around `market_snapshots`.

The exact factor mix differs by asset, but the architectural role is the same:

- collect current market features
- normalize them into snapshot data
- make those snapshots available to the matching Layer 1 agent only

#### Layer 1 agents

Files:

- `exports/usd_layer1_agent.json`
- `exports/eur_layer1_agent.json`
- `exports/gold_layer1_agent.json`
- `exports/nq_layer1_agent.json`
- `exports/btc_layer1_agent.json`

Human doc available for:

- `workflows/eur_layer1_agent.md`

Job:

- Read the latest usable market snapshot.
- Read their own asset-specific logic.
- Produce an independent raw directional call.
- Write output into Supabase `agent_outputs`.

Critical rule:

- Layer 1 agents are sealed.
- They must not read:
  - other Layer 1 outputs
  - dashboard output
  - Layer 2 output
  - cross-agent synthesis

This is one of the most important design constraints in the repo.

#### Layer 2 Trade Selection Agent

Files:

- `exports/layer2_trade_selection_agent.json`
- output file: `data/layer2.json`

Job:

- Read Layer 1 outputs from Supabase `agent_outputs`.
- Build a pair-trade-selection JSON.
- Commit `data/layer2.json` back into GitHub.

From the export:

- it reads `agent_outputs`
- has a node named `Build Layer 2 Trade Selection JSON`
- writes `data/layer2.json`
- commits with message:
  - `Update layer2 dashboard data from trade selection agent`

Important current reality:

- The n8n Layer 2 workflow’s own confidence semantics were not fully aligned with the later historical Pair Trade Research semantics.
- The dashboard now corrects this on the browser side by re-deriving live Layer 2 pair confidence from Layer 1 headline confidence using shared logic.
- That means `data/layer2.json` is still useful as raw upstream output, but the browser should not blindly trust its confidence/strength fields.

#### Dashboard Writer

Files:

- `exports/dashboard_writer.json`
- output file: `data/layer1.json`

Job:

- Read current Layer 1 outputs from `agent_outputs`.
- Build dashboard-ready Layer 1 JSON.
- Commit `data/layer1.json` back into GitHub.

The export shows it writes:

- `data/layer1.json`

### Data layer

Supabase is the canonical runtime data layer.

Important tables mentioned in docs and exports:

- `market_snapshots`
- `agent_outputs`
- `economic_events`

The public dashboard itself does not query Supabase for production live cards.

Instead, production live state is published into checked-in JSON files:

- `data/layer1.json`
- `data/layer2.json`
- `data/workflow-status.json`

### Historical research stack

Main directory:

- `backtester/`

This is not a toy add-on. It is now a major part of the repo.

Its role is:

- reproduce production-style logic downstream
- generate deterministic historical artifacts
- validate consistency
- render comparative research in the dashboard

Key current research modules visible in the UI:

1. Accuracy Tables
2. Backtest Checker
3. Weekday Breakdown
4. Pair Trade Research
5. ADR Reach Research

Important supporting code and data:

- `backtester/lib/headline_confidence.js`
- `backtester/lib/layer2_pair_logic.js`
- `backtester/scripts/validate_layer2_pairing_analysis.js`
- `backtester/scripts/validate_adr_reach_research.js`
- `playwright-dashboard-smoke.js`

Checked-in research artifacts:

- `data/backtester-checker-*.json`
- `data/adr-reach-research.json`

### Browser-side Layer 2 logic as of now

This was just changed and is important for any competing clone:

- `script.js` no longer treats `data/layer2.json` as the final source of truth for pair confidence.
- Live Layer 2 cards are now re-derived from Layer 1 24H state using:
  - `backtester/lib/layer2_pair_logic.js`

Current invariant enforced in browser code:

- pair exists only when target and USD are both directional and opposite
- combined confidence = `min(target Layer 1 headline confidence, USD Layer 1 headline confidence)`
- same-direction pairs are no-trade/conflict
- missing or non-directional confidence is no-trade
- strength bucket is derived only from combined confidence:
  - `0-49 Weak`
  - `50-64 Moderate`
  - `65-79 Strong`
  - `80-100 Very Strong`

Relevant files:

- `script.js`
- `backtester/lib/layer2_pair_logic.js`
- `backtester/tests/layer2_pair_logic.test.js`
- `playwright-dashboard-smoke.js`

---

## 3. Decisions And Why

These are the important design choices that matter beyond what the code alone shows.

### A. GitHub is the source of truth

Why:

- The project is too large to rely on chat history or transient tool state.
- Durable project memory is intentionally stored in repo docs.

Where that shows up:

- `CODEX_STARTUP.md`
- `docs/CURRENT_STATE.md`
- `docs/CURRENT_TASK.md`
- `docs/ACTIVE_MILESTONE.md`
- `docs/SESSION_NOTES.md`
- `docs/CHANGELOG.md`
- `docs/DECISIONS.md`

### B. n8n remains the production execution engine

Why:

- The workflows already exist and are live.
- Replacing n8n would introduce unnecessary risk before the production behavior is fully measured.

This repo is not trying to replace the live workflows yet. It is trying to observe, document, reproduce, and audit them.

### C. Layer 1 isolation is non-negotiable

Why:

- The team wants uncontaminated raw directional calls first.
- Cross-asset synthesis belongs downstream in Layer 2 or research, not inside Layer 1.

This affects architecture, testing, and even how historical research is interpreted.

### D. Research is downstream-only

Why:

- Historical replay/checker work is meant to measure production logic before optimization.
- The repo intentionally avoids quietly changing live trading logic just because research suggests a better approach.

This is a recurring theme throughout the docs.

### E. Webhook + status file instead of browser n8n API access

Why:

- The static dashboard must not expose the n8n API key.
- A webhook trigger plus GitHub-published status file is simpler and safer for a browser client.

### F. Pair Trade Research confidence semantics use `min()`, not average/max/opportunity score

Why:

- A pair trade should not be stronger than its weaker leg.
- If one leg is weak, the pair must remain bounded by that weakness.

This is one of the most important downstream design choices, and it recently had to be enforced explicitly in the live dashboard because upstream Layer 2 output was too permissive.

### G. ADR Reach Research refuses fake coverage

Why:

- The project does not want close-to-close estimates masquerading as intraday reach evidence.
- If supportable OHLC data does not exist, the asset/pair stays explicitly unavailable.

This is why:

- `EUR`, `NQ`, `BTC`, `EUR/USD`, `NQ/USD`, `BTC/USD` are supported in ADR Reach Research
- `Gold`, `XAU/USD`, and `USD` remain unavailable there

### H. Things tried and abandoned or constrained

1. Trusting live Layer 2 payload confidence directly
   - Rejected in the browser.
   - The live dashboard now overrides that logic with deterministic Layer 1-derived pair confidence.

2. Estimating ADR reach from close-only data
   - Rejected.
   - Unsupported assets remain unavailable instead.

3. Letting research silently redefine production truth
   - Rejected.
   - Production remains the source to be measured first.

4. Using replay-vs-replay alone as proof of parity
   - Rejected conceptually.
   - Deterministic checker success is treated as reproducibility evidence, not full proof that replay matches live production without additional parity checks.

---

## 4. Current State

### Working reliably

1. GitHub Pages dashboard is live and reads checked-in JSON artifacts.
2. Master Orchestrator dashboard trigger/status flow is working.
3. `data/workflow-status.json` currently shows a successful full run on `2026-07-03`.
4. Layer 1 historical replay rollout is validated for:
   - `USD`
   - `EUR`
   - `GOLD`
   - `NQ`
   - `BTC`
5. Backtest / Accuracy dashboard modules are present and functioning:
   - Accuracy Tables
   - Backtest Checker
   - Weekday Breakdown
   - Pair Trade Research
   - ADR Reach Research
6. Eco Events duplicate insert issue was fixed in the live workflow.
7. Layer 2 live dashboard confidence is now browser-enforced to match Pair Trade Research semantics.

### Partially complete / in progress

1. ADR Reach Research OHLC expansion
   - shipped and partially expanded
   - supported:
     - `EUR`
     - `NQ`
     - `BTC`
     - `EUR/USD`
     - `NQ/USD`
     - `BTC/USD`
   - unsupported:
     - `Gold`
     - `XAU/USD`
     - `USD`

2. Workflow documentation coverage
   - exports are present
   - human-readable workflow docs are incomplete

3. n8n integration tooling
   - repo has workflow exports and docs
   - deeper automated inspection/editing capability exists only partially

### What is not broken, just intentionally incomplete

1. Layer 2 is still relatively simple
   - do not assume this is accidental
   - it is intentionally downstream of Layer 1, not a fully independent cross-asset model

2. ADR unavailable states
   - these are not failures
   - they are deliberate refusals to overstate evidence

3. Some docs are stale in small places
   - for example, some older docs still describe known issues or workflow order in outdated terms
   - the exports and current data files are usually more authoritative than older prose

---

## 5. Known Issues And Open Questions

### Known issues

1. EUR Layer 1 parser brittleness
   - `workflows/eur_layer1_agent.md` documents a parser bug where the workflow may assume the OpenAI result is always a string and call `JSON.parse(text)`.
   - If OpenAI returns an object because `Output Format: JSON Object` is enabled, that parser can fail.
   - Repo docs still treat this as a known issue unless confirmed fixed in the live workflow.

2. Workflow docs vs actual runtime/export drift
   - Some docs still mention older assumptions:
     - older orchestrator behavior
     - older known-issue descriptions
     - old dates such as `2026-06-28` for last successful run
   - Current runtime artifact:
     - `data/workflow-status.json`
   - Current exports are usually more authoritative than older workflow markdown.

3. Upstream Layer 2 workflow confidence semantics may still differ from the browser/research invariant
   - The dashboard now fixes the live display logic.
   - That does **not** automatically mean the n8n `Layer 2 Trade Selection Agent` itself has been rewritten to use the same invariant internally.
   - If Fable 5 is building a competing clone, it should compare:
     - `exports/layer2_trade_selection_agent.json`
     - `data/layer2.json`
     - `script.js`
     - `backtester/lib/layer2_pair_logic.js`

4. ADR Reach Research missing support for `Gold`, `XAU/USD`, and `USD`
   - Blocked by lack of supportable repo-local true `XAU/USD` OHLC and `DXY` OHLC.

### Open questions / uncertainty

1. Is the live EUR parser bug still present in n8n?
   - Docs say yes unless explicitly confirmed fixed.
   - Runtime currently seems healthy, so it may be dormant or already fixed.
   - This should be verified against `exports/eur_layer1_agent.json` or live workflow code.

2. How much of the live Layer 2 logic should remain in n8n vs browser?
   - Current state is pragmatic:
     - n8n publishes raw Layer 2 output
     - browser enforces the more defensible confidence invariant
   - A cleaner architecture may be to align the n8n Layer 2 workflow itself.

3. Are all collectors documented well enough to rebuild independently?
   - Not yet.
   - Exports exist, but markdown documentation is not complete for every workflow.

4. Which source should be treated as authoritative when docs disagree?
   - Best order of trust is:
     1. current runtime artifacts in `data/`
     2. current workflow exports in `exports/`
     3. current code in `script.js` and `backtester/`
     4. older prose docs

---

## 6. What "Better" Would Mean

If I were continuing this project, these would be the highest-value improvements.

### Priority 1: Align live Layer 2 workflow semantics at the source

Why:

- Right now the dashboard fixes Layer 2 confidence semantics in the browser.
- That is better than displaying wrong confidence, but the cleaner end state is for:
  - n8n Layer 2 workflow
  - `data/layer2.json`
  - browser dashboard
  - Pair Trade Research
  - ADR pair logic

to all use the exact same pair-eligibility and confidence semantics.

Meaningful improvement would be:

- upstream Layer 2 workflow emits the same `min(target, USD)` combined confidence
- same-direction and non-directional cases are encoded explicitly as no-trade/conflict
- browser no longer needs to compensate for semantic drift

### Priority 2: Expand supportable OHLC coverage for ADR Reach Research

Why:

- This is the active unfinished milestone.
- It unlocks missing research coverage without changing live production logic.

Concrete target:

- find supportable true `XAU/USD` OHLC history
- optionally find supportable `DXY` OHLC history
- keep unsupported assets explicitly unavailable until the source is defensible

### Priority 3: Close the loop on known workflow drift

Why:

- Several repo docs are now behind the actual exports/runtime.
- That creates friction for any new AI or human trying to reason about the system.

Meaningful improvement would be:

- reconcile docs with exports and current runtime artifacts
- especially around:
  - orchestrator order
  - Layer 2 presence
  - last successful run dates
  - remaining active bugs

### Priority 4: Verify live-vs-replay parity more rigorously

Why:

- The repo correctly distinguishes reproducibility from true production parity.
- That distinction should be preserved and tightened, not blurred.

Meaningful improvement would be:

- explicit parity fixtures for more assets
- documented proof of where replay exactly matches live production logic
- avoid claiming more certainty than exists

### Priority 5: Improve workflow-level observability

Why:

- The current status file is useful, but still fairly coarse.
- Better diagnostics would reduce debugging time significantly.

Meaningful improvement would be:

- richer step-level error metadata
- cleaner distinction between:
  - failed
  - not run
  - partial success
  - soft warnings

### Priority 6: Build a clearer independent clone benchmark

Since Fable 5 is being asked to build a competing dashboard clone, the benchmark for "better" should not be style alone.

A genuinely better clone would:

1. Preserve Layer 1 isolation and research/downstream separation.
2. Make the live pipeline easier to inspect end-to-end.
3. Surface which values are raw upstream outputs vs browser-derived corrections.
4. Make it obvious which research views are deterministic and which are runtime-driven.
5. Avoid hiding unsupported data behind fake certainty.
6. Keep confidence semantics consistent everywhere.

If a clone only looks nicer but muddies those distinctions, it is worse, not better.

---

## Suggested First Files For Fable 5 To Read

If starting fresh with no other context, read these in this order:

1. `CODEX_STARTUP.md`
2. `docs/CURRENT_STATE.md`
3. `docs/CURRENT_TASK.md`
4. `docs/ACTIVE_MILESTONE.md`
5. `docs/SESSION_NOTES.md`
6. `script.js`
7. `index.html`
8. `exports/master_orchestrator.json`
9. `exports/dashboard_writer.json`
10. `exports/layer2_trade_selection_agent.json`
11. `data/layer1.json`
12. `data/layer2.json`
13. `data/workflow-status.json`
14. `backtester/lib/headline_confidence.js`
15. `backtester/lib/layer2_pair_logic.js`
16. `backtester/scripts/validate_layer2_pairing_analysis.js`
17. `backtester/scripts/validate_adr_reach_research.js`
18. `playwright-dashboard-smoke.js`

That set will reveal most of the production architecture, current semantics, and active constraints without requiring prior chat history.
