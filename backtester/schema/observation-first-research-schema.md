# Observation-First Research Schema

## Design Goal

The backtester is a market research and model evaluation platform.

It is not just a prediction log.

The parent object is an Observation.

Each Observation preserves everything knowable at the decision point so later research can answer:

- what the market looked like
- what the agent saw
- what the agent concluded
- which factors were present
- which inputs were missing
- which model/version stack was active
- what later happened
- how future AI reviews or optimization runs should interpret the event

## Core Tables

### `research_observations`

One row per agent decision snapshot.

Stores:

- timestamp and snapshot identity
- agent and asset
- market snapshot seen by the workflow
- regime and quality metadata
- warnings and missing inputs

### `research_model_contexts`

One row per observation version context.

Stores:

- logic document and logic version
- collector versions
- prompt version
- weight model version
- conviction model version
- workflow version
- repo commit if known

### `research_agent_verdicts`

One row per observation.

Stores:

- reasoning summary
- raw model output
- expanded normalized output
- high-level verdict scores

### `research_timeframe_predictions`

One row per observation per timeframe.

Stores:

- legacy timeframe source key
- canonical timeframe
- mapping status
- direction
- conviction
- bull/bear/neutral decomposition
- weighted score
- conviction model
- replay metadata such as logic document version, replay version, warnings, and missing inputs

This table supports both current live shapes and future canonical shapes without requiring a live-agent redesign first.

### `research_factor_observations`

One row per observation per timeframe per factor.

Stores:

- factor key
- signal
- weight
- evidence
- reason
- payload

This is the main research surface for factor reliability analysis.

### `research_realised_outcomes`

One row per timeframe prediction once its horizon has been evaluated.

Stores:

- entry/exit timing
- entry/exit prices
- realized return
- realized direction
- final outcome label
- settlement metadata

### `research_prediction_evaluations`

One row per timeframe prediction per evaluated market.

Stores:

- the ET-anchored open/close evaluation window
- evaluated market such as DXY, EURUSD, XAUUSD, QQQ proxy, or BTCUSD
- realised percent change
- flat threshold used
- move magnitude bucket
- conviction bucket
- conviction / move alignment
- evaluation quality
- expected move threshold and exceeded-expected-move flag
- market outcome direction
- agent direction and conviction at evaluation time
- deterministic result label
- weekday fields for accuracy slicing

This table is the Phase 1 deterministic scoring surface.

It is additive to `research_timeframe_predictions` rather than a replacement for the existing observation-first structure.

## Extension Tables

### `research_ai_reviews`

Future manual or AI reviews of an observation or prediction.

### `research_optimization_runs`

Future optimization or recalibration sessions.

### `research_optimization_findings`

Structured findings linking optimization output back to observations, predictions, and factor patterns.

## Canonical Timeframes

The canonical research timeframes are:

- `12hr`
- `current day`
- `following 24hrs`
- `3d from call`
- `current week`
- `following week`
- `current month`
- `following month`

## Current Safe Mapping Status

The current live Layer 1 shape safely maps only part of the canonical set:

- `3d` -> `3d from call`
- `current_week` -> `current week`
- `next_week` -> `following week`
- `current_month` -> `current month`

The current live `24h` output is intentionally left ambiguous until the authoritative backtester master logic is available. That avoids silently contaminating research history with the wrong horizon semantics.
