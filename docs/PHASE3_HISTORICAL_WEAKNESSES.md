# Phase 3 Weakness Report

Last updated: 2026-06-22

This file records issues discovered during the first historical expansion attempt.

These are evidence-collection issues.

They are not production change requests.

Detailed warehouse-completeness tracking now lives in:

- `docs/HISTORICAL_DATA_INVENTORY.md`

## Critical

### 1. USD replay source coverage ends at January 2024 for required macro inputs

Status:

- blocks expansion to approximately 100 trading days

Evidence:

- `dxy_level` ends at `2024-01-31`
- `us_2y_yield` ends at `2024-01-31`
- `us_10y_yield` ends at `2024-01-31`
- `us_10y_real_yield` ends at `2024-01-31`
- `vix_level` ends at `2024-01-31`

Impact:

- the snapshot builder can only produce the January 2024 USD window
- Jan-May 2024 build skipped `84` candidate dates

### 2. USD replay price proxies end at January 2024

Status:

- blocks continuity for contextual and benchmark-linked snapshot fields

Evidence:

- `gold_spot_usd` ends at `2024-01-31`
- `qqq_nq_proxy` ends at `2024-01-31`

Impact:

- the replay warehouse cannot support a longer continuous run

### 3. USD historical event coverage ends at January 2024

Status:

- blocks trustworthy event-aware expansion

Evidence:

- USD historical economic events currently end at `2024-01-31`

Impact:

- event-aware replay beyond January cannot yet be treated as high quality

## High

### 4. The first 100-day replay target is not currently achievable

Status:

- blocked by warehouse completeness, not by replay logic

Evidence:

- requested replay window: `2024-01-01` to `2024-05-31`
- actual supported replay window: `2024-01-02` to `2024-01-31`
- observations remained `22`

Impact:

- the research framework cannot yet be tested over a statistically meaningful sample

### 5. Evidence was previously inflated by zero-price evaluation handling

Status:

- corrected in the backtester during this phase

Previous issue:

- missing future close data could surface as `close_price = 0`
- evaluator scored those rows as `CORRECT` with `-100%` moves instead of `NOT_EVALUABLE`

Impact before fix:

- headline accuracy was overstated
- average realised move values were polluted
- trade-quality slices were overstated

Current status:

- invalid or zero prices now become `NOT_EVALUABLE`

## Medium

### 6. Verdict-quality sample is still too small to validate the full strength ladder

Status:

- framework works
- evidence is insufficient

Evidence:

- current 24H sample has `Very Weak`, `Weak`, and `Moderate`
- no `Strong` or `Very Strong` 24H rows are present in the current supported window

Impact:

- the verdict-quality layer cannot yet show whether stronger signals materially outperform weaker ones over a meaningful sample

### 7. Confidence calibration is visible but not yet statistically reliable

Status:

- framework works
- sample size remains small

Evidence:

- weighted predicted confidence: `54.40%`
- realised benchmark accuracy: `33.33%`
- weighted calibration gap: `-21.07`

Impact:

- the current reading suggests overconfidence, but the sample is too small for production implications

### 8. Trade-quality threshold evidence is still sparse

Status:

- framework works
- evidence is thin

Evidence:

- `Confidence >= 60` produced only `2` evaluated 24H calls
- current 24H threshold win rate is `50.00%`

Impact:

- trade-quality filtering cannot yet be trusted as a production recommendation layer

## Low

### 9. Current weekly horizon is present, but next-week horizon is not part of the frozen Phase 2 implementation

Status:

- informational only

Impact:

- weekly reporting in this phase should be read as `current week`
- no architecture change is recommended here

## Next Action

The next action is not a logic rewrite.

The next action is warehouse expansion:

1. extend the USD historical macro series
2. extend the USD historical price proxies
3. extend the USD historical event archive
4. rerun the same frozen framework to approximately 100 trading days

Only after that should the project attempt approximately 300 trading days.
