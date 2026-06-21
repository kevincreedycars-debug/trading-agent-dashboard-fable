# Gold Source Decision

## Status

Phase 3 decision: retain the current GLD proxy for now.

## Why true spot was not adopted yet

Preferred order was:

1. FRED daily USD gold series
2. another stable free USD gold source
3. retain GLD if neither is practical

What was verified on 2026-06-21:

- FRED access is available in this workspace.
- The attempted daily gold series identifier `GOLDAMGBD228NLBM` was invalid at runtime.
- Broad FRED series search did not produce a practical daily USD gold spot/fix series for this loader.
- LBMA public pages are reachable, but the page states historical tabulated precious-metals price data has moved behind the MyLBMA portal and licensing flow for Gold and Silver historical use.

Result:

- There is no currently verified free, stable, directly importable daily USD spot/fix gold source in this workspace that is clearly better operationally than the existing GLD proxy.

## Why GLD is retained

- It is already loaded and working in the warehouse.
- It covers the current available replay window without adding a brittle licensed dependency.
- For the USD engine, gold is a secondary confirmation input rather than the primary directional driver.
- The documented risk remains acceptable for the current infrastructure phase:
  - GLD may slightly distort Factor 6 timing versus true spot gold.

## Current warehouse reality

- `historical_price_series.instrument_key = 'gold_spot_usd'` is currently backed by GLD ETF rows.
- Existing metadata already marks the lineage with `proxy_label = gld_etf_proxy` and `vendor_symbol = GLD`.

## Next action

Proceed with Phase 4 using the retained GLD proxy.

If a validated free daily USD spot/fix source is found later, Phase 3 can be reopened and the series can be replaced with a documented migration.
