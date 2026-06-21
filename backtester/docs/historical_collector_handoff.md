# Historical Collector Handoff

## Current State

Implemented:

- FRED historical macro importer

Location:

- `backtester/importers/fred/import_fred_macro.js`

It imports:

- `DGS2` -> `us_2y_yield`
- `DGS10` -> `us_10y_yield`
- `DFII10` -> `us_10y_real_yield`
- `VIXCLS` -> `vix_level`
- `DTWEXBGS` -> `dxy_level`

Target tables:

- `historical_source_manifests`
- `historical_macro_series`

## Remaining Collectors

### 1. Germany 2Y Importer

Goal:

- load daily Germany 2Y history into `historical_macro_series`

Expected output:

- `series_key = 'de_2y_yield'`
- `series_family = 'rates'`

Key issues:

- source format may be semicolon-delimited
- decimal normalization may be required
- verify whether source values are percent or basis points

Suggested location:

- `backtester/importers/germany_2y/`

### 2. Gold Daily Price Importer

Goal:

- load gold daily history into `historical_price_series`

Expected output:

- `instrument_key = 'gold_spot_usd'` preferred
- fallback proxy should be explicitly labeled if used

Key issues:

- avoid mixing spot and ETF proxy rows in one canonical series
- document whether source is spot, GLD, or futures proxy

Suggested location:

- `backtester/importers/gold/`

### 3. QQQ Daily Price Importer

Goal:

- load QQQ daily history into `historical_price_series`

Expected output:

- `instrument_key = 'qqq'`
- `instrument_family = 'equity_proxy'`

Key issues:

- choose adjusted vs unadjusted closes consistently
- do not mix index levels with ETF closes

Suggested location:

- `backtester/importers/qqq/`

### 4. Curated USD Economic Events Importer

Goal:

- load curated USD macro events into `historical_economic_events`

Expected output:

- historical rows with release timestamp, actual, forecast, previous, impact

Key issues:

- timezone integrity is critical
- event name normalization matters
- actual / forecast values may need numeric parsing

Suggested location:

- `backtester/importers/usd_events/`

## Suggested Build Order

1. Run `003_generic_historical_warehouse.sql`
2. Run FRED macro importer
3. Build Germany 2Y importer
4. Build gold daily price importer
5. Build QQQ daily price importer
6. Build curated USD economic events importer
7. Validate raw warehouse coverage
8. Only then build the USD historical snapshot population logic

## Rules For All Future Collectors

- keep them downstream-only
- do not touch live Layer 1 agents
- do not touch dashboard logic
- do not write replay or outcome logic in collectors
- create/update one source manifest per dataset import
- preserve raw source lineage
- upsert with stable natural keys
- log prepared rows, submitted rows, and skipped rows
