# Historical Outcome Evaluation Framework

## Purpose

This document locks the deterministic Phase 1 evaluation rules used after replay outputs exist.

It does not:

- modify live Layer 1 agents
- change dashboard logic
- redesign the observation-first architecture

The current production logic documents in `/logic` remain the active source of truth for replayed agent behavior.

## Phase 1 Prediction Rows

Every replayed verdict should create one `research_timeframe_predictions` row for each active Phase 1 timeframe:

- `following 24hrs`
- `3d from call`
- `current week`
- `current month`

Backlog only, not evaluated yet:

- `12hr`
- `current day`
- `following week`
- `following month`

## Evaluation Storage Model

`research_timeframe_predictions` remains the parent prediction row.

`research_prediction_evaluations` stores deterministic scoring rows.

One prediction can have one or more evaluation rows depending on the asset:

- USD can be compared against multiple markets
- EUR, Gold, NQ, and BTC Phase 1 each have one primary evaluation market

This keeps the architecture additive instead of replacing the existing observation-first tables.

## Canonical Time Rules

Phase 1 uses two evaluation families:

- USD, EUR, Gold, and NQ use America/New_York trading-session windows
- BTC uses 24/7 crypto windows anchored in ET for consistency

### `following 24hrs`

- open reference: `09:30 America/New_York` on the call date
- close reference: `16:00 America/New_York` on the next valid trading/session day

### `3d from call`

- open reference: `09:30 America/New_York` on the call date
- close reference: `16:00 America/New_York` three valid trading/session days later

### `current week`

- open reference: `09:30 America/New_York` on the call date
- close reference: `16:00 America/New_York` on that week’s Friday
- if the call is already at or after the evaluation close, the row is `NOT_EVALUABLE`

### `current month`

- open reference: `09:30 America/New_York` on the call date
- close reference: `16:00 America/New_York` on the final valid trading/session day of that month
- if the call is already at or after the evaluation close, the row is `NOT_EVALUABLE`

## BTC 24/7 Time Rules

BTC does not use the Monday-Friday NY cash-session rule in Phase 1.

BTC uses continuous 24/7 windows.

### `following 24hrs`

- open reference: exact call timestamp in ET
- close reference: exact call timestamp plus 24 hours

Examples:

- Saturday `07:00 ET` -> Sunday `07:00 ET`
- Sunday `07:00 ET` -> Monday `07:00 ET`

### `3d from call`

- open reference: exact call timestamp in ET
- close reference: exact call timestamp plus 72 hours

### `current week`

- open reference: exact call timestamp in ET
- close reference: Sunday `23:59:59 ET` of the containing crypto week

### `current month`

- open reference: exact call timestamp in ET
- close reference: `23:59:59 ET` on the final calendar day of that month

## Valid Trading / Session Days

Phase 1 uses a simple Monday-Friday session calendar.

Weekend call dates are treated as `NOT_EVALUABLE` for USD, EUR, Gold, and NQ because those assets use the valid NY session calendar in Phase 1.

BTC is the exception and remains evaluable on weekends using the 24/7 crypto rules above.

## Flat Thresholds

Flat means the realised move stayed inside a neutral band, not that price was exactly unchanged.

Phase 1 default thresholds:

- `DXY`: `0.15%`
- `EURUSD`: `0.20%`
- `XAUUSD`: `0.30%`
- `QQQ_NQ_PROXY`: `0.40%`
- `BTCUSD`: `1.00%`

Classification:

- `pct_change > flat_threshold` -> `BULLISH`
- `pct_change < -flat_threshold` -> `BEARISH`
- otherwise -> `FLAT`

## Magnitude And Calibration Fields

Phase 1 evaluation is not purely binary.

Each evaluation row also stores:

- `abs_pct_change`
- `move_magnitude_bucket`
- `conviction_bucket`
- `conviction_move_alignment`
- `evaluation_quality`
- `expected_move_threshold`
- `exceeded_expected_move`
- `calibration_notes`

### Move magnitude buckets

Let:

- `flat_threshold = market flat band`
- `abs_pct_change = absolute realised move`

Then:

- `FLAT_NOISE` if `abs_pct_change <= flat_threshold`
- `SMALL_MOVE` if `abs_pct_change > flat_threshold` and `<= flat_threshold * 2`
- `MEDIUM_MOVE` if `abs_pct_change > flat_threshold * 2` and `<= flat_threshold * 4`
- `LARGE_MOVE` if `abs_pct_change > flat_threshold * 4`

### Conviction buckets

- `LOW_CONVICTION` if conviction `< 55`
- `MODERATE_CONVICTION` if conviction `>= 55` and `< 70`
- `HIGH_CONVICTION` if conviction `>= 70` and `< 85`
- `VERY_HIGH_CONVICTION` if conviction `>= 85`
- `UNKNOWN_CONVICTION` if conviction is missing

### Expected move threshold

- `LOW_CONVICTION` -> `flat_threshold * 1`
- `MODERATE_CONVICTION` -> `flat_threshold * 2`
- `HIGH_CONVICTION` -> `flat_threshold * 3`
- `VERY_HIGH_CONVICTION` -> `flat_threshold * 4`
- `UNKNOWN_CONVICTION` -> `flat_threshold * 1`

`exceeded_expected_move = abs_pct_change >= expected_move_threshold`

### Evaluation quality

- `EXCELLENT` = direction correct and move magnitude is `MEDIUM_MOVE` or `LARGE_MOVE`
- `GOOD` = direction correct and move magnitude is `SMALL_MOVE`
- `WEAK_CORRECT` = direction correct but move magnitude is `FLAT_NOISE`
- `WRONG` = direction wrong
- `FLAT` = market outcome flat
- `NO_CALL` = no directional agent call
- `NOT_EVALUABLE` = missing data or invalid window
- `MIXED` = combined multi-market result is mixed

### Conviction / move alignment

- `ALIGNED_STRONG`
- `ALIGNED_MODEST`
- `OVERCONFIDENT`
- `UNDERCONFIDENT`
- `NEUTRAL`

## Asset-Specific Evaluation Markets

### USD

- `DXY`: direct, primary
- `EURUSD`: inverse, primary
- `XAUUSD`: inverse, contextual
- `BTCUSD`: inverse, contextual
- `QQQ_NQ_PROXY`: contextual

Notes:

- direct means compare the market outcome direction directly to the agent direction
- inverse means invert the market outcome direction before comparing to the agent direction
- contextual means the row is still stored and scored, but it should not replace the primary USD markets in later analysis

### EUR

- `EURUSD`: direct, primary

### GOLD

- `XAUUSD`: direct, primary

### NQ

- `QQQ_NQ_PROXY`: direct, primary

### BTC

- `BTCUSD`: direct, primary

## Result Labels

Allowed results:

- `CORRECT`
- `WRONG`
- `FLAT`
- `MIXED`
- `NO_CALL`
- `NOT_EVALUABLE`

Rules for a single market evaluation row:

- `NO_CALL`: agent direction is missing or `NO_CLEAR_BIAS`
- `NOT_EVALUABLE`: the Phase 1 ET window cannot be evaluated
- `FLAT`: realised market move stayed inside the flat band
- `CORRECT`: the comparable market direction matches the agent direction
- `WRONG`: the comparable market direction opposes the agent direction

`MIXED` is reserved for combined multi-market summaries, such as a USD timeframe where some market evaluations are correct and others are wrong or flat.

## Day-Of-Week Accuracy

`research_prediction_evaluations` stores:

- `call_date`
- `call_day_of_week`
- `timeframe`
- `result`

That is enough to compute:

- accuracy by timeframe
- accuracy by weekday
- weekday performance by evaluated market

## Dry Run Utility

Use:

```powershell
node backtester/scripts/dry_run_outcome_evaluation.js --asset=USD --market=DXY --timeframe=following_24hrs --call-date=2024-01-08 --call-time-et=10:15:00 --agent-direction=BULLISH_LEAN --agent-conviction=62 --open-price=100 --close-price=100.42
```

It prints:

- what the agent said
- what the market did
- which ET window was used
- how large the move was relative to the flat band
- how conviction aligned with realised movement
- what result was assigned

This utility is backtester-only and does not connect to live Layer 1.
