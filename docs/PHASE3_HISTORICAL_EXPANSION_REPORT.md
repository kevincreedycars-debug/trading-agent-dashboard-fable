# Phase 3 Historical Expansion Report

Last updated: 2026-06-22

## Scope

Phase 3 is evidence collection, not feature work.

The requested target was to expand USD replay coverage from approximately 22 trading days to approximately 100 trading days using the existing frozen research framework.

The attempted replay window for this pass was:

- requested run window: `2024-01-01` to `2024-05-31`

The actual supported replay window was:

- supported snapshot window: `2024-01-02` to `2024-01-31`

The warehouse currently does not support a continuous USD-capable run beyond January 2024.

Warehouse-completeness follow-up now lives in:

- `docs/HISTORICAL_DATA_INVENTORY.md`

## Pipeline Result

The full frozen pipeline was executed over the requested window:

1. historical collectors / warehouse
2. snapshot builder
3. replay engine
4. outcome evaluation
5. research SQL
6. dashboard-facing research views

Pipeline summaries:

- snapshot builder: `22` rows updated, `84` rows skipped
- replay engine: `22` observations processed, `88` predictions written, `880` factor rows written
- outcome evaluation: `88` predictions processed, `440` evaluation rows written, `88` realised outcome rows written

The pipeline remained isolated from production throughout.

## Overall

- observations: `22`
- predictions: `88`
- evaluation rows: `440`
- benchmark rows: `88`
- assets covered: `USD`

## Accuracy

Headline benchmark:

- overall DXY-only win rate: `33.33%`
- evaluated predictions: `75`
- wins: `25`
- losses: `25`
- flats: `25`
- not evaluable benchmark rows: `13`

Timeframe accuracy:

- `following 24hrs`: `36.84%` win rate, `19` evaluated
- `3d from call`: `29.41%` win rate, `17` evaluated
- `current week`: `38.89%` win rate, `18` evaluated
- `current month`: `28.57%` win rate, `21` evaluated

The strongest currently implemented horizon in this sample is `current week`, but the sample remains too small to treat that as stable evidence.

The primary production product remains `following 24hrs`, which currently reads:

- 24H accuracy: `36.84%`
- 24H wins: `7`
- 24H losses: `5`
- 24H flats: `7`
- 24H not evaluable: `3`

## Verdict Quality

The current 24H sample does not contain any `STRONG` or `VERY_STRONG` rows.

Observed 24H strength buckets:

- `Very Weak`: `31.25%` win rate, `16` evaluated, `1` not evaluable
- `Weak`: `100.00%` win rate, `1` evaluated, `2` not evaluable
- `Moderate`: `50.00%` win rate, `2` evaluated

Interpretation:

- the current sample is too small and too lopsided to validate the full strength hierarchy
- the verdict-quality framework is functioning, but the evidence base is not yet large enough

## Confidence

Weighted confidence calibration summary across the current benchmark sample:

- average predicted confidence: `54.40%`
- realised benchmark accuracy: `33.33%`
- weighted calibration gap: `-21.07`

Current reading:

- the model appears overconfident in this small sample

24H confidence buckets currently populated:

- `50-54`: `31.25%` actual vs `50.69%` predicted
- `55-59`: `100.00%` actual vs `59.00%` predicted
- `60-64`: `0` evaluated, `2` not evaluable
- `65-69`: `50.00%` actual vs `65.00%` predicted

This is enough to show the calibration framework works, but not enough to draw stable production conclusions.

## Trade Quality

24H trade-quality thresholds currently populated:

- `All Calls`
  - coverage: `100.00%`
  - evaluated calls: `19`
  - win rate: `36.84%`
  - average realised absolute move: `0.2213%`

- `Confidence >= 60`
  - coverage: `18.18%`
  - tradeable predictions: `4`
  - evaluated calls: `2`
  - win rate: `50.00%`
  - average realised absolute move: `0.2908%`

Current strongest threshold by 24H win rate:

- `Confidence >= 60`

Important qualification:

- this threshold wins only on `2` evaluated 24H calls
- it is a useful research readout, not strong enough evidence for production filtering

## Data Quality

The current blocker is warehouse coverage, not replay infrastructure.

Observed quality state:

- requested Jan-May candidate dates skipped by builder: `84`
- supported snapshot rows created or updated: `22`
- snapshot market-data status:
  - `collected`: `21`
  - `partial`: `1`
- snapshot event status:
  - `collected`: `22`

Observed missing-series warnings:

- `missing_us_2y_yield`: `1`
- `missing_us_10y_yield`: `1`
- `missing_us_10y_real_yield`: `1`
- `missing_dxy_level`: `1`
- `missing_gold_spot_usd`: `1`
- `missing_qqq_nq_proxy`: `1`

Warehouse coverage discovered during this pass:

- `de_2y_yield` continues through `2024-12-30`
- `dxy_level` currently ends at `2024-01-31`
- `us_2y_yield` currently ends at `2024-01-31`
- `us_10y_yield` currently ends at `2024-01-31`
- `us_10y_real_yield` currently ends at `2024-01-31`
- `vix_level` currently ends at `2024-01-31`
- `gold_spot_usd` currently ends at `2024-01-31`
- `qqq_nq_proxy` currently ends at `2024-01-31`
- USD historical economic events currently end at `2024-01-31`

Benchmark coverage:

- benchmark rows: `88`
- benchmark `CORRECT`: `25`
- benchmark `WRONG`: `25`
- benchmark `FLAT`: `25`
- benchmark `NOT_EVALUABLE`: `13`

## Evidence Integrity Note

During this phase, a genuine evaluator bug was found and corrected.

Previous behavior:

- missing future close data could be interpreted as `close_price = 0`
- that could create false `-100%` benchmark moves
- those rows were being counted as wins instead of `NOT_EVALUABLE`

Corrected behavior:

- invalid or zero market prices are now treated as `NOT_EVALUABLE`

This correction reduced the headline benchmark accuracy and increased the `NOT_EVALUABLE` count, which is the correct outcome for evidence collection.

## Conclusion

Phase 3 did not reach the intended approximately 100-trading-day sample because the USD warehouse does not yet contain continuous source coverage beyond January 2024 for the required replay inputs.

What this phase did establish:

- the frozen research framework still runs end-to-end
- the dashboard-facing research views populate correctly
- verdict quality, confidence calibration, and trade quality all operate on the corrected evaluator
- the next bottleneck is historical data coverage, not framework design

## Recommended Next Milestone

Expand the underlying USD historical warehouse so the same frozen framework can be rerun over approximately 100 trading days.

Priority order:

1. extend required USD macro series beyond `2024-01-31`
2. extend required price proxies beyond `2024-01-31`
3. extend USD historical economic events beyond `2024-01-31`
4. rerun the same pipeline to approximately `100` trading days
5. only after that, attempt approximately `300` trading days

Do not change `/logic`.

Do not change production confidence, strength, or thresholds.

Do not optimize Layer 1 until the evidence base is materially larger.
