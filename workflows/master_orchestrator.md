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

## Known Issues

- Eco Events duplicate insert can break execution.
- EUR Agent parser can fail if OpenAI output is an object rather than a string.
- Final execution summary is not yet implemented.

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
