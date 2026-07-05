# Changelog

## 2026-07-05

### Added

- Added `backtester/scripts/analyze_l2l_directional_edge.js`, a downstream-only reliability audit that recomputes guaranteed directional moves in BOTH directions for every evaluated L2L row and tests the model against no-skill baselines. Key result: the ~70% L2L Move win rates are volatility base rate, not directional skill (both directions reach L2L on ~52-54% of days; no Layer 1 asset beats its call-frequency-matched null; decisive-day accuracy is ≈ coin flip for all Layer 1 assets). Real directional edges found elsewhere: BTC close-to-close 61.1% vs 50.0% drift-matched null (z=4.89), Gold close-to-close 56.7% vs 49.8% (z=2.70), and NQ/USD Layer 2 decisive-day accuracy 62.5% (z=2.74) — all stable across 2024/2025/2026. Confidence buckets do not calibrate to outcomes anywhere. Full findings in `docs/L2L_RELIABILITY_FINDINGS.md`; no artifacts, semantics, or dashboard behavior changed.

### Changed

- Upgraded the L2L research definition once more, from range availability to **L2L Move**: a call wins when price made a complete move of at least the L2L distance in the call direction at some point during the trading day, verified from 1-hour candles. A midday swing counts even if the day trends the other way before and after it; sub-L2L swings never count. Moves are computed as guaranteed lower bounds (within-hour sequence never assumed: only high-open / close-low upswings, open-low / high-close downswings, and earlier-low-to-later-high cross-candle swings are credited), so wins are proven and misses are worst-case.
- Staged 1-hour candle caches: OANDA H1 for EUR_USD (16,605 rows), XAU_USD (15,788), NAS100_USD (15,744) and Binance 1h BTCUSDT klines (23,459), 2023-11-01 onward. Both importers now take `--granularity=H1` / `--interval=1h`.
- Per-row diagnostics now include `maxDirectionalMove`, `moveAchieved`, `moveMargin`, `hourlyCandleCount`, and intraday extremes; day-range availability is retained per row as context (a win requires it, but it is not sufficient). New diagnostics count days with missing or insufficient hourly coverage.
- Dashboard wording renamed to "L2L Move Research" with explicit 1-hour verification copy; smoke test expectations updated, and its console-error check now tolerates only ancillary 5xx resource failures (a shared Supabase research view, `research_best_factor_combinations`, currently times out server-side with Postgres 57014 — this affects both dashboards and is tracked separately).
- Corrected the L2L research definition from open-anchored target touch to **L2L Range Available**: `available_range = high - low`; a call counts as available when the day's range is at least the L2L distance (50% of rolling ADR20). The call direction only categorizes rows; the range calculation is identical for bullish/long and bearish/short. The open is diagnostic context only and the close is irrelevant. Results are labelled "L2L Range Available", never guaranteed executed, because daily OHLC confirms range availability, not intraday sequence.
- Replaced `backtester/lib/adr_reach_logic.js` with `backtester/lib/l2l_range_logic.js` and rewrote the synthetic tests (`backtester/tests/l2l_range_logic.test.js`): high 105 / low 100 / L2L 5 = available, high 104.99 = not available, both directions win on the same range, close and open never affect the result.
- Staged account-verified OANDA v20 daily OHLC caches (live account, mid candles, UTC alignment) for `EUR_USD`, `XAU_USD`, and `NAS100_USD` under `backtester/cache/ohlc/`. Gold ADR/L2L research is now AVAILABLE for the first time, the QQQ proxy for NQ is retired in favor of real NAS100_USD data, and EUR switched from Alpha Vantage to OANDA. Sunday stub candles from UTC alignment are dropped at load and counted (`weekendRowsDropped`).
- Regenerated `data/adr-reach-research.json` with per-row diagnostics for every evaluated call and tradable pair signal (date, asset/pair, layer, call direction, strength bucket, OHLC source/instrument, OHLC values, day_range, L2L distance, range_available, range_margin).
- Renamed all dashboard wording from "ADR Reach" to "L2L Range Research" / "L2L Range Available" with the caveat copy: "This measures whether the day's high-low range was large enough to contain the L2L move in the call direction. Daily OHLC cannot prove execution sequence." Smoke-test expectations updated, including Gold/XAU_USD now asserting as available.
- Fixed the OANDA importer to cap the candles `to` parameter at now (the API rejects future timestamps).
- JSON artifact keys (`adrReachWins`, `adrReachWinPct`, data attributes, subtab id) intentionally keep their legacy names for renderer compatibility; all user-facing wording is L2L Range Available.

## 2026-07-04

### Added

- Added `backtester/lib/adr_reach_logic.js` as the single source of truth for ADR/L2L intraday reach semantics: win means the day's high (bullish/long) or low (bearish/short) touched `open +/- L2L distance` at any point inside the evaluation day, with the close explicitly ignored and non-directional calls counted as no-trade instead of losses.
- Added `backtester/importers/binance/download_btcusdt_daily_ohlc_binance.js` (Binance Spot `GET /api/v3/klines`, `symbol=BTCUSDT`, `interval=1d`, startTime/endTime pagination) and staged a tracked cache at `backtester/cache/ohlc/btcusdt_daily_binance.csv` covering 2023-11-01..2026-07-04.
- Added `backtester/importers/oanda/download_oanda_daily_ohlc.js` (OANDA v20 candles, mid daily, `--list-instruments` account verification, configurable UTC vs NY-17:00 alignment) plus a README; it stages tracked caches for `EUR_USD`, `XAU_USD`, and `NAS100_USD` once `OANDA_API_TOKEN` is provided.
- Added `backtester/tests/adr_reach_logic.test.js`: unit tests pinning the exact win/miss boundaries (bullish open 100 / high 106 / L2L 5 = win, high 104.9 = miss; bearish low 94 = win, low 95.1 = miss; close never changes a touched outcome) and contract tests proving the artifact groups results by Layer 1 asset, Layer 2 pair, and strength bucket, and matches the builder byte-for-byte.

### Changed

- Rebuilt `backtester/scripts/validate_adr_reach_research.js` around the shared reach lib with source-priority lists per asset: OANDA caches always outrank fallbacks (Alpha Vantage EUR/USD, QQQ proxy for NQ now explicitly labeled as proxy, Coinbase BTC legacy), so coverage upgrades automatically when account-verified OANDA data is staged.
- Reference price is now strictly the call day's open; the previous-close fallback was removed and rows without a same-day open are excluded and reported in diagnostics.
- Switched BTC ADR reach OHLC from Coinbase BTC-USD to Binance BTCUSDT (user-traded instrument); 794 evaluated calls unchanged, one win/loss flip from the range differences.
- Regenerated `data/adr-reach-research.json` with per-asset/per-pair diagnostics (missing OHLC rows, missing L2L-distance rows, no-trade rows, unsupported instruments) published in `meta.diagnostics`, plus explicit `win_definition` and `l2l_definition` strings.
- Updated the ADR source-audit UI copy and smoke-test expectations to the strict-open policy and new source labels; incomplete (still-forming) candles and weekend rows for weekday-only markets are filtered at load and counted in the source audit.
- Gold `XAU/USD` and `USD` remain explicitly unavailable; Gold now unlocks by staging the OANDA `XAU_USD` cache and rebuilding, rather than requiring new code.

## 2026-07-03

### Added

- Added a new `ADR Reach Research` Backtest / Accuracy sub-tab driven by a checked-in downstream artifact in `data/adr-reach-research.json`.
- Added `backtester/scripts/validate_adr_reach_research.js` to audit supportable OHLC coverage, build the ADR reach artifact, and validate ADR20 windowing, no-lookahead behavior, threshold calculation, weekday reconciliation, and checker invariants.
- Added `backtester/importers/eurusd/download_eurusd_daily_ohlc_alpha_vantage.js` to download deterministic repo-local `EUR/USD` daily OHLC coverage from Alpha Vantage `FX_DAILY`.
- Added `backtester/importers/btc/download_btcusd_daily_ohlc_coinbase.js` to download deterministic repo-local `BTC/USD` daily OHLC coverage from Coinbase Exchange candles.

### Changed

- Kept the new ADR module fully downstream of replay, checker, confidence, and Pair Trade Research logic.
- Implemented ADR reach using the existing repo-local `QQQ` OHLC proxy file for `NQ`, with evaluation-day `Open` as the reference price and previous-close fallback logic preserved for future supportable OHLC feeds.
- Expanded ADR reach support onto `EUR`, `BTC`, `EUR/USD`, and `BTC/USD` using the new repo-local OHLC sources, while keeping `Gold`, `XAU/USD`, and `USD` unavailable until supportable true `XAU/USD` and `DXY` OHLC sources exist.
- Tightened ADR validation so non-BTC assets cannot silently pick up weekend OHLC rows and BTC must preserve weekend calendar handling.
- Expanded the local dashboard smoke script so the new ADR Reach Research tab verifies summary tables, confidence tables, day totals, weekday tables, and console-clean rendering.

## 2026-07-02

### Added

- Added a `Weekday Breakdown` Backtest / Accuracy tab that shows day-of-week performance by displayed headline confidence bucket for USD, EUR, Gold, NQ, and BTC without changing the existing matrices or checker views.
- Added `backtester/scripts/validate_weekday_breakdown.js` to reconcile weekday totals and confidence-bucket totals back to each canonical checker artifact, while enforcing weekday coverage rules for BTC vs non-BTC assets.
- Added flat-aware weekday cells that show ex-flat directional win rate plus `W / L / F / T` counts, including `Flat only` handling when a bucket or weekday has no directional rows.
- Added a `Day Totals` row/table above each asset's confidence-bucket weekday table so users can scan weekday performance before drilling into confidence buckets.
- Added a new `Pair Trade Research` Backtest / Accuracy sub-tab for EUR/USD, XAU/USD, NQ/USD, and BTC/USD using same-date target + USD checker rows.
- Added `backtester/scripts/validate_layer2_pairing_analysis.js` to validate pair-trade coverage, accuracy, combined-confidence buckets, day totals, weekday breakdowns, and conflict/no-trade summaries.

### Changed

- Derived the weekday breakdown directly from the existing deterministic checker artifacts so the dashboard uses stored displayed headline confidence and stored evaluation outcomes instead of recalculating confidence or altering replay/checker semantics.
- Expanded the local Playwright dashboard smoke script to cover the new weekday breakdown tab, verify weekday columns by asset, and keep the Backtest / Accuracy panel free of console errors during the smoke path.
- Updated the weekday breakdown so flats are separated from directional wins and losses the same way the main accuracy matrices treat flat outcomes.
- Extended the weekday validator to verify bucket-to-weekday reconciliation, flat-rate calculations, ex-flat win-rate calculations, and the new day-level totals.
- Added pair-trade research coverage, accuracy, confidence-bucket, day-total, weekday, and conflict/no-trade views without changing Layer 1 replay outputs, checker semantics, flat bands, or headline confidence logic.
- Used combined pair confidence as `min(target headline confidence, USD headline confidence)` and treated same-direction or missing-USD setups as non-trade research outcomes rather than live Layer 2 logic.
- Refined the Pair Trade Research UI so the per-pair KPI cards use the same responsive dashboard grid language as the rest of the dashboard and the confidence-bucket table spacing no longer crushes right-hand percentage columns.
- Replaced the original wide Layer 2 top-summary table with a compact comparison layout, then clarified its terminology so `Trade Days %` and `Strong+ Trade Days %` are defined against matched historical days instead of the broader paired-row count.
- Re-ran lightweight syntax checks, the pair-trade validator, and browser smoke at session close to confirm the current research platform remains stable after the Pair Trade Research UI refinements.

## 2026-06-29

### Added

- Added EUR replay core, historical snapshot builder, historical replay runner, parity fixture, parity script, EURUSD importer, EUR evaluation script, EUR checker builder, and EUR checker artifact.
- Added dashboard support for the EUR 24H matrix and EUR checker alongside the existing USD research views.
- Added linked-warehouse test locking so the Node smoke tests no longer race each other against shared Supabase-backed tables.

### Changed

- Reproduced the live EUR 24H deterministic workflow exactly in replay using the current `exports/eur_layer1_agent.json` node semantics rather than the generic markdown weight table where they differ.
- Generated EUR historical replay coverage for `2024-01-02` through `2026-04-30` where warehouse data allows.
- Unblocked EUR outcome evaluation by importing historical EURUSD series and evaluating EUR primarily against direct EUR/USD movement instead of any USD-style DXY benchmark.
- Set the provisional EUR-only 24H flat band to `0.15` for EUR evaluation and checker generation without changing shared USD evaluation defaults.
- Generated a passing EUR checker artifact with result `602 / 0 / 0 / 0`.
- Updated the linked-warehouse tests to validate stable research invariants instead of brittle global row-count assumptions.

## 2026-06-22

### Added

- Added `docs/CORE_RESEARCH_PHILOSOPHY.md` as the authoritative guiding document for research/backtesting principles.
- Added `docs/PHASE3_HISTORICAL_EXPANSION_REPORT.md` to record the first USD historical expansion attempt and its evidence summary.
- Added `docs/PHASE3_HISTORICAL_WEAKNESSES.md` to capture warehouse and evaluator issues discovered during Phase 3 evidence collection.
- Added `docs/HISTORICAL_DATA_INVENTORY.md` as the warehouse-completeness source of truth for USD replay inputs through end-2024.

### Changed

- Updated backtester and project-memory documentation to reference the new core research philosophy and reinforce that measurement comes before optimization.
- Corrected stale hosting references where documentation still conflicted with the current GitHub Pages deployment model.
- Corrected the historical evaluator so missing or zero close prices are now treated as `NOT_EVALUABLE` instead of false `-100%` benchmark wins.
- Attempted expansion of the USD replay window to `2024-05-31`, confirmed the frozen research framework still runs end-to-end, and documented that the warehouse currently only supports the continuous January 2024 USD window.
- Shifted Phase 3A focus onto historical warehouse completion planning instead of replay or metric changes.

## 2026-06-21

### Changed

- Updated the live `Eco Events Collector` workflow to remove the duplicate-insert failure against `economic_events`.
- Replaced the previous direct Supabase write with idempotent routing: dedupe incoming events, look up existing rows for the run date, update matching rows, and create only unmatched rows.
- Validated the live collector with two immediate reruns; executions `1081` and `1082` both succeeded with no `economic_events_event_date_currency_event_name_event_time_t_key` error.
- Re-exported the updated live workflow into `exports/eco_events_collector.json`.

## 2026-06-19

### Added

- Confirmed GitHub repository access for `kevincreedycars-debug/trading-agent-dashboard`.
- Added project memory documentation scaffold.
- Added `docs/CURRENT_STATE.md`.
- Added `docs/CURRENT_TASK.md`.
- Added `docs/NEXT_STEPS.md`.
- Added `docs/ARCHITECTURE.md`.
- Added `docs/N8N_INTEGRATION.md`.
- Added `CODEX.md`.
- Added read-only n8n MCP server scaffold in `mcp-n8n/`.
- Added MCP tools for listing workflows, fetching workflows, listing executions, and fetching executions.

### Current Focus

- Build AI-assisted development environment.
- Connect ChatGPT/Codex to GitHub and n8n.
- Reduce manual copy/paste of workflow JSON and node code.
- Keep first n8n MCP version read-only until exports exist.

### Known Issues

- Eco Events Collector duplicate insert failure.
- EUR Agent parser must support OpenAI JSON Object output.
- Master Orchestrator needs final execution summary.

## 2026-06-20

### Added

- Exported live n8n workflow JSON snapshots into `exports/`.
- Added dashboard Master Orchestrator control panel.
- Added `data/workflow-control.json` for non-secret dashboard trigger configuration.
- Added `data/workflow-status.json` for published run status and error reporting.
- Added dashboard rendering for workflow status, step reports, and error reports.
- Added `CODEX_STARTUP.md` as the permanent Codex working-memory startup guide.
- Added `docs/SESSION_NOTES.md` for latest-session handoff notes.
- Added `docs/PROJECT_HISTORY.md` for concise high-level project milestones.

### Pending

- Verify an end-to-end dashboard-triggered run.
- Refine status reporting if n8n child workflow error payloads need richer parsing.

### Changed

- Added a production Webhook Trigger to the live Master Orchestrator.
- Published the Master Orchestrator and referenced child workflows.
- Configured `data/workflow-control.json` with the production webhook URL.
- Added Master Orchestrator status publishing to `data/workflow-status.json`.
- Added visual-only Backtest / Accuracy dashboard tab using placeholder mock data.
- Added static `data/backtest.json` placeholder for agent accuracy and variable correlation UI scaffolding.
- Updated `CODEX.md` and project memory docs to require Codex to read memory first, summarise state, and update only changed memory documents at session end.
- Expanded the permanent memory process with startup summaries, milestone updates, session close notes, commit/push expectations, and canonical memory file locations.
- Updated `CODEX_STARTUP.md` to require continuous documentation updates, logical milestone commits, and startup recovery from repository memory.
- Added `docs/ACTIVE_MILESTONE.md` as the live checkpoint for the current feature and updated startup rules to read it after `docs/CURRENT_TASK.md`.
- Refined `CODEX_STARTUP.md` to use smart staged startup, concise startup summaries, runtime validation against repository evidence, documentation-drift handling, and stricter session close rules.
- Updated supporting documentation to point startup behavior at `CODEX_STARTUP.md` and use `docs/SESSION_NOTES.md` for current session memory.
- Reworked the dashboard to display a derived confidence score as the headline call metric while preserving Bull Case, Bear Case, Net Edge, and Participation as separate diagnostics.
- Added a compact Overview definitions legend beneath the Layer 1 calls.
- Replaced the shared dashboard card top strip gradient with a single navy strip.
- Added shared Layer 1 dashboard normalization so confidence and a 7-day direction outlook are derived reliably from the latest loaded timeframe calls.
- Added an Overview 7-day direction outlook section and updated the current `data/layer1.json` snapshot to carry `confidence` and `seven_day_outlook`.
- Confirmed the public static host is GitHub Pages and that the earlier local confidence commit had not yet been pushed when deployment was checked.
