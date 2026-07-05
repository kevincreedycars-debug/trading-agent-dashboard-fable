# Session Notes

Last updated: 2026-07-05

## Work Completed

- **Shipped the L2L Trade Gate and Directional Call Trust dashboard tabs (2026-07-05, later session).** New builder `backtester/scripts/build_l2l_trade_gate.js` writes `data/l2l-trade-gate.json` downstream of the ADR artifact + hourly caches (self-checks against stored outcomes, 0 mismatches). New sub-tabs under Backtest / Accuracy: (1) L2L Trade Gate — hit rates at 50/55/60% of ADR20 per Layer 1 call type (leans separated) and Layer 2 signal side, each vs the any-day same-direction base rate with edge; confidence-bucket check across all 8 groups; trust summary with the user's rule (hit@55 > 60% ⇒ trusted; 21/24 pass — fails: EUR bullish lean, Gold clear bearish, XAU/USD sell). (2) Directional Call Trust — close-direction checker accuracy per call type (L2 joined via predictionId to target checker verdicts); same rule (10/24 pass: Gold bullish clear+lean, BTC bullish clear / bearish clear+lean, XAU/USD both sides, NQ/USD buy, BTC/USD both sides). Both tabs state that confidence/strength is currently unreliable. Validation: `node --check` clean, smoke PASS (extended to both tabs), backtester tests 39/39 excluding the pre-existing Supabase-linked failure. No live Layer 1/Layer 2 logic touched.

- **Reliability audit of the ~70% L2L Move rates (2026-07-05, later session).** Added `backtester/scripts/analyze_l2l_directional_edge.js` (downstream-only; reads the artifact + hourly caches, recomputes both-direction moves with 0 mismatches vs stored outcomes). Verdict: the ~70% is daily-volatility base rate — both directions reach L2L on ~52-54% of days, no Layer 1 asset beats a call-frequency-matched no-skill null, and on direction-decisive days Layer 1 accuracy is ≈ coin flip (EUR 46.5%, GOLD 48.0%, NQ 53.0%, BTC 46.2%). Real, stable directional edges found instead: **BTC close-to-close 61.1%** vs 50.0% drift null (z=4.89, p<0.0001), **Gold close-to-close 56.7%** (z=2.70, p=0.007), **NQ/USD Layer 2 decisive-day 62.5%** (z=2.74, p=0.006); BTC/USD suggestive (69%, n=29). EUR and NQ Layer 1 show no edge on any lens; confidence buckets do not calibrate (VERY_STRONG often worst). Full write-up: `docs/L2L_RELIABILITY_FINDINGS.md`. Proposed (NOT yet implemented, needs user sign-off): show no-skill baselines + decisive-day accuracy in the L2L dashboard tab, flag no-edge signals, recalibrate confidence.

- Upgraded L2L research to **L2L Move** (1H-verified directional swings: bullish = guaranteed upswing >= L2L during the day, bearish mirrored; conservative within-hour handling). Layer 1 move rates: EUR 72.0%, Gold 73.2%, NQ 73.3%, BTC 66.9%. Hourly caches staged from OANDA (EUR_USD/XAU_USD/NAS100_USD H1) and Binance (BTCUSDT 1h).
- Known upstream issue: Supabase view `research_best_factor_combinations` returns 500 (statement timeout 57014) on every dashboard load, affecting both the original and clone dashboards; the affected panel degrades gracefully and the smoke test now ignores only that class of ancillary 5xx console noise.
- Corrected the L2L research definition to **L2L Range Available** (day high-low range >= L2L distance; direction categorizes only; open diagnostic-only; close irrelevant; labelled availability, not execution) in `backtester/lib/l2l_range_logic.js` with full synthetic test coverage.
- Staged OANDA v20 live-account daily OHLC for `EUR_USD`, `XAU_USD`, `NAS100_USD` (2023-11-01..2026-07-03, UTC-aligned mid candles) — Gold unlocked for the first time, QQQ proxy retired, EUR moved off Alpha Vantage. BTC stays on Binance BTCUSDT.
- Regenerated the artifact with per-row diagnostics; renamed all dashboard wording to L2L Range Research/Available; updated smoke expectations. Layer 1 availability: EUR 94.3%, Gold 93.4%, NQ 89.7%, BTC 84.9%; USD remains unavailable (no supportable USD-index OHLC in the OANDA account).
- Validation: `node --check script.js` clean, backtester suite 33/34 (pre-existing Supabase-linked failure only), Playwright smoke PASS, artifact validator PASS. No live Layer 1 / Layer 2 trading logic touched.

- Fixed the ADR/L2L reach definition end-to-end: reach is intraday touch of `open +/- L2L distance` against the day's high/low, close ignored, strict day-open entry (previous-close fallback removed), no-trade rows separated from losses.
- Extracted the semantics into `backtester/lib/adr_reach_logic.js` and covered them with unit + contract tests (`backtester/tests/adr_reach_logic.test.js`), including a guard against `Number(null) === 0` silently turning a missing open into an entry price of 0.
- Added OANDA v20 and Binance importers with tracked caches under `backtester/cache/ohlc/`; BTC now evaluates against Binance BTCUSDT klines. OANDA `EUR_USD`/`XAU_USD`/`NAS100_USD` downloads are ready but blocked on `OANDA_API_TOKEN` (no credential exists in this environment); the builder auto-prefers those caches once staged, which also unlocks Gold.
- Regenerated `data/adr-reach-research.json` with diagnostics; EUR and NQ results are unchanged vs the prior artifact (their sources already had opens everywhere), BTC shifted by exactly one row due to the instrument switch.
- Validation: `node --check script.js` clean, backtester suite 31/32 (the single failure is the pre-existing Supabase-linked `evaluation_pipeline` test, which requires `supabase link` and is unrelated), Playwright dashboard smoke PASS, ADR validator PASS.
- No live Layer 1 / Layer 2 trading logic was touched; all changes are backtester/research, dashboard research rendering copy, and test infrastructure.

- Confirmed the full Layer 1 historical replay rollout is already validated across USD, EUR, Gold, NQ, and BTC.
- Added a new `Weekday Breakdown` Backtest / Accuracy sub-tab so the main research area stays compact.
- Derived the weekday-by-confidence breakdown directly from the existing deterministic checker artifacts instead of generating new replay outputs or recalculating confidence.
- Used stored displayed headline confidence to bucket rows into Weak `0-49`, Moderate `50-64`, Strong `65-79`, and Very Strong `80-100`.
- Included all checker rows in the weekday totals, including `NO_CALL` and `NOT_EVALUABLE`, so per-asset weekday totals reconcile exactly back to the checker artifact row counts.
- Added `backtester/scripts/validate_weekday_breakdown.js` and confirmed reconciliation passes for USD `604`, EUR `602`, Gold `608`, NQ `604`, and BTC `850`.
- Expanded the local Playwright smoke script to verify the existing matrices, existing checker views, and the new weekday breakdown tab with correct weekday columns by asset.
- Re-ran validation successfully: syntax checks, five checker validators, weekday reconciliation validator, and browser smoke all pass.
- Updated Weekday Breakdown cells so flats are separated from directional wins/losses and the displayed rate is ex-flat only.
- Added a `Day Totals` table above each asset's confidence-bucket table, with ex-flat rate, `W / L / F / T`, and flat rate for each weekday plus the all-days total.
- Extended the weekday validator to prove day totals equal the sum of bucket rows for each weekday and still reconcile back to the checker row counts.
- Committed and pushed the flat-aware weekday breakdown follow-ups to `origin/main`.
- Added a new `Pair Trade Research` Backtest / Accuracy sub-tab for EUR/USD, XAU/USD, NQ/USD, and BTC/USD.
- Built pair-trade research entirely from same-date target + USD checker rows using stored displayed headline confidence only, with combined confidence defined as `min(target, USD)`.
- Added pair-trade coverage summary, accuracy summary, combined-confidence bucket table, day totals, weekday breakdown, and conflict/no-trade summary.
- Added `backtester/scripts/validate_layer2_pairing_analysis.js` and confirmed it passes alongside the existing five checker validators.
- Expanded the local browser smoke test to verify the new Pair Trade Research tab renders without console errors.
- Committed and pushed the Pair Trade Research implementation to `origin/main`.
- Refined the Pair Trade Research UI without changing any pairing or Layer 1 calculations.
- Reworked the top `Layer 2 Pair Summary` into a compact comparison layout, improved detailed-table spacing safety, and updated terminology so the summary now uses `Trade Days %` against matched historical days.
- Re-ran lightweight validation and browser smoke after the UI refinements; current platform state is stable and validated.
- Added a new `ADR Reach Research` Backtest / Accuracy sub-tab as a separate downstream module.
- Added `backtester/scripts/validate_adr_reach_research.js` to audit available OHLC support, build `data/adr-reach-research.json`, and validate ADR20 windowing and reconciliation.
- Confirmed the current repo evidence supports real OHLC-based ADR evaluation for `NQ` only, using the repo-local `QQQ` daily OHLC proxy file.
- Confirmed the current repo evidence supports real Layer 2 ADR evaluation for `NQ/USD` only, by reusing the existing Pair Trade Research tradable-signal selection and the same `QQQ` OHLC source.
- Explicitly marked `EUR`, `Gold`, `BTC`, `USD`, `EUR/USD`, `XAU/USD`, and `BTC/USD` unavailable in the ADR module because repo evidence does not currently include supportable High/Low history for them.
- Updated the local dashboard smoke test so ADR Reach Research now verifies summary tables, confidence tables, day totals, weekday tables, and console-clean rendering.
- Re-ran syntax checks, the new ADR validator, all existing Layer 1 checker validators, the existing Layer 2 pairing validator, and browser smoke successfully.
- Added deterministic repo-local `EUR/USD` OHLC coverage in `backtester/tmp/eurusd_daily_alpha_vantage.csv` using Alpha Vantage `FX_DAILY`.
- Added deterministic repo-local `BTC/USD` OHLC coverage in `backtester/tmp/btcusd_daily_coinbase.csv` using Coinbase Exchange daily candles.
- Added `backtester/importers/eurusd/download_eurusd_daily_ohlc_alpha_vantage.js` and `backtester/importers/btc/download_btcusd_daily_ohlc_coinbase.js` to make those repo-local OHLC files reproducible.
- Extended `backtester/scripts/validate_adr_reach_research.js` so `EUR`, `NQ`, and `BTC` Layer 1 plus `EUR/USD`, `NQ/USD`, and `BTC/USD` Layer 2 now build real ADR reach results from supportable OHLC sources.
- Tightened the ADR validator so non-BTC sources cannot introduce weekend OHLC rows and BTC must preserve weekend calendar handling.
- Confirmed `Gold` and `XAU/USD` remain unavailable because the current repo/runtime evidence still does not include a supportable true `XAU/USD` OHLC source, and `USD` remains unavailable because no repo-local `DXY` OHLC source exists.

## Unfinished Work

- Source supportable true `XAU/USD` spot OHLC history for the remaining Gold-layer ADR blocker.
- Source supportable `DXY` or other accepted USD benchmark OHLC history only if a real non-estimated source can be staged repo-locally.

## Blockers

- No repository-side blocker.
- No current release blocker.
- Any n8n API key previously exposed in chat should still be treated as compromised and replaced if it has not already been rotated.

## Assumptions

- Canonical memory documents live in `docs/`, with `CODEX_STARTUP.md` kept at the repository root.
- `docs/ACTIVE_MILESTONE.md` is the current checkpoint only; completed milestone history belongs in `docs/CHANGELOG.md`.
- GitHub remains the source of truth, n8n remains execution, Supabase remains data, and GitHub Pages remains the active dashboard host.
- Historical research work remains downstream-only and must not change production runtime behavior.
- Replay outputs, checker semantics, flat bands, and headline confidence logic remain frozen unless a later task explicitly changes them.

## Exact Next Task

Expand supportable OHLC coverage for the shipped `ADR Reach Research` module.

Design intent for the handover:

- The first ADR release is now live and OHLC expansion is partially complete.
- Current supportable repo-local scope is `EUR`, `NQ`, and `BTC` for Layer 1, plus `EUR/USD`, `NQ/USD`, and `BTC/USD` for Layer 2.
- Reference price for the supported ADR path is evaluation-day `Open`, with previous-close fallback logic retained for future supportable OHLC feeds.
- The next step is not to weaken the blocker rules; it is to source verified true `XAU/USD` and optional `DXY` High/Low coverage for the remaining unavailable assets and pairs.
