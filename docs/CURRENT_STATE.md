# Current State - AI Trading Platform

Last updated: 2026-07-02

## Platform Status

The Layer 1 trading-agent platform remains operational, and the latest runtime evidence shows the Master Orchestrator completed successfully on 2026-06-28.

The full Layer 1 historical replay rollout is now validated across USD, EUR, Gold, NQ, and BTC. The active repository work has shifted from replay rollout itself into downstream research presentation and breakdown views built on top of the canonical checker artifacts.

The current dashboard now includes the existing accuracy matrices, the checker workspaces, and a new weekday breakdown view that shows day-of-week performance by displayed headline confidence bucket without changing replay, checker, flat-band, or confidence semantics.

## Current Architecture

```text
Market Collectors
        ->
Market Snapshot (Supabase)
        ->
Independent Layer 1 Agents
        ->
agent_outputs
        ->
Dashboard Writer
        ->
GitHub Pages Dashboard
```

Layer 2 economic-event adjustment will be built later.

## Layer 1 Assets

- USD
- EUR
- Gold / XAU
- NQ
- BTC

## Layer 1 Isolation Rule

Each Layer 1 agent must remain sealed and independent.

No Layer 1 agent may:

- read another agent output
- read dashboard output
- read Layer 2 output
- synthesise pair relationships using other agents
- contaminate its own raw call with another asset's call

Each Layer 1 agent receives only:

- its own logic document
- the latest usable market snapshot

Each Layer 1 agent answers:

> Based on confirmed value-driving factors available at execution time, what is the likely direction of this asset?

## Master Orchestrator

A Master Orchestrator workflow has been created in n8n.

Purpose: one manual button press runs the whole platform sequentially.

Current intended execution order:

```text
Manual Trigger
        ->
Eco Events Collector
        ->
USD Collector
        ->
EUR Collector
        ->
Gold Collector
        ->
NQ Collector
        ->
BTC Collector
        ->
USD Layer 1 Agent
        ->
EUR Layer 1 Agent
        ->
Gold Layer 1 Agent
        ->
NQ Layer 1 Agent
        ->
BTC Layer 1 Agent
        ->
Dashboard Writer
```

Every workflow has been converted to use `Execute Sub-workflow Trigger`, allowing the master workflow to call workflows sequentially.

Runtime evidence in `data/workflow-status.json` shows a successful Master Orchestrator run on 2026-06-28, with every listed step marked successful and no reported error.

## Known Current Issues

### 1. Eco Events duplicate insert

This issue was fixed on 2026-06-21.

The live `Eco Events Collector` was updated to dedupe incoming events, update existing rows, and create only unmatched rows. The previous duplicate-key failure is no longer an active known issue.

### 2. EUR Agent JSON parsing

The EUR Layer 1 Agent can fail when the OpenAI node output is returned as an object instead of a string.

Original parser assumed:

```js
JSON.parse(text)
```

After enabling OpenAI `Output Format: JSON Object`, the parser must support both:

- string output
- object output

This remains a known issue unless confirmed fixed in the live workflow.

### 3. Master workflow final status summary

The latest runtime artifact in `data/workflow-status.json` now provides a useful success payload, including a top-level message, per-step statuses, and no reported error for the latest run.

Any further refinement should be driven by observed runtime gaps rather than by the older missing-summary assumption.

## Current Deployment State

The repository currently documents and exposes GitHub Pages as the active static host:

```text
https://kevincreedycars-debug.github.io/trading-agent-dashboard/
```

Older architecture notes that refer to Netlify are historical context and should not be treated as the current host model.

## Current Strategic Shift

The project has already established the AI-assisted development environment baseline and completed the Layer 1 historical replay rollout. The current repository priority is downstream analytical visibility and validation on top of those frozen checker artifacts.

The current repository priority is:

> compact historical research breakdowns that reuse canonical checker artifact outputs

GitHub is the source of truth. n8n remains the execution engine. Supabase remains the data layer. GitHub Pages is the active presentation host.

## Target Development Model

```text
ChatGPT / Codex
        |
        |-- GitHub repository
        |-- n8n workflows
        |-- Supabase data layer
        `-- GitHub Pages dashboard
```

ChatGPT should handle architecture, debugging, reasoning, planning, and documentation.

Codex should handle file edits, workflow JSON edits, code changes, commits, and implementation.

Both should eventually be able to inspect GitHub and n8n without manual copy/paste from the user.

## Permanent Working Memory

Codex startup is now governed by `CODEX_STARTUP.md`.

Every Codex session must use `CODEX_STARTUP.md` as the single startup entry point, always read the core memory files first, selectively load additional documents only when relevant, then inspect repository and runtime state before editing.

The memory documents are authoritative between sessions and should be updated only when their contents actually change.

The canonical project memory set is:

- `CODEX_STARTUP.md`
- `docs/CURRENT_STATE.md`
- `docs/CURRENT_TASK.md`
- `docs/ACTIVE_MILESTONE.md`
- `docs/NEXT_STEPS.md`
- `docs/CHANGELOG.md`
- `docs/DECISIONS.md`
- `docs/SESSION_NOTES.md`
- `docs/PROJECT_HISTORY.md`
- `docs/ARCHITECTURE.md`
- `docs/N8N_INTEGRATION.md`
- `workflows/WORKFLOW_INVENTORY.md`

## Historical Research Platform

The historical research platform is downstream-only and must not modify production behavior.

Authoritative principles live in:

- `docs/CORE_RESEARCH_PHILOSOPHY.md`

Current implemented state:

- Historical replay and deterministic checker coverage are validated for USD, EUR, Gold, NQ, and BTC.
- Current checker totals are USD `604`, EUR `602`, Gold `608`, NQ `604`, and BTC `850`, all passing with zero fail / zero missing / zero tolerance pass.
- The Backtest / Accuracy dashboard exposes the existing matrices and checker workspaces plus a weekday confidence breakdown derived directly from the checker artifacts.
- 24H remains the primary short-horizon benchmark focus.
- Historical research presentation remains downstream-only and must not modify live runtime behavior.
