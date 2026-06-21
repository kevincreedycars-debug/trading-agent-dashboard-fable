# FRED Historical Macro Import

This importer loads the first minimum viable USD macro history into the generic raw historical warehouse.

Imported FRED daily series:

- `DGS2` -> `us_2y_yield`
- `DGS10` -> `us_10y_yield`
- `DFII10` -> `us_10y_real_yield`
- `VIXCLS` -> `vix_level`
- `DTWEXBGS` -> `dxy_level`

This importer is downstream-only.

It does not:

- modify live Layer 1 agents
- modify dashboard logic
- build replay logic
- build outcome logic

## Prerequisites

Run these SQL files first:

- `backtester/sql/003_generic_historical_warehouse.sql`

Recommended to have already run:

- `backtester/sql/001_observation_first_research_tables.sql`
- `backtester/sql/002_usd_historical_market_snapshots.sql`

Only `003` is required for this importer.

## Environment Variables

Required:

- `FRED_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `FRED_IMPORT_START`
- `FRED_IMPORT_END`
- `FRED_MANIFEST_NAME`

## Run

Default date range:

- start: `2000-01-01`
- end: today

Example:

```powershell
$env:FRED_API_KEY="your_fred_key"
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
node backtester/importers/fred/import_fred_macro.js --start=2018-01-01 --end=2024-12-31
```

Or using env vars:

```powershell
$env:FRED_IMPORT_START="2018-01-01"
$env:FRED_IMPORT_END="2024-12-31"
node backtester/importers/fred/import_fred_macro.js
```

## What It Does

1. fetches historical observations from FRED
2. normalizes daily rows into `historical_macro_series`
3. creates or updates one `historical_source_manifests` row
4. upserts rows into `historical_macro_series`
5. skips FRED missing values such as `.`
6. logs per-series counts

## Duplicate Handling

The importer uses a stable manifest and upserts on:

- `series_key`
- `observed_at`
- `source_manifest_id`
- `revision_tag`

It writes `revision_tag = 'base'` so reruns do not create duplicate base observations for the same manifest.

## Notes For Future Importers

Future importers should follow the same pattern:

1. define a narrow, explicit source mapping
2. create or update a source manifest first
3. normalize into the appropriate raw warehouse table only
4. upsert using stable natural keys
5. keep live workflow logic completely isolated
6. log prepared row counts and submitted row counts separately
7. preserve source-specific metadata in `metadata` rather than flattening everything into columns

Recommended next importers:

- Germany 2Y importer
- Gold daily price importer
- QQQ daily price importer
- Curated USD economic events importer
