# Historical Data Inventory

Last updated: 2026-06-22

## Executive Summary

Phase 3A is a warehouse-completion phase.

Replay, outcome evaluation, research SQL, and the dashboard are not currently the bottleneck.

The current bottleneck is incomplete historical data coverage in the USD warehouse.

At the moment, only `de_2y_yield` is complete through the target period.

The target for this document is replay-complete USD warehouse coverage through:

- `2024-12-31`

## Purpose

This document is the source of truth for USD historical warehouse completeness.

The target is replay-complete USD coverage through:

- `2024-12-31`

## Replay-Complete Definition

A USD historical warehouse is replay-complete when every raw and derived input required by the production USD Layer 1 replay can be built continuously across the target replay period.

That includes:

- raw macro inputs
- price proxy inputs
- economic event inputs
- derived snapshot fields
- benchmark fields needed for evaluation

Operationally, replay-complete means:

- every production USD Layer 1 input required by the current `/logic` document
- every raw warehouse series required to derive those inputs
- every existing derived USD snapshot field consumed by the replay engine

must have continuous historical coverage across the replay period.

## Status Definitions

- `COMPLETE`: current coverage supports replay through `2024-12-31`
- `PARTIAL`: data exists but does not support replay through `2024-12-31`
- `MISSING`: required field or dependency is not currently populated
- `UNKNOWN`: requirement exists in logic, but current warehouse or replay wiring does not yet provide a reliable field

## Priority Implementation Checklist

1. Extend FRED macro series through `2024-12-31`
   - `dxy_level`
   - `vix_level`
   - `us_2y_yield`
   - `us_10y_yield`
   - `us_10y_real_yield`
2. Extend price proxies through `2024-12-31`
   - `gold_spot_usd`
   - `qqq_nq_proxy`
3. Extend USD historical events through `2024-12-31`
4. Decide how to populate or represent:
   - `fed_bias`
   - `global_growth_context`
5. Rebuild:
   - `historical_usd_market_snapshots`
6. Rerun unchanged:
   - replay
   - outcome evaluation
   - research SQL / dashboard views

## Raw Warehouse Inputs

| Production input name | Warehouse series / instrument key | Warehouse table | Source | Importer / collector path | Earliest available date | Latest available date | Row count | Target latest date | Current status | Blocker type | Notes |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `vix_level` | `vix_level` | `historical_macro_series` | FRED `VIXCLS` | `backtester/importers/fred/import_fred_macro.js` | `2024-01-02` | `2024-01-31` | 22 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Importer and source both support date ranges. Current manifest only imported January 2024. |
| `us_2y_yield` | `us_2y_yield` | `historical_macro_series` | FRED `DGS2` | `backtester/importers/fred/import_fred_macro.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core USD replay dependency. Current manifest metadata shows `last_requested_end=2024-01-31`. |
| `us_10y_yield` | `us_10y_yield` | `historical_macro_series` | FRED `DGS10` | `backtester/importers/fred/import_fred_macro.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Builder populates this raw field even though current replay factors do not score it directly. |
| `us_10y_real_yield` | `us_10y_real_yield` | `historical_macro_series` | FRED `DFII10` | `backtester/importers/fred/import_fred_macro.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core USD replay dependency for Factor 4. |
| `dxy_level` | `dxy_level` | `historical_macro_series` | FRED `DTWEXBGS` | `backtester/importers/fred/import_fred_macro.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core benchmark and Factor 5 input. Current manifest only covers January 2024. |
| `de_2y_yield` | `de_2y_yield` | `historical_macro_series` | Bundesbank daily 2Y source | `backtester/importers/germany_2y/import_germany_2y.js` | `2018-01-02` | `2024-12-30` | 1798 | `2024-12-31` | `COMPLETE` | `none` | Replay-complete through end-2024. January 2024 includes overlapping rows from a placeholder manifest and the Bundesbank manifest, but the production-quality source is already present. |
| `gold_price` | `gold_spot_usd` | `historical_price_series` | Current warehouse source is YahooFinance GLD proxy CSV | `backtester/importers/gold/import_gold_daily.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `API/source limitation` | Importer supports file, source URL, and a FRED preset, but current ingested source is only the January temp CSV. |
| `nq_price` | `qqq_nq_proxy` | `historical_price_series` | Current warehouse source is YahooFinance QQQ proxy CSV | `backtester/importers/qqq/import_qqq_daily.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `API/source limitation` | Importer supports file or source URL. Current ingested source is only the January temp CSV. |
| `latest_us_event` dependency | USD event rows | `historical_economic_events` | Forex Factory RapidAPI archive | `backtester/importers/usd_events/import_usd_events.js` | `2023-12-25` | `2024-01-31` | 107 | `2024-12-31` | `PARTIAL` | `event coverage limitation` | Current event archive covers late December 2023 through January 2024 only. |

## Derived Snapshot Inputs Used By Replay

| Production input name | Warehouse series / instrument key | Warehouse table | Source | Importer / collector path | Earliest available date | Latest available date | Row count | Target latest date | Current status | Blocker type | Notes |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `vix_d1` | derived from `vix_level` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-03` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Depends on continuous `vix_level`. |
| `vix_d5` | derived from `vix_level` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Depends on five prior valid VIX observations. |
| `us_2y_d5_bps` | derived from `us_2y_yield` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core Factor 2 input. |
| `us_2y_d20_bps` | derived from `us_2y_yield` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-31` | `2024-01-31` | 1 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Optional in logic, but useful for longer-horizon replay. |
| `us_de_2y_spread` | `us_2y_yield - de_2y_yield` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-02` | `2024-01-31` | 21 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Depends on both `us_2y_yield` and `de_2y_yield`. |
| `us_de_2y_spread_d5_bps` | five-day delta of `us_de_2y_spread` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core Factor 3 input. |
| `us_10y_real_yield_d5_bps` | derived from `us_10y_real_yield` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core Factor 4 input. |
| `us_10y_real_yield_d20_bps` | derived from `us_10y_real_yield` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-31` | `2024-01-31` | 1 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Optional in logic, but longer horizon fields require full warm-up. |
| `dxy_d1` | derived from `dxy_level` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-03` | `2024-01-31` | 20 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Depends on continuous DXY history. |
| `dxy_d5` | derived from `dxy_level` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Core Factor 5 input. |
| `dxy_d20` | derived from `dxy_level` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-31` | `2024-01-31` | 1 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Optional in logic, also required for current-week/current-month reconstructability in builder. |
| `gold_d1_pct` | derived from `gold_spot_usd` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-03` | `2024-01-31` | 20 | `2024-12-31` | `PARTIAL` | `API/source limitation` | Depends on longer gold proxy history. |
| `gold_d5_pct` | derived from `gold_spot_usd` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `API/source limitation` | Core Factor 6 input. |
| `nq_d1_pct` | derived from `qqq_nq_proxy` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-03` | `2024-01-31` | 20 | `2024-12-31` | `PARTIAL` | `API/source limitation` | Used by Factor 10. |
| `nq_d5_pct` | derived from `qqq_nq_proxy` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-09` | `2024-01-31` | 16 | `2024-12-31` | `PARTIAL` | `API/source limitation` | Used by Factor 10. |
| `equities_regime` | derived from `vix_level` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-02` | `2024-01-31` | 22 | `2024-12-31` | `PARTIAL` | `warehouse limitation` | Currently derived for all January snapshots, but cannot extend without `vix_level`. |
| `latest_us_event` | derived from `historical_economic_events` | `historical_usd_market_snapshots` | USD snapshot builder | `backtester/builders/usd/build_usd_historical_snapshots.js` | `2024-01-02` | `2024-01-31` | 22 | `2024-12-31` | `PARTIAL` | `event coverage limitation` | Core Factor 7 input. Snapshot field is populated only because January event history exists. |
| `fed_bias` | no current warehouse field populated | `historical_usd_market_snapshots` | expected to be derived from event history / regime logic | `backtester/builders/usd/build_usd_historical_snapshots.js` | none | none | 0 | `2024-12-31` | `MISSING` | `mapping/key limitation` | Replay engine consumes `fed_bias`, but the snapshot builder currently leaves it null for every row. |

## Optional Logic Inputs Not Currently Wired

These inputs are mentioned by the production logic, but the current replay path does not provide a dedicated warehouse field for them.

| Production input name | Warehouse series / instrument key | Warehouse table | Source | Importer / collector path | Earliest available date | Latest available date | Row count | Target latest date | Current status | Blocker type | Notes |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `global_growth_context` | none currently wired | none currently wired | none currently wired | none currently wired | none | none | 0 | `2024-12-31` | `UNKNOWN` | `mapping/key limitation` | Mentioned in Factor 9 as optional. Current replay engine does not populate or consume a dedicated `global_growth_context` field. |

## Blocker Classification

### Warehouse Limitation

Affected inputs:

- `dxy_level`
- `vix_level`
- `us_2y_yield`
- `us_10y_yield`
- `us_10y_real_yield`
- all deltas and warm-up fields derived from those series
- `equities_regime`

Recommended resolution path:

- extend the existing FRED macro import through `2024-12-31`
- rebuild snapshots after the raw macro extension is complete

### API / Source Limitation

Affected inputs:

- `gold_spot_usd`
- `qqq_nq_proxy`
- `gold_d1_pct`
- `gold_d5_pct`
- `nq_d1_pct`
- `nq_d5_pct`

Recommended resolution path:

- supply verified wider-history source files or source URLs
- run the existing gold and QQQ importers through `2024-12-31`
- document the chosen proxy source in manifest metadata

### Event Coverage Limitation

Affected inputs:

- USD event rows in `historical_economic_events`
- `latest_us_event`
- event-driven contextual replay state

Recommended resolution path:

- extend the existing USD events importer in bounded resumable date ranges
- continue through `2024-12-31`
- rebuild snapshots once the event archive is continuous

### Mapping / Key Limitation

Affected inputs:

- `fed_bias`
- `global_growth_context`

Recommended resolution path:

- decide how `fed_bias` should be derived or represented in the snapshot builder
- decide whether `global_growth_context` should remain optional or gain a concrete replay field
- do this after the raw warehouse coverage is extended, but before treating the warehouse as replay-complete

### Scheduler Limitation

Affected inputs:

- USD historical economic events

Recommended resolution path:

- use resumable bounded event-import runs instead of one oversized request window
- preserve request budgets and resume dates in manifest metadata
- chunk imports until the warehouse reaches `2024-12-31`

## Snapshot Coverage Summary

Current `historical_usd_market_snapshots` coverage:

- earliest snapshot: `2024-01-02`
- latest snapshot: `2024-01-31`
- snapshot rows: `22`
- `market_data_coverage_status = collected`: `21`
- `market_data_coverage_status = partial`: `1`
- `event_coverage_status = collected`: `22`
- `equities_regime` populated: `22`
- `latest_us_event` populated: `22`
- `fed_bias` populated: `0`
- reconstructable `following 24hrs`: `16`
- reconstructable `3d from call`: `16`
- reconstructable `current week`: `1`
- reconstructable `current month`: `1`

This confirms that the warehouse blocker is not only the raw series end date. It also affects derived warm-up fields and the longer-horizon snapshot flags.

## Collector Audit And Extension Mapping

| Input group | Importer exists | Path | Supports date ranges | Current warehouse reason for short coverage | Source likely supports wider history | Likely extension command |
| --- | --- | --- | --- | --- | --- | --- |
| FRED macro series: `dxy_level`, `vix_level`, `us_2y_yield`, `us_10y_yield`, `us_10y_real_yield` | yes | `backtester/importers/fred/import_fred_macro.js` | yes | Current manifest metadata shows `last_requested_start=2024-01-02` and `last_requested_end=2024-01-31` only. | yes | `node backtester/importers/fred/import_fred_macro.js --start=2024-02-01 --end=2024-12-31` |
| Germany 2Y | yes | `backtester/importers/germany_2y/import_germany_2y.js` | yes | Already complete through end-2024. | yes | no extension required for warehouse completeness |
| Gold proxy | yes | `backtester/importers/gold/import_gold_daily.js` | yes | Current manifest points to `backtester/tmp/gold_daily.csv`, which only contains January 2024. | maybe, but current workspace has no wider verified automated source staged | `node backtester/importers/gold/import_gold_daily.js --file=path/to/gold_daily_full.csv --vendor-name=YahooFinance --vendor-symbol=GLD --proxy-label=gld_etf_proxy --start=2024-02-01 --end=2024-12-31` |
| QQQ / NQ proxy | yes | `backtester/importers/qqq/import_qqq_daily.js` | yes | Current manifest points to `backtester/tmp/qqq_daily.csv`, which only contains January 2024. | yes, if a wider file or source URL is supplied | `node backtester/importers/qqq/import_qqq_daily.js --file=path/to/qqq_daily_full.csv --vendor-name=YahooFinance --vendor-symbol=QQQ --start=2024-02-01 --end=2024-12-31` |
| USD historical economic events | yes | `backtester/importers/usd_events/import_usd_events.js` | yes | Current manifest ends at `2024-01-31`; import used `38` requested dates and a request budget of `250`. | likely yes, but bounded by per-run request budget and source reliability | `node backtester/importers/usd_events/import_usd_events.js --start=2024-02-01 --end=2024-04-30 --max-requests=120` then resume in additional bounded chunks through `2024-12-31` |

## Do Not Do Yet

Do not:

- add new research metrics
- optimise Layer 1
- change `/logic`
- change production confidence or strength logic
- redesign the replay engine
- redesign the dashboard
- start factor-value analysis before warehouse coverage is complete

## Fastest Path To Replay-Complete Coverage

This plan is ordered by the fastest path to replay-complete USD coverage through `2024-12-31`.

### 1. Extend FRED Macro Series First

Priority series:

- `dxy_level`
- `vix_level`
- `us_2y_yield`
- `us_10y_yield`
- `us_10y_real_yield`

Reason:

- these are core replay dependencies
- the importer already exists
- the source already supports date ranges
- the current limitation is warehouse completeness, not architecture

Likely command:

```powershell
node backtester/importers/fred/import_fred_macro.js --start=2024-02-01 --end=2024-12-31
```

### 2. Extend Price Proxies

Priority instruments:

- `gold_spot_usd`
- `qqq_nq_proxy`

Reason:

- the importers already exist
- replay requires these fields for Factor 6 and Factor 10
- the current warehouse only contains January 2024 temp-file imports

Likely commands:

```powershell
node backtester/importers/gold/import_gold_daily.js --file=path/to/gold_daily_full.csv --vendor-name=YahooFinance --vendor-symbol=GLD --proxy-label=gld_etf_proxy --start=2024-02-01 --end=2024-12-31
node backtester/importers/qqq/import_qqq_daily.js --file=path/to/qqq_daily_full.csv --vendor-name=YahooFinance --vendor-symbol=QQQ --start=2024-02-01 --end=2024-12-31
```

### 3. Extend USD Historical Economic Events

Reason:

- Factor 7 depends on `latest_us_event`
- `fed_bias` should be derived from event-aware historical context
- the importer already supports bounded date-range imports

Important constraint:

- the importer is budgeted per requested day
- a full February-to-December 2024 run should be chunked into resumable ranges instead of one oversized request

Likely first command:

```powershell
node backtester/importers/usd_events/import_usd_events.js --start=2024-02-01 --end=2024-04-30 --max-requests=120
```

Then continue with the next bounded ranges until `2024-12-31`.

### 4. Rebuild USD Historical Snapshots

After raw warehouse coverage is complete:

```powershell
node backtester/builders/usd/build_usd_historical_snapshots.js --start=2024-01-01 --end=2024-12-31
```

### 5. Rerun Replay And Evaluation Unchanged

Do not change replay logic.

Do not change production logic.

Run:

```powershell
node backtester/replay/usd/run_usd_historical_replay.js --start=2024-01-01 --end=2024-12-31
node backtester/scripts/run_prediction_outcome_evaluations.js --start=2024-01-01 --end=2024-12-31
```

### 6. Recheck The Frozen Research Framework

After the warehouse is complete and the replay is rerun:

- directional accuracy
- timeframe accuracy
- verdict quality
- confidence calibration
- trade quality

should all be validated again over the larger evidence base without adding new metrics.

## Current Bottom Line

The replay engine is not the limiting factor.

The warehouse is the limiting factor.

At the moment, the only USD dependency that is replay-complete through end-2024 is:

- `de_2y_yield`

Everything else required for a continuous USD replay through `2024-12-31` is still partial, missing, or unknown.

## Next Codex Implementation Prompt

Use this prompt to start the next implementation session:

> Continue from the current Phase 3A warehouse audit.
>
> Do not add new research metrics.
>
> Do not change `/logic`.
>
> The next task is implementation, not further documentation.
>
> Objective:
>
> Make the USD historical warehouse replay-complete through `2024-12-31`.
>
> Execute in this order:
>
> 1. Extend the FRED macro importer coverage through `2024-12-31` for:
>    - `dxy_level`
>    - `vix_level`
>    - `us_2y_yield`
>    - `us_10y_yield`
>    - `us_10y_real_yield`
> 2. Extend price proxies through `2024-12-31` for:
>    - `gold_spot_usd`
>    - `qqq_nq_proxy`
> 3. Extend USD historical events through `2024-12-31`
> 4. Decide and implement how `fed_bias` should be populated for replay
> 5. Rebuild `historical_usd_market_snapshots`
> 6. Rerun replay and outcome evaluation unchanged
>
> Keep production isolated.
>
> Do not optimise Layer 1.
>
> Do not redesign replay.
>
> Do not change the research framework.
