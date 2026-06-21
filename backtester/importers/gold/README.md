# Gold Daily Historical Import

This importer loads daily gold history into the historical warehouse.

Target tables:

- `historical_source_manifests`
- `historical_price_series`

Default canonical target:

- `instrument_key = 'gold_spot_usd'`
- `instrument_family = 'commodity'`

If you use a proxy instead of spot, set `--instrument-key` explicitly so lineage stays clear.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Source input

Provide either:

- `--file=path/to/gold_daily.csv`
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

## Run

```powershell
node backtester/importers/gold/import_gold_daily.js --file=gold_daily.csv --start=2018-01-01 --end=2024-12-31
```

Proxy example:

```powershell
node backtester/importers/gold/import_gold_daily.js --file=gld_daily.csv --instrument-key=gld_proxy --vendor-name=Stooq
```
