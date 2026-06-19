# Architecture — AI Trading Platform

Last updated: 2026-06-19

## High-Level System

```text
Market Collectors
        ↓
Supabase market_snapshots
        ↓
Independent Layer 1 Agents
        ↓
Supabase agent_outputs
        ↓
Dashboard Writer
        ↓
Netlify Dashboard
```

## Platform Components

### GitHub

GitHub is the single source of truth for:

- project state
- architecture
- decisions
- bugs
- logic documents
- workflow documentation
- workflow JSON exports
- dashboard code

### n8n

n8n is the execution engine.

It runs:

- Eco Events Collector
- USD Collector
- EUR Collector
- Gold Collector
- NQ Collector
- BTC Collector
- USD Layer 1 Agent
- EUR Layer 1 Agent
- Gold Layer 1 Agent
- NQ Layer 1 Agent
- BTC Layer 1 Agent
- Dashboard Writer
- Master Orchestrator

### Supabase

Supabase is the canonical data layer.

Key tables:

- `market_snapshots`
- `agent_outputs`
- `economic_events`

### Netlify

Netlify hosts the Layered Directional Command Dashboard.

The dashboard displays Layer 1 raw calls and, later, Layer 2 adjusted calls separately.

## Layer 1 Rules

Layer 1 agents are sealed raw directional agents.

They must not read:

- other Layer 1 agents
- dashboard output
- Layer 2 output
- pair synthesis from another agent

They may read only:

- their own logic document
- latest usable market snapshot

## Master Orchestrator

The Master Orchestrator should run every platform component sequentially.

Current intended order:

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

## AI Development Environment

Target model:

```text
ChatGPT / Codex
        │
        ├── GitHub
        ├── n8n API / MCP
        ├── Supabase
        └── Netlify
```

ChatGPT is used for:

- architecture
- reasoning
- debugging
- documentation
- review

Codex is used for:

- implementation
- edits
- commits
- workflow JSON changes
- structured refactoring

## n8n Integration Strategy

Use the n8n API first because it is stable and production-oriented.

Use n8n MCP second if it improves AI workflow browsing and node-level editing.

Sensitive credentials must never be committed to GitHub.
