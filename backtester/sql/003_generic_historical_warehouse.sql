create table if not exists historical_source_manifests (
  id uuid primary key default gen_random_uuid(),
  manifest_name text not null,
  source_type text not null,
  vendor_name text not null,
  dataset_name text,
  asset_scope text not null default 'MULTI_ASSET',
  coverage_start date,
  coverage_end date,
  frequency text,
  import_mode text not null,
  schema_version text not null,
  normalization_version text,
  source_uri text,
  license_notes text,
  checksum text,
  row_count bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint historical_source_manifests_source_type_check
    check (source_type in ('api_export', 'csv_upload', 'manual_curated', 'derived_internal')),

  constraint historical_source_manifests_import_mode_check
    check (import_mode in ('historical_backfill', 'incremental_append', 'manual_patch')),

  constraint historical_source_manifests_frequency_check
    check (frequency is null or frequency in ('intraday', 'daily', 'weekly', 'monthly', 'event')),

  constraint historical_source_manifests_coverage_check
    check (
      coverage_start is null or
      coverage_end is null or
      coverage_start <= coverage_end
    )
);

comment on table historical_source_manifests is
'Provenance registry for historical warehouse loads. One row represents one import bundle, vendor export, curated CSV, or internal derived dataset. All raw historical warehouse rows must link back to one manifest.';

comment on column historical_source_manifests.asset_scope is
'High-level intended asset usage, such as USD, EUR, GOLD, NQ, BTC, or MULTI_ASSET.';

comment on column historical_source_manifests.schema_version is
'Version of the expected warehouse import schema for the manifest at load time.';

create index if not exists idx_historical_source_manifests_vendor_dataset
  on historical_source_manifests (vendor_name, dataset_name, created_at desc);

create index if not exists idx_historical_source_manifests_asset_scope
  on historical_source_manifests (asset_scope, created_at desc);

create table if not exists historical_macro_series (
  id uuid primary key default gen_random_uuid(),
  source_manifest_id uuid not null references historical_source_manifests(id) on delete restrict,
  series_key text not null,
  series_family text not null,
  asset_scope text not null default 'GLOBAL',
  region_scope text,
  observed_at timestamptz not null,
  observation_date date not null,
  observation_timezone text not null default 'UTC',
  value_numeric numeric,
  value_text text,
  unit text,
  frequency text not null,
  vendor_symbol text,
  vendor_field text,
  is_revised boolean not null default false,
  revision_tag text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint historical_macro_series_frequency_check
    check (frequency in ('intraday', 'daily', 'weekly', 'monthly', 'event')),

  constraint historical_macro_series_value_presence_check
    check (value_numeric is not null or value_text is not null),

  constraint historical_macro_series_unique_observation
    unique (series_key, observed_at, source_manifest_id, revision_tag)
);

comment on table historical_macro_series is
'Generic raw historical warehouse table for non-price macro and market-state series. Examples: yields, volatility indexes, policy proxies, broad dollar indexes, and later categorical macro states.';

comment on column historical_macro_series.series_key is
'Canonical internal series identifier such as us_2y_yield, vix_level, dxy_level, or de_2y_yield.';

comment on column historical_macro_series.series_family is
'Broad grouping for warehouse organization, such as rates, volatility, fx_index, policy_proxy, or regime.';

comment on column historical_macro_series.revision_tag is
'Optional revision label to distinguish revised releases from base observations when vendors provide revised historical values.';

create index if not exists idx_historical_macro_series_series_time
  on historical_macro_series (series_key, observed_at desc);

create index if not exists idx_historical_macro_series_asset_series_time
  on historical_macro_series (asset_scope, series_key, observed_at desc);

create index if not exists idx_historical_macro_series_date_family
  on historical_macro_series (observation_date, series_family);

create index if not exists idx_historical_macro_series_manifest
  on historical_macro_series (source_manifest_id);

create table if not exists historical_price_series (
  id uuid primary key default gen_random_uuid(),
  source_manifest_id uuid not null references historical_source_manifests(id) on delete restrict,
  instrument_key text not null,
  instrument_family text not null,
  asset_scope text not null,
  quote_currency text,
  observed_at timestamptz not null,
  observation_date date not null,
  observation_timezone text not null default 'UTC',
  interval text not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric not null,
  volume numeric,
  open_interest numeric,
  vendor_symbol text,
  is_adjusted boolean not null default false,
  adjustment_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint historical_price_series_interval_check
    check (interval in ('intraday', 'daily', 'weekly', 'monthly')),

  constraint historical_price_series_close_positive_check
    check (close > 0),

  constraint historical_price_series_high_low_check
    check (
      high is null or
      low is null or
      high >= low
    ),

  constraint historical_price_series_unique_observation
    unique (instrument_key, interval, observed_at, source_manifest_id)
);

comment on table historical_price_series is
'Generic raw historical warehouse table for tradeable or proxy price history. Examples: gold spot proxies, QQQ, NQ futures proxies, DXY proxies, BTC spot, and later asset-specific price feeds.';

comment on column historical_price_series.instrument_key is
'Canonical internal instrument identifier such as gold_spot_usd, qqq, nq_front_proxy, dxy_index, or btc_usd_spot.';

comment on column historical_price_series.interval is
'Storage interval of the imported series. Phase 1 primarily expects daily rows, but the schema allows future intraday expansion.';

create index if not exists idx_historical_price_series_instrument_interval_time
  on historical_price_series (instrument_key, interval, observed_at desc);

create index if not exists idx_historical_price_series_asset_date
  on historical_price_series (asset_scope, observation_date);

create index if not exists idx_historical_price_series_manifest
  on historical_price_series (source_manifest_id);

create table if not exists historical_economic_events (
  id uuid primary key default gen_random_uuid(),
  source_manifest_id uuid not null references historical_source_manifests(id) on delete restrict,
  event_key text,
  event_name text not null,
  event_category text,
  country text,
  currency text,
  region_scope text,
  event_time timestamptz not null,
  event_date date not null,
  event_timezone text not null,
  importance text,
  actual_numeric numeric,
  forecast_numeric numeric,
  previous_numeric numeric,
  actual_text text,
  forecast_text text,
  previous_text text,
  surprise_direction text,
  currency_signal text,
  vendor_event_id text,
  revision_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint historical_economic_events_importance_check
    check (importance is null or importance in ('low', 'medium', 'high')),

  constraint historical_economic_events_surprise_direction_check
    check (surprise_direction is null or surprise_direction in ('positive', 'negative', 'neutral')),

  constraint historical_economic_events_currency_signal_check
    check (currency_signal is null or currency_signal in ('BULLISH', 'BEARISH', 'NEUTRAL')),

  constraint historical_economic_events_unique_occurrence
    unique (event_name, event_time, currency, source_manifest_id)
);

comment on table historical_economic_events is
'Generic raw historical warehouse table for scheduled macroeconomic releases and realized event outcomes. Supports USD first, then EUR, Gold, NQ, and BTC through shared macro-event context and later derived policy/regime logic.';

comment on column historical_economic_events.event_key is
'Optional normalized event identifier such as NFP, CPI_MOM, CORE_CPI_MOM, ECB_RATE, or GDP_ADV.';

comment on column historical_economic_events.currency_signal is
'Optional imported or curated directional currency interpretation if provided by source data. This should remain source lineage, not unquestioned truth.';

create index if not exists idx_historical_economic_events_currency_time
  on historical_economic_events (currency, event_time desc);

create index if not exists idx_historical_economic_events_country_time
  on historical_economic_events (country, event_time desc);

create index if not exists idx_historical_economic_events_name_time
  on historical_economic_events (event_name, event_time desc);

create index if not exists idx_historical_economic_events_date_currency
  on historical_economic_events (event_date, currency);

create index if not exists idx_historical_economic_events_manifest
  on historical_economic_events (source_manifest_id);
