# USD Import Format Spec

## Purpose

This document defines the exact manual CSV or export formats needed to prepare the minimum viable USD historical backtest source data.

It is compatible with:

- `historical_source_manifests`
- `historical_macro_series`
- `historical_price_series`
- `historical_economic_events`

This document does not:

- import data
- build ingestion code
- modify live agents
- modify dashboard logic

## Phase 1 Minimum Viable Sources

1. FRED macro series
   - `DGS2`
   - `DGS10`
   - `DFII10`
   - `VIXCLS`
   - `DTWEXBGS`
2. Germany 2Y historical source
3. Gold daily price source
4. QQQ daily close source
5. Curated USD economic events CSV

## General Import Rules

- CSV files should be UTF-8 encoded.
- Header row is required.
- Blank rows should be removed before import.
- Date fields should use ISO `YYYY-MM-DD` where possible.
- Datetime fields should use ISO 8601.
- Numeric values should use `.` as decimal separator.
- Missing numeric values should be blank, not `N/A`, `.`, or `null` text.
- One source manifest should be created per imported file or tightly related batch.

---

## 1. FRED Macro Series

Applies to:

- `DGS2`
- `DGS10`
- `DFII10`
- `VIXCLS`
- `DTWEXBGS`

### Expected file naming

- `fred_DGS2_daily.csv`
- `fred_DGS10_daily.csv`
- `fred_DFII10_daily.csv`
- `fred_VIXCLS_daily.csv`
- `fred_DTWEXBGS_daily.csv`

### Required columns

- `date`
- `value`

### Optional columns

- `realtime_start`
- `realtime_end`
- `series_id`
- `source_note`

### Date/time handling

- `date` is treated as a daily observation date
- import should convert it to:
  - `observation_date = date`
  - `observed_at = date + 00:00:00 UTC`
- if revision windows are provided:
  - `realtime_start` and `realtime_end` should be stored in `metadata`

### Timezone assumptions

- source dates are daily macro observation dates
- warehouse default assumption: `UTC`

### Warehouse field mapping

Manifest:
- `source_type = 'csv_upload'` or `api_export`
- `vendor_name = 'FRED'`
- `dataset_name = <series id + export description>`
- `asset_scope = 'USD'` for USD-only import batches, or `MULTI_ASSET` if shared
- `frequency = 'daily'`
- `import_mode = 'historical_backfill'`
- `schema_version = 'v1'`

Macro series:
- `series_key`
  - `DGS2 -> us_2y_yield`
  - `DGS10 -> us_10y_yield`
  - `DFII10 -> us_10y_real_yield`
  - `VIXCLS -> vix_level`
  - `DTWEXBGS -> dxy_level`
- `series_family`
  - `rates` for `DGS2`, `DGS10`, `DFII10`
  - `volatility` for `VIXCLS`
  - `fx_index` for `DTWEXBGS`
- `asset_scope = 'USD'`
- `region_scope = 'US'` except `DTWEXBGS` may be `GLOBAL`
- `value_numeric = value`
- `unit`
  - `percent` for `DGS2`, `DGS10`, `DFII10`
  - `index_points` for `VIXCLS`, `DTWEXBGS`
- `frequency = 'daily'`
- `vendor_symbol = series_id if provided, else file-level constant`
- `vendor_field = 'value'`

### Validation rules

- `date` must parse as `YYYY-MM-DD`
- `value` must be numeric or blank
- blank `value` rows should usually be dropped before import
- no duplicate `date` rows in the same file
- files should be sorted ascending by date for easier review, though import can normalize either way

### Example rows

```csv
date,value,realtime_start,realtime_end,series_id
2024-01-02,4.25,2024-01-02,2024-01-02,DGS2
2024-01-03,4.31,2024-01-03,2024-01-03,DGS2
```

### Common failure cases

- FRED exports using `.` or blank placeholders inconsistently
- duplicate dates after manual concatenation
- missing `series_id`, causing ambiguity if filenames are not preserved
- `DTWEXBGS` being mistaken for classic ICE DXY

---

## 2. Germany 2Y Historical Source

### Expected file naming

- `germany_2y_daily.csv`

The runtime-validation placeholder series must not be used as the research-grade source.
The canonical Phase 1 input should be a proper Germany 2Y historical export from the chosen real source.

### Required columns

- `date`
- `value`

### Optional columns

- `source_symbol`
- `source_name`
- `currency`
- `country`
- `notes`

### Date/time handling

- daily observation date
- import should convert to:
  - `observation_date = date`
  - `observed_at = date + 00:00:00 UTC`

### Timezone assumptions

- daily source
- use `UTC` in warehouse unless source provides a stronger convention

### Warehouse field mapping

Manifest:
- `source_type = 'csv_upload'`
- `vendor_name = 'Bundesbank'` or actual vendor name
- `dataset_name = 'Germany 2Y historical daily series'`
- `asset_scope = 'USD'` for the first batch, though it is reusable for EUR too
- `frequency = 'daily'`
- `import_mode = 'historical_backfill'`
- `schema_version = 'v1'`

Macro series:
- `series_key = 'de_2y_yield'`
- `series_family = 'rates'`
- `asset_scope = 'USD'`
- `region_scope = 'DE'`
- `value_numeric = value`
- `unit = 'percent'`
- `frequency = 'daily'`
- `vendor_symbol = source_symbol if provided`

### Validation rules

- `date` required and unique within the file
- `value` must be numeric
- negative yields are allowed historically
- if source uses comma decimals, normalize to `.` before import

### Example rows

```csv
date,value,source_symbol,country
2024-01-02,2.41,DE2Y,DE
2024-01-03,2.44,DE2Y,DE
```

### Common failure cases

- semicolon-delimited exports with comma decimals
- XML or SDMX observation feeds being treated as plain CSV without normalization
- reversed sort order mixed with deduped appends
- source values in basis points instead of percent
- insufficient history depth

---

## 3. Gold Daily Price Source

### Expected file naming

- `gold_daily.csv`

### Required columns

- `date`
- `close`

### Optional columns

- `open`
- `high`
- `low`
- `volume`
- `instrument`
- `currency`
- `source_symbol`

### Date/time handling

- daily close record
- import should convert to:
  - `observation_date = date`
  - `observed_at = date + 00:00:00 UTC`

### Timezone assumptions

- daily close series
- use `UTC` unless the source explicitly defines market-close timezone and you choose to preserve it in `metadata`

### Warehouse field mapping

Manifest:
- `source_type = 'csv_upload'`
- `vendor_name = <actual source>`
- `dataset_name = 'Gold daily price history'`
- `asset_scope = 'USD'`
- `frequency = 'daily'`
- `import_mode = 'historical_backfill'`
- `schema_version = 'v1'`

Price series:
- `instrument_key = 'gold_spot_usd'` preferred
- fallback `instrument_key = 'gld_proxy'` or `gc_front_proxy` if proxy is used
- `instrument_family = 'commodity'`
- `asset_scope = 'USD'`
- `quote_currency = 'USD'`
- `interval = 'daily'`
- `open/high/low/close` from file if available
- if only close exists:
  - set `close`
  - leave `open/high/low` null
- `vendor_symbol = source_symbol if provided`
- `is_adjusted = false` unless proxy ETF data is adjusted

### Validation rules

- `date` required
- `close > 0`
- if `high` and `low` exist, `high >= low`
- no duplicate `date` rows for the same source file

### Example rows

```csv
date,open,high,low,close,instrument,source_symbol
2024-01-02,2064.1,2078.4,2058.3,2073.5,GOLD_SPOT,XAUUSD
2024-01-03,2073.5,2075.2,2042.0,2048.7,GOLD_SPOT,XAUUSD
```

### Common failure cases

- mixing spot and ETF history in the same file
- adjusted ETF closes mistaken for spot
- proxy source changes mid-file

---

## 4. QQQ Daily Close Source

### Expected file naming

- `qqq_daily.csv`

### Required columns

- `date`
- `close`

### Optional columns

- `open`
- `high`
- `low`
- `volume`
- `source_symbol`
- `adjusted_close`

### Date/time handling

- daily close record
- import should convert to:
  - `observation_date = date`
  - `observed_at = date + 00:00:00 UTC`

### Timezone assumptions

- daily US market close proxy
- warehouse default should still store `UTC`
- if market-close semantics matter later, preserve source convention in `metadata`

### Warehouse field mapping

Manifest:
- `source_type = 'csv_upload'`
- `vendor_name = <actual source>`
- `dataset_name = 'QQQ daily close history'`
- `asset_scope = 'USD'`
- `frequency = 'daily'`
- `import_mode = 'historical_backfill'`
- `schema_version = 'v1'`

Price series:
- `instrument_key = 'qqq'`
- `instrument_family = 'equity_proxy'`
- `asset_scope = 'USD'`
- `quote_currency = 'USD'`
- `interval = 'daily'`
- `close = close`
- `open/high/low/volume` if provided
- `vendor_symbol = source_symbol if provided else 'QQQ'`
- `is_adjusted = true` only if using adjusted series as the canonical field

### Validation rules

- `date` required
- `close > 0`
- no duplicate dates
- if using both `close` and `adjusted_close`, document which one is canonical before import

### Example rows

```csv
date,open,high,low,close,volume,source_symbol
2024-01-02,409.12,412.51,407.88,411.94,42881200,QQQ
2024-01-03,410.90,411.22,405.33,406.14,51290100,QQQ
```

### Common failure cases

- mixing adjusted and unadjusted closes
- using Nasdaq 100 index values in one range and QQQ ETF values in another
- duplicate dates from multiple exports

---

## 5. Curated USD Economic Events CSV

### Expected file naming

- `usd_economic_events_curated.csv`

### Required columns

- `event_name`
- `event_time`
- `event_timezone`
- `currency`
- `country`
- `importance`
- `actual_numeric`
- `forecast_numeric`
- `previous_numeric`

### Optional columns

- `event_key`
- `event_category`
- `region_scope`
- `actual_text`
- `forecast_text`
- `previous_text`
- `surprise_direction`
- `currency_signal`
- `vendor_event_id`
- `revision_status`
- `source_note`

### Date/time handling

- `event_time` must be full ISO datetime if possible
- if source only provides date and local clock time, convert to one combined datetime before import
- `event_date` should be derived from `event_time`

### Timezone assumptions

- do not assume UTC silently
- `event_timezone` is required because release timing matters for:
  - `latest_us_event`
  - `recent_us_event_within_72h`
  - `tier1_event_due_next_24h`
  - `tier1_events_due_next_3d_count`

### Warehouse field mapping

Manifest:
- `source_type = 'csv_upload'` or `manual_curated`
- `vendor_name = <actual source or 'curated'>`
- `dataset_name = 'USD historical economic events curated'`
- `asset_scope = 'USD'`
- `frequency = 'event'`
- `import_mode = 'historical_backfill'`
- `schema_version = 'v1'`

Economic events:
- `event_key = event_key if provided`
- `event_name = event_name`
- `event_category = event_category if provided`
- `country = country`
- `currency = currency`
- `region_scope = region_scope if provided`
- `event_time = event_time`
- `event_date = derived from event_time`
- `event_timezone = event_timezone`
- `importance = importance`
- `actual_numeric = actual_numeric`
- `forecast_numeric = forecast_numeric`
- `previous_numeric = previous_numeric`
- `actual_text = actual_text if provided`
- `forecast_text = forecast_text if provided`
- `previous_text = previous_text if provided`
- `surprise_direction = surprise_direction if curated`
- `currency_signal = currency_signal if curated`
- `vendor_event_id = vendor_event_id if provided`
- `revision_status = revision_status if provided`
- `metadata`
  - include `source_note` if supplied

### Validation rules

- `currency` should be `USD` for the initial Phase 1 file
- `importance` must be one of `low`, `medium`, `high`
- `event_time` must parse as datetime
- numeric fields may be blank, but major reconstructed events should ideally have actual and forecast
- no duplicate event rows for the same `event_name + event_time + currency`
- if `currency_signal` is present, it must be `BULLISH`, `BEARISH`, or `NEUTRAL`
- if `surprise_direction` is present, it must be `positive`, `negative`, or `neutral`

### Example rows

```csv
event_key,event_name,event_time,event_timezone,currency,country,importance,actual_numeric,forecast_numeric,previous_numeric,surprise_direction,currency_signal,source_note
NFP,Non Farm Payrolls,2024-01-05T13:30:00Z,UTC,USD,US,high,216,170,173,positive,BULLISH,Curated from source archive
CPI_MOM,Inflation Rate MoM,2024-01-11T13:30:00Z,UTC,USD,US,high,0.3,0.2,0.1,positive,BULLISH,Curated from source archive
```

### Common failure cases

- missing or inconsistent timezones
- event names changing across files
- actual / forecast mixed as text with units in some rows and numeric in others
- release timestamps rounded to date only
- duplicate rows after combining multiple archives

---

## Recommended Manual Import Order

Import order should minimize blockers for the first USD reconstruction pass.

1. `fred_DGS2_daily.csv`
2. `fred_DFII10_daily.csv`
3. `fred_VIXCLS_daily.csv`
4. `fred_DTWEXBGS_daily.csv`
5. `germany_2y_daily.csv`
6. `gold_daily.csv`
7. `qqq_daily.csv`
8. `usd_economic_events_curated.csv`
9. `fred_DGS10_daily.csv`

Reason:

- the first eight files cover the minimum viable Phase 1 field set
- `DGS10` is useful parity/context but not required to get the first reconstruction running

---

## CSVs To Obtain Next

Minimum viable:

- `fred_DGS2_daily.csv`
- `fred_DFII10_daily.csv`
- `fred_VIXCLS_daily.csv`
- `fred_DTWEXBGS_daily.csv`
- `germany_2y_daily.csv`
- `gold_daily.csv`
- `qqq_daily.csv`
- `usd_economic_events_curated.csv`

Optional parity:

- `fred_DGS10_daily.csv`

---

## Easiest Sources

Easiest:

- FRED `DGS2`
- FRED `DGS10`
- FRED `DFII10`
- FRED `VIXCLS`
- FRED `DTWEXBGS`
- QQQ daily close

Reason:

- stable daily formats
- low transformation complexity

---

## Highest-Risk Sources

Highest risk:

- `germany_2y_daily.csv`
- `usd_economic_events_curated.csv`
- `gold_daily.csv` if source/proxy is inconsistent

Reason:

- Germany 2Y may need source normalization
- event history quality directly affects Factor 7 and derived `fed_bias`
- gold proxy choice can distort Factor 6 if not documented

---

## Next Implementation Step

After this spec, the next step should be:

1. collect or export the minimum viable CSV files using the exact formats above
2. create one manifest row plan per file
3. then build the first warehouse import loader against those fixed formats

Do not build replay logic until the raw warehouse data is loaded and validated.
