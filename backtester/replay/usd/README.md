# USD Historical Replay Engine

This replay path is backtester-only.

It does not:

- modify live Layer 1 agents
- feed results back into production
- alter dashboard behavior

It uses:

- `historical_usd_market_snapshots`
- current production logic from `logic/agent_usd_direction.md`

The goal is the first deterministic USD replay path, not perfect parity.

## Outputs

For each historical USD snapshot, the engine creates:

- one `research_observations` row
- one `research_model_contexts` row
- one `research_agent_verdicts` row
- four `research_timeframe_predictions` rows
- one `research_factor_observations` row per factor per timeframe

Phase 1 timeframes:

- `following 24hrs`
- `3d from call`
- `current week`
- `current month`

## Stored prediction fields

Each prediction row carries:

- direction
- conviction
- bull case
- bear case
- net edge
- participation
- strength
- factor breakdown
- warnings
- missing inputs
- logic document
- logic document version
- replay version

## Run

```powershell
node backtester/replay/usd/run_usd_historical_replay.js --start=2018-01-01 --end=2024-12-31
```

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
