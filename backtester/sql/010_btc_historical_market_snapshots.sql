create table if not exists historical_btc_market_snapshots (
  id uuid primary key default gen_random_uuid(),

  asset_code text not null default 'BTC',
  observation_time timestamptz not null,
  snapshot_date date not null,
  snapshot_timezone text not null default 'UTC',
  snapshot_mode text not null default 'historical_reconstruction',

  raw_vix_level numeric,
  raw_dxy_level numeric,
  raw_us_10y_real_yield numeric,
  raw_btc_price numeric,
  raw_nq_price numeric,
  raw_crypto_fear_greed numeric,
  raw_btc_etf_net_flow_usd numeric,

  vix_level numeric,
  vix_d1 numeric,
  vix_d5 numeric,

  dxy_level numeric,
  dxy_d1 numeric,
  dxy_d5 numeric,
  dxy_d20 numeric,

  us_10y_real_yield numeric,
  us_10y_real_yield_d5_bps numeric,
  us_10y_real_yield_d20_bps numeric,

  btc_price numeric,
  btc_d1_pct numeric,
  btc_d5_pct numeric,
  btc_d20_pct numeric,

  nq_price numeric,
  nq_d1_pct numeric,
  nq_d5_pct numeric,
  nq_d20_pct numeric,

  btc_etf_net_flow_1d_usd numeric,
  btc_etf_net_flow_5d_usd numeric,
  btc_etf_net_flow_20d_usd numeric,

  crypto_fear_greed numeric,

  btc_dominance numeric,
  btc_dominance_d5 numeric,
  btc_dominance_d20 numeric,

  total_crypto_market_cap numeric,
  total_crypto_market_cap_d5_pct numeric,
  total_crypto_market_cap_d20_pct numeric,

  stablecoin_supply numeric,
  stablecoin_supply_d5_pct numeric,
  stablecoin_supply_d20_pct numeric,

  latest_us_event jsonb,
  latest_us_event_event text,
  latest_us_event_time timestamptz,
  latest_us_event_actual numeric,
  latest_us_event_forecast numeric,
  latest_us_event_previous numeric,
  latest_us_event_surprise text,
  latest_us_event_usd_signal text,
  latest_us_event_impact text,
  latest_us_event_source text,
  latest_us_event_age_hours numeric,

  fed_bias text,
  fed_bias_score integer,
  fed_bias_reasons jsonb not null default '[]'::jsonb,
  upcoming_events jsonb not null default '[]'::jsonb,

  equities_regime text,

  collector_version text not null,
  snapshot_schema_version text not null,
  reconstruction_logic_version text not null,
  logic_document text not null default 'agent_btc_direction.md',
  logic_document_version text not null,
  source_bundle_version text,
  source_vendor_manifest jsonb not null default '{}'::jsonb,
  reconstructed_at timestamptz not null default now(),
  reconstruction_notes text,

  source_status text not null,
  event_coverage_status text,
  market_data_coverage_status text,
  missing_inputs jsonb not null default '[]'::jsonb,
  missing_raw_series jsonb not null default '[]'::jsonb,
  history_rows_used jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  quality_notes jsonb not null default '[]'::jsonb,
  is_reconstructable_following_24hrs boolean not null default false,
  is_reconstructable_3d_from_call boolean not null default false,
  is_reconstructable_current_week boolean not null default false,
  is_reconstructable_next_week boolean not null default false,
  is_reconstructable_current_month boolean not null default false,

  raw_event_payload jsonb not null default '{}'::jsonb,
  raw_market_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint historical_btc_market_snapshots_asset_code_check
    check (asset_code = 'BTC'),

  constraint historical_btc_market_snapshots_snapshot_mode_check
    check (snapshot_mode in ('historical_reconstruction', 'forward')),

  constraint historical_btc_market_snapshots_fed_bias_check
    check (fed_bias is null or fed_bias in ('hawkish', 'dovish', 'neutral', 'unknown')),

  constraint historical_btc_market_snapshots_equities_regime_check
    check (equities_regime is null or equities_regime in ('risk_on', 'risk_off', 'neutral')),

  constraint historical_btc_market_snapshots_source_status_check
    check (source_status in ('collected', 'partial', 'missing', 'reconstructed')),

  constraint historical_btc_market_snapshots_latest_us_event_age_hours_check
    check (latest_us_event_age_hours is null or latest_us_event_age_hours >= 0),

  constraint historical_btc_market_snapshots_observation_unique
    unique (asset_code, observation_time)
);

create index if not exists idx_historical_btc_market_snapshots_observation_time
  on historical_btc_market_snapshots (observation_time desc);

create index if not exists idx_historical_btc_market_snapshots_snapshot_date
  on historical_btc_market_snapshots (snapshot_date desc);

create index if not exists idx_historical_btc_market_snapshots_reconstructable
  on historical_btc_market_snapshots (
    is_reconstructable_following_24hrs,
    is_reconstructable_3d_from_call,
    is_reconstructable_current_week,
    is_reconstructable_next_week,
    is_reconstructable_current_month
  );

create index if not exists idx_historical_btc_market_snapshots_logic_version
  on historical_btc_market_snapshots (logic_document_version, reconstruction_logic_version);
