# QQQ Daily Historical Import

This importer loads QQQ daily price history as the Phase 1 NQ proxy.

Target tables:

- `historical_source_manifests`
- `historical_price_series`

Default canonical target:

- `instrument_key = 'qqq_nq_proxy'`
- `instrument_family = 'equity_proxy'`

The importer labels QQQ explicitly as an NQ proxy in metadata. It does not claim to be true NQ futures history.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Source input

Provide either:

- `--file=path/to/qqq_daily.csv`
- `--source-url=https://...`

Expected columns:

- `date`
- `close`

Optional columns:

- `open`
- `high`
- `low`
- `volume`
- `source_symbol`
- `adjusted_close`

## Run

```powershell
node backtester/importers/qqq/import_qqq_daily.js --file=qqq_daily.csv --start=2018-01-01 --end=2024-12-31
```
