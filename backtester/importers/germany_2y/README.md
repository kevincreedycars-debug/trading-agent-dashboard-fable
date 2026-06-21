# Germany 2Y Historical Import

This importer loads Germany 2Y daily history into the historical warehouse.

Target tables:

- `historical_source_manifests`
- `historical_macro_series`

Canonical target:

- `series_key = 'de_2y_yield'`
- `series_family = 'rates'`

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Source input

Provide either:

- `--file=path/to/germany_2y_daily.csv`
- `--source-url=https://...`

If neither is supplied, the importer defaults to the Bundesbank daily 2-year constant-maturity yield feed:

- `BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A`

The importer now supports:

- standard delimited files with a `date`/`value` shape
- semicolon-delimited files with decimal commas
- Bundesbank statistics CSV exports with metadata rows
- XML observation feeds that expose date/value pairs such as official SDMX-style exports

Do not use the runtime-validation placeholder file as the long-term source of truth.
Phase 1 should be fed from a proper historical Germany 2Y source export.

Expected columns:

- `date`
- `value`

Optional columns:

- `source_symbol`
- `source_name`

The importer detects comma or semicolon delimiters. Use `--decimal-comma=true` when the source stores numeric values like `2,41`.

If you want to validate a source file or URL before any database write, use:

```powershell
node backtester/importers/germany_2y/import_germany_2y.js --file=germany_2y_daily.csv --preview-only=true
```

Bundesbank default preview example:

```powershell
node backtester/importers/germany_2y/import_germany_2y.js --preview-only=true
```

If the source is in basis points instead of percent, use:

```powershell
--value-scale=bps
```

## Run

```powershell
node backtester/importers/germany_2y/import_germany_2y.js --file=germany_2y_daily.csv --decimal-comma=true --start=2018-01-01 --end=2024-12-31
```

Official-style XML preview example:

```powershell
node backtester/importers/germany_2y/import_germany_2y.js --source-url=https://... --preview-only=true --vendor-name=Bundesbank
```
