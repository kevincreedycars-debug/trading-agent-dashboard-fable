# Current State — AI Trading Platform

Last updated: 2026-06-19

## Platform Status

The Layer 1 trading-agent platform is largely complete. The project is now moving from individual agent construction into AI-assisted development, project memory, workflow orchestration, and direct integration between ChatGPT/Codex, GitHub, and n8n.

## Current Architecture

```text
Market Collectors
        ↓
Market Snapshot (Supabase)
        ↓
Independent Layer 1 Agents
        ↓
agent_outputs
        ↓
Dashboard Writer
        ↓
Netlify Dashboard
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
        ↓
Eco Events Collector
        ↓
USD Collector
        ↓
EUR Collector
        ↓
Gold Collector
        ↓
NQ Collector
        ↓
BTC Collector
        ↓
USD Layer 1 Agent
        ↓
EUR Layer 1 Agent
        ↓
Gold Layer 1 Agent
        ↓
NQ Layer 1 Agent
        ↓
BTC Layer 1 Agent
        ↓
Dashboard Writer
```

Every workflow has been converted to use `Execute Sub-workflow Trigger`, allowing the master workflow to call workflows sequentially.

## Known Current Issues

### 1. Eco Events duplicate insert

The Eco Events Collector currently fails when it tries to insert an event that already exists.

Observed error:

```text
duplicate key value violates unique constraint

economic_events_event_date_currency_event_name_event_time_t_key
```

This is an Eco Events Collector issue, not a Master Orchestrator issue.

Preferred solution:

- upsert, or
- `ON CONFLICT DO NOTHING`, or
- Supabase custom API/RPC call

Avoid unnecessary Get → IF → Create logic unless no cleaner approach is available.

### 2. EUR Agent JSON parsing

The EUR Layer 1 Agent can fail when the OpenAI node output is returned as an object instead of a string.

Original parser assumed:

```js
JSON.parse(text)
```

But after enabling OpenAI `Output Format: JSON Object`, the parser must support both:

- string output
- object output

Fix required: update the EUR parser to detect whether the OpenAI result is already an object before calling `JSON.parse`.

### 3. Master workflow final status summary

The Master Orchestrator currently needs a final success/failure summary output.

Desired success format:

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

Desired failure format:

```text
FAILED

EUR Agent

Reason:
OpenAI invalid JSON
```

Eventually this status should also appear on the dashboard.

## Current Strategic Shift

The project is transitioning from:

> building trading agents

into:

> building an AI-assisted autonomous development environment for the trading platform

GitHub should become the source of truth. n8n remains the execution engine. Supabase remains the data layer. Netlify remains the presentation layer.

## Target Development Model

```text
ChatGPT / Codex
        │
        ├── GitHub repository
        ├── n8n workflows
        ├── Supabase data layer
        └── Netlify dashboard
```

ChatGPT should handle architecture, debugging, reasoning, planning, and documentation.

Codex should handle file edits, workflow JSON edits, code changes, commits, and implementation.

Both should eventually be able to inspect GitHub and n8n without manual copy/paste from the user.
