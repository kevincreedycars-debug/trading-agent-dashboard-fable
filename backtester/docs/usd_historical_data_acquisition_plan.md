# USD Historical Data Acquisition Plan

## Purpose

This document maps every required USD Phase 1 historical input to a realistic historical data source before any ingestion is built.

Phase 1 active horizons:

- `following 24hrs`
- `3d from call`
- `current week`
- `current month`

This plan is downstream-only.

It does not modify:

- live Layer 1 agents
- live dashboard rendering
- live signal workflows

## USD Phase 1 Logic Scope

The current USD logic uses these main factor families:

- VIX / risk regime
- US 2Y yield delta
- US-Germany 2Y spread delta
- US 10Y real yield delta
- DXY momentum
- Gold momentum
- recent US economic surprise
- derived Fed bias
- Dollar Smile regime context
- equity / USD regime context via NQ proxy

For Phase 1, the goal is not perfect parity on day one.

The goal is to get a usable first historical reconstruction run using realistic daily or near-daily history with clearly documented approximations.

---

## 1. Raw Imported Data

### `raw_us_2y_yield`

- Purpose in USD logic: primary input for Factor 2 `US 2-Year Yield Delta`
- Preferred historical source: FRED `DGS2`
- Backup source: Treasury / Macrotrends / TradingEconomics export
- Required frequency: daily
- Required history length: at least 20 prior trading days before first reconstructed snapshot; ideally full backtest range plus 30 days warm-up
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: FRED is stable and appropriate for daily macro reconstruction

### `raw_us_10y_yield`

- Purpose in USD logic: supporting context and parity with current collector payload
- Preferred historical source: FRED `DGS10`
- Backup source: Treasury / Macrotrends / TradingEconomics export
- Required frequency: daily
- Required history length: same as `raw_us_2y_yield`
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: not a top-line Phase 1 driver by itself, but useful for parity and future extensions

### `raw_us_10y_real_yield`

- Purpose in USD logic: primary input for Factor 4 `US 10-Year Real Yield Delta`
- Preferred historical source: FRED `DFII10`
- Backup source: TradingEconomics / alternate real-yield series export
- Required frequency: daily
- Required history length: full backtest range plus 30 days warm-up
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: daily availability is good enough for Phase 1 active horizons

### `raw_vix_level`

- Purpose in USD logic: primary input for Factor 1 and Factor 9 regime checks
- Preferred historical source: FRED `VIXCLS`
- Backup source: CBOE historical VIX export / Stooq
- Required frequency: daily
- Required history length: full range plus 20 trading days warm-up
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: daily close is acceptable for Phase 1; intraday VIX is not required while `12hr` is out

### `raw_dxy_level`

- Purpose in USD logic: primary input for Factor 5 and key tiebreaker / trend checks
- Preferred historical source: FRED `DTWEXBGS`
- Backup source: ICE DXY proxy export / Stooq / Investing.com export
- Required frequency: daily
- Required history length: full range plus 20 trading days warm-up
- Raw or derived: raw imported
- Cost: free if FRED broad dollar is used; paid/unclear for true ICE DXY history
- Import difficulty: medium
- Confidence level: medium
- Notes / risks: FRED `DTWEXBGS` is a broad trade-weighted dollar index, not the classic ICE DXY. This is the biggest USD parity risk if the live logic assumed a more DXY-like behavior.

### `raw_de_2y_yield`

- Purpose in USD logic: primary foreign leg for Factor 3 `US/Germany 2-Year Rate Differential Delta`
- Preferred historical source: Bundesbank daily Germany 2Y series
- Backup source: TradingEconomics export / Investing.com export / curated CSV
- Required frequency: daily
- Required history length: full range plus 20 trading days warm-up
- Raw or derived: raw imported
- Cost: free if Bundesbank; unclear otherwise
- Import difficulty: medium
- Confidence level: medium
- Notes / risks: this is a critical Phase 1 field. Source continuity and formatting quality need checking before implementation.

### `raw_de_10y_yield`

- Purpose in USD logic: optional parity / context; not a direct Phase 1 driver
- Preferred historical source: FRED German long-term rate proxy
- Backup source: Bundesbank / TradingEconomics export
- Required frequency: daily
- Required history length: same as other rates
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: medium
- Notes / risks: optional for first run

### `raw_gold_price`

- Purpose in USD logic: primary input for Factor 6 `Gold 5-Day Delta`
- Preferred historical source: daily gold spot history
- Backup source: GLD daily close / GC futures proxy
- Required frequency: daily
- Required history length: full range plus 20 trading days warm-up
- Raw or derived: raw imported
- Cost: free or unclear depending on source
- Import difficulty: medium
- Confidence level: medium
- Notes / risks: using GLD or GC instead of spot may slightly distort signal timing, but is acceptable for a first run if documented

### `raw_nq_price`

- Purpose in USD logic: primary input for Factor 10 and supporting regime context
- Preferred historical source: QQQ daily close
- Backup source: Nasdaq 100 index history / NQ futures daily proxy
- Required frequency: daily
- Required history length: full range plus 20 trading days warm-up
- Raw or derived: raw imported
- Cost: free or unclear depending on source
- Import difficulty: low
- Confidence level: high
- Notes / risks: QQQ is the quickest viable proxy for Phase 1

### `raw_nq_d1_pct_vendor`

- Purpose in USD logic: optional parity with live collector, which may use vendor-supplied daily change
- Preferred historical source: same vendor as `raw_nq_price` if direct change field exists
- Backup source: derive from daily closes
- Required frequency: daily
- Required history length: same as `raw_nq_price`
- Raw or derived: raw imported if available, otherwise not needed
- Cost: free/unclear
- Import difficulty: low
- Confidence level: high
- Notes / risks: can be safely derived, so import is optional

---

## 2. Derived Fields

These should not be imported as truth. They should be derived reproducibly from raw history.

### `vix_d1`

- Purpose in USD logic: short-horizon VIX direction / conflict signal
- Preferred historical source: derive from `raw_vix_level`
- Backup source: none needed
- Required frequency: daily
- Required history length: 1 prior observation minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: daily difference rather than intraday is acceptable for Phase 1

### `vix_d5`

- Purpose in USD logic: Factor 1 trend signal and tiebreak support
- Preferred historical source: derive from `raw_vix_level`
- Backup source: none needed
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: must define whether this uses trading-day count or calendar lookback; use trading observations for consistency

### `us_2y_d5_bps`

- Purpose in USD logic: main Factor 2 directional signal for all active Phase 1 horizons
- Preferred historical source: derive from `raw_us_2y_yield`
- Backup source: none needed
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: convert percent-point moves to basis points consistently

### `us_2y_d20_bps`

- Purpose in USD logic: structural trend support for `current week` and `current month`
- Preferred historical source: derive from `raw_us_2y_yield`
- Backup source: none needed
- Required frequency: daily
- Required history length: 20 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: needed for monthly-quality reconstruction

### `de_2y_d5_bps`

- Purpose in USD logic: support leg for rate differential reconstruction
- Preferred historical source: derive from `raw_de_2y_yield`
- Backup source: none needed
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free/unclear
- Import difficulty: low once raw series exists
- Confidence level: medium
- Notes / risks: inherits source risk from Germany 2Y

### `us_de_2y_spread`

- Purpose in USD logic: relative rates context
- Preferred historical source: derive from `raw_us_2y_yield - raw_de_2y_yield`
- Backup source: none needed
- Required frequency: daily
- Required history length: same-day values only
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: only valid if both raw legs are aligned to the same observation convention

### `us_de_2y_spread_d5_bps`

- Purpose in USD logic: main Factor 3 directional signal
- Preferred historical source: derive from `us_de_2y_spread`
- Backup source: none needed
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: medium-high
- Notes / risks: this is one of the highest-value USD fields and should be treated as critical

### `us_10y_real_yield_d5_bps`

- Purpose in USD logic: main Factor 4 directional signal
- Preferred historical source: derive from `raw_us_10y_real_yield`
- Backup source: none needed
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: critical for all active Phase 1 horizons

### `us_10y_real_yield_d20_bps`

- Purpose in USD logic: structural trend input for `current week` and `current month`
- Preferred historical source: derive from `raw_us_10y_real_yield`
- Backup source: none needed
- Required frequency: daily
- Required history length: 20 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high

### `dxy_d1`

- Purpose in USD logic: short-horizon momentum context
- Preferred historical source: derive from `raw_dxy_level`
- Backup source: derive from alternate DXY proxy if used
- Required frequency: daily
- Required history length: 1 prior observation minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: medium
- Notes / risks: confidence depends on whether `DTWEXBGS` is accepted as the Phase 1 proxy

### `dxy_d5`

- Purpose in USD logic: main Factor 5 directional signal and top tiebreaker
- Preferred historical source: derive from `raw_dxy_level`
- Backup source: alternate DXY proxy
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free/unclear
- Import difficulty: low
- Confidence level: medium
- Notes / risks: one of the most accuracy-sensitive approximation risks if using broad dollar rather than classic DXY

### `dxy_d20`

- Purpose in USD logic: structural weekly/monthly trend confirmation
- Preferred historical source: derive from `raw_dxy_level`
- Backup source: alternate DXY proxy
- Required frequency: daily
- Required history length: 20 prior observations minimum
- Raw or derived: derived
- Cost: free/unclear
- Import difficulty: low
- Confidence level: medium

### `gold_d1_pct`

- Purpose in USD logic: short-horizon gold confirmation
- Preferred historical source: derive from `raw_gold_price`
- Backup source: GLD/GC proxy series
- Required frequency: daily
- Required history length: 1 prior observation minimum
- Raw or derived: derived
- Cost: free/unclear
- Import difficulty: low
- Confidence level: medium

### `gold_d5_pct`

- Purpose in USD logic: main Factor 6 directional signal
- Preferred historical source: derive from `raw_gold_price`
- Backup source: GLD/GC proxy series
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free/unclear
- Import difficulty: low
- Confidence level: medium

### `gold_d20_pct`

- Purpose in USD logic: structural monthly support
- Preferred historical source: derive from `raw_gold_price`
- Backup source: GLD/GC proxy series
- Required frequency: daily
- Required history length: 20 prior observations minimum
- Raw or derived: derived
- Cost: free/unclear
- Import difficulty: low
- Confidence level: medium

### `nq_d1_pct`

- Purpose in USD logic: Factor 10 short-horizon direction
- Preferred historical source: derive from `raw_nq_price`
- Backup source: vendor change field
- Required frequency: daily
- Required history length: 1 prior observation minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high

### `nq_d5_pct`

- Purpose in USD logic: Factor 10 and weekly context
- Preferred historical source: derive from `raw_nq_price`
- Backup source: none needed
- Required frequency: daily
- Required history length: 5 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high

### `nq_d20_pct`

- Purpose in USD logic: structural `current month` context
- Preferred historical source: derive from `raw_nq_price`
- Backup source: none needed
- Required frequency: daily
- Required history length: 20 prior observations minimum
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high

### `equities_regime`

- Purpose in USD logic: Factor 10 regime gating
- Preferred historical source: derived internally from `vix_level`
- Backup source: none needed
- Required frequency: daily
- Required history length: same-day only
- Raw or derived: derived
- Cost: free
- Import difficulty: low
- Confidence level: high
- Notes / risks: current live logic defines this simply from VIX thresholds

### `fed_bias`

- Purpose in USD logic: main Factor 8 structural driver
- Preferred historical source: derived internally from historical economic events
- Backup source: manual curated Fed/event regime CSV if event coverage is weak
- Required frequency: event-driven / daily snapshot output
- Required history length: enough recent event history to evaluate latest 6-8 relevant events at each observation
- Raw or derived: derived
- Cost: free if source events are free; otherwise unclear
- Import difficulty: medium-high
- Confidence level: medium
- Notes / risks: this is a major reconstruction risk because it depends on event history completeness and correct event classification

---

## 3. Event Data

### `latest_us_event`

- Purpose in USD logic: Factor 7 `US Economic Surprise Direction`
- Preferred historical source: curated historical event table built from Forex Factory archive or Finnhub / TradingEconomics export
- Backup source: manual CSV of major USD events only
- Required frequency: event-based
- Required history length: full backtest range, with at least 72h backward visibility at every observation
- Raw or derived: derived snapshot field from raw event rows
- Cost: unclear
- Import difficulty: high
- Confidence level: medium-low
- Notes / risks: this is the hardest non-price input to source cleanly; release timestamps and actual/forecast integrity matter a lot

### `upcoming_events`

- Purpose in USD logic: conviction reduction when Tier 1 events are pending
- Preferred historical source: same historical event table as `latest_us_event`
- Backup source: manual major-event calendar CSV
- Required frequency: event-based
- Required history length: full range, with forward event visibility at each observation
- Raw or derived: derived snapshot field
- Cost: unclear
- Import difficulty: high
- Confidence level: medium-low
- Notes / risks: future visibility from each historical observation point must be reconstructed correctly, not leaked from later knowledge

### `tier1_event_due_next_24h`

- Purpose in USD logic: conviction adjustment for `following 24hrs`
- Preferred historical source: derive from historical event table
- Backup source: none needed if event table exists
- Required frequency: event-based
- Required history length: same as event table
- Raw or derived: derived
- Cost: n/a
- Import difficulty: medium
- Confidence level: medium

### `tier1_events_due_next_3d_count`

- Purpose in USD logic: conviction adjustment for `3d from call`
- Preferred historical source: derive from historical event table
- Backup source: none needed
- Required frequency: event-based
- Required history length: same as event table
- Raw or derived: derived
- Cost: n/a
- Import difficulty: medium
- Confidence level: medium

---

## 4. Optional Parity Fields

These improve parity with the current live collector but are not required to get the first USD historical backtest running.

### `raw_de_10y_yield`

- Purpose in USD logic: context only, not a direct active Phase 1 factor
- Preferred historical source: FRED German long-term proxy
- Backup source: alternate German bond history
- Required frequency: daily
- Required history length: same as other rates
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: medium

### `raw_wti_price`

- Purpose in USD logic: parity / context only
- Preferred historical source: FRED `DCOILWTICO`
- Backup source: alternate oil history
- Required frequency: daily
- Required history length: optional
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: high

### `raw_brent_price`

- Purpose in USD logic: parity / context only
- Preferred historical source: FRED `DCOILBRENTEU`
- Backup source: alternate oil history
- Required frequency: daily
- Required history length: optional
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: high

### `raw_btc_price`

- Purpose in USD logic: parity with current payload only
- Preferred historical source: Coinbase daily BTC/USD
- Backup source: exchange daily close
- Required frequency: daily
- Required history length: optional
- Raw or derived: raw imported
- Cost: free/unclear
- Import difficulty: low
- Confidence level: medium

### `raw_eurusd_level`

- Purpose in USD logic: optional context only
- Preferred historical source: FRED `DEXUSEU`
- Backup source: FX vendor daily EURUSD
- Required frequency: daily
- Required history length: optional
- Raw or derived: raw imported
- Cost: free
- Import difficulty: low
- Confidence level: medium

---

## 5. Fields Not Required For Phase 1

These should be explicitly postponed.

### `12hr` horizon support

- Purpose in USD logic: not in Phase 1
- Preferred historical source: intraday macro / market series
- Backup source: none yet
- Required frequency: intraday
- Required history length: intraday range plus warm-up
- Raw or derived: future
- Cost: unclear
- Import difficulty: high
- Confidence level: low
- Notes / risks: intentionally out of scope

### `current day` canonical horizon support

- Purpose in future canonical timeframe coverage
- Preferred historical source: intraday or same-session observation logic
- Backup source: none yet
- Required frequency: likely intraday
- Required history length: TBD
- Raw or derived: future
- Cost: unclear
- Import difficulty: high
- Confidence level: low
- Notes / risks: still needs semantic definition

### `following week`

- Purpose in future structural horizon
- Preferred historical source: same daily series as Phase 1
- Backup source: n/a
- Required frequency: daily
- Required history length: longer structural windows
- Raw or derived: future
- Cost: free/unclear
- Import difficulty: medium
- Confidence level: medium
- Notes / risks: postponed only to reduce build scope, not because data is impossible

### `following month`

- Purpose in future structural horizon
- Preferred historical source: same daily series as Phase 1
- Backup source: n/a
- Required frequency: daily
- Required history length: at least 20-40 trading days warm-up
- Raw or derived: future
- Cost: free/unclear
- Import difficulty: medium
- Confidence level: medium
- Notes / risks: postponed only to reduce build scope

---

## Quickest Viable Path

To get a first USD historical backtest running quickly, use:

1. FRED for:
   - `raw_us_2y_yield`
   - `raw_us_10y_yield`
   - `raw_us_10y_real_yield`
   - `raw_vix_level`
   - `raw_dxy_level` as the Phase 1 proxy
2. Bundesbank or a curated CSV for:
   - `raw_de_2y_yield`
3. A simple daily gold proxy for:
   - `raw_gold_price`
4. QQQ daily close for:
   - `raw_nq_price`
5. A curated USD macro events CSV for:
   - `historical_economic_events`

That is enough to reconstruct most of the USD logic with documented approximations.

---

## Recommended First Data Sources To Import

Import first:

1. FRED `DGS2`
2. FRED `DFII10`
3. FRED `VIXCLS`
4. FRED `DTWEXBGS`
5. Germany 2Y historical source
6. Gold daily price source
7. QQQ daily close
8. Curated historical USD economic events CSV

Optional later:

9. FRED `DGS10`
10. FRED German long-term proxy
11. WTI / Brent / EURUSD / BTC parity fields

---

## Minimum Viable Field Set

Minimum viable raw imports:

- `raw_us_2y_yield`
- `raw_us_10y_real_yield`
- `raw_vix_level`
- `raw_dxy_level`
- `raw_de_2y_yield`
- `raw_gold_price`
- `raw_nq_price`
- historical USD event rows with `actual`, `forecast`, `previous`, `impact`, `event_time`

Minimum viable derived fields:

- `us_2y_d5_bps`
- `us_2y_d20_bps`
- `us_10y_real_yield_d5_bps`
- `us_10y_real_yield_d20_bps`
- `vix_d1`
- `vix_d5`
- `dxy_d1`
- `dxy_d5`
- `dxy_d20`
- `gold_d1_pct`
- `gold_d5_pct`
- `gold_d20_pct`
- `nq_d1_pct`
- `nq_d5_pct`
- `nq_d20_pct`
- `us_de_2y_spread`
- `us_de_2y_spread_d5_bps`
- `equities_regime`
- `latest_us_event`
- `fed_bias`
- `upcoming_events`

---

## Fields To Postpone

Postpone first:

- `raw_de_10y_yield`
- `raw_us_10y_yield`
- `raw_wti_price`
- `raw_brent_price`
- `raw_btc_price`
- `raw_eurusd_level`
- any `12hr` support
- any `current day` support
- parity-only raw payload extras not used by active Phase 1 USD factors

---

## Risks That Could Distort Accuracy

Highest risks:

1. DXY proxy mismatch
   - `DTWEXBGS` is not classic ICE DXY
   - could materially affect Factor 5 and tiebreak behavior

2. Germany 2Y availability / quality
   - if inconsistent, Factor 3 becomes unreliable
   - this is a major USD accuracy risk

3. Historical event quality
   - release timestamps, actual/forecast values, and impact labels must be correct
   - poor event data will distort Factor 7 and `fed_bias`

4. Gold proxy mismatch
   - GLD / GC / spot differences may slightly distort Factor 6

5. Observation-timestamp convention
   - daily close vs fixed ET decision time must be chosen consistently
   - otherwise “future” and “past” data windows may leak or misalign

6. Warm-up insufficiency
   - no 20-day warm-up means current-week/current-month reconstruction will be degraded

---

## Exact Next Implementation Step

After this plan, the next implementation step should be:

1. create the acquisition-tracking doc-backed source manifest plan for the minimum viable sources
2. create the generic raw warehouse SQL tables
3. import only the minimum viable USD raw series and curated event CSV
4. then build the USD historical snapshot population logic

Do not build verdict replay before the minimum viable raw source set exists.
