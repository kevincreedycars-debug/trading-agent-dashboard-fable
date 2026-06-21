create table if not exists historical_usd_market_snapshots (
  id uuid primary key default gen_random_uuid(),

  -- Identity / scope
  asset_code text not null default 'USD',
  observation_time timestamptz not null,
  snapshot_date date not null,
  snapshot_timezone text not null default 'America/New_York',
  snapshot_mode text not null default 'historical_reconstruction',

  -- Raw imported fields
  raw_us_2y_yield numeric,
  raw_us_10y_yield numeric,
  raw_us_10y_real_yield numeric,
  raw_de_2y_yield numeric,
  raw_de_10y_yield numeric,
  raw_vix_level numeric,
  raw_dxy_level numeric,
  raw_gold_price numeric,
  raw_nq_price numeric,
  raw_nq_d1_pct_vendor numeric,
  raw_btc_price numeric,
  raw_wti_price numeric,
  raw_brent_price numeric,
  raw_eurusd_level numeric,
  raw_us_jp_10y_proxy numeric,
  raw_uk_10y_proxy numeric,

  -- Derived agent-ready fields
  vix_level numeric,
  vix_d1 numeric,
  vix_d5 numeric,

  us_2y_yield numeric,
  us_2y_d5_bps numeric,
  us_2y_d20_bps numeric,

  de_2y_yield numeric,
  de_2y_d5_bps numeric,

  us_de_2y_spread numeric,
  us_de_2y_spread_d5_bps numeric,

  us_10y_yield numeric,
  us_10y_d5_bps numeric,

  us_10y_real_yield numeric,
  us_10y_real_yield_d5_bps numeric,
  us_10y_real_yield_d20_bps numeric,

  dxy_level numeric,
  dxy_d1 numeric,
  dxy_d5 numeric,
  dxy_d20 numeric,

  gold_price numeric,
  gold_d1_pct numeric,
  gold_d5_pct numeric,
  gold_d20_pct numeric,

  nq_price numeric,
  nq_d1_pct numeric,
  nq_d5_pct numeric,
  nq_d20_pct numeric,

  equities_regime text,
  global_growth_context text,
  dxy_trend_alignment_5d_20d text,
  us_2y_trend_alignment_5d_20d text,
  real_yield_trend_alignment_5d_20d text,

  -- Event / context fields
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

  surprise_score numeric,

  fed_bias text,
  fed_bias_score integer,
  fed_bias_reasons jsonb not null default '[]'::jsonb,

  upcoming_events jsonb not null default '[]'::jsonb,
  next_tier1_us_event_time timestamptz,
  next_tier1_us_event_name text,
  tier1_event_due_next_24h boolean not null default false,
  tier1_events_due_next_3d_count integer not null default 0,
  recent_us_event_within_72h boolean not null default false,

  -- Version / lineage fields
  collector_version text not null,
  snapshot_schema_version text not null,
  reconstruction_logic_version text not null,
  logic_document text not null default 'agent_usd_direction.md',
  logic_document_version text not null,
  prompt_version text,
  weight_model_version text,
  conviction_model_version text,
  source_bundle_version text,
  source_vendor_manifest jsonb not null default '{}'::jsonb,
  reconstructed_at timestamptz not null default now(),
  reconstruction_notes text,

  -- Data quality fields
  source_status text not null,
  collector_status text,
  missing_inputs jsonb not null default '[]'::jsonb,
  missing_raw_series jsonb not null default '[]'::jsonb,
  derived_with_fallbacks jsonb not null default '[]'::jsonb,
  history_rows_used jsonb not null default '{}'::jsonb,
  event_coverage_status text,
  market_data_coverage_status text,
  warnings jsonb not null default '[]'::jsonb,
  quality_notes jsonb not null default '[]'::jsonb,
  is_reconstructable_following_24hrs boolean not null default false,
  is_reconstructable_3d_from_call boolean not null default false,
  is_reconstructable_current_week boolean not null default false,
  is_reconstructable_current_month boolean not null default false,

  -- Compatibility / trace payload
  raw_event_payload jsonb not null default '{}'::jsonb,
  raw_market_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint historical_usd_market_snapshots_asset_code_check
    check (asset_code = 'USD'),

  constraint historical_usd_market_snapshots_snapshot_mode_check
    check (snapshot_mode in ('historical_reconstruction', 'forward')),

  constraint historical_usd_market_snapshots_fed_bias_check
    check (fed_bias is null or fed_bias in ('hawkish', 'dovish', 'neutral', 'unknown')),

  constraint historical_usd_market_snapshots_equities_regime_check
    check (equities_regime is null or equities_regime in ('risk_on', 'risk_off', 'neutral')),

  constraint historical_usd_market_snapshots_source_status_check
    check (source_status in ('collected', 'partial', 'missing', 'reconstructed')),

  constraint historical_usd_market_snapshots_tier1_events_due_next_3d_count_check
    check (tier1_events_due_next_3d_count >= 0),

  constraint historical_usd_market_snapshots_latest_us_event_age_hours_check
    check (latest_us_event_age_hours is null or latest_us_event_age_hours >= 0),

  constraint historical_usd_market_snapshots_observation_unique
    unique (asset_code, observation_time)
);

comment on table historical_usd_market_snapshots is
'USD historical reconstruction snapshot table for Phase 1 backtesting. One row captures the agent-ready market state at a decision timestamp using daily/near-daily historical data. This table is downstream-only, does not modify live Layer 1 workflows, and is designed to feed the observation-first research schema.';

comment on column historical_usd_market_snapshots.asset_code is
'Phase 1 is USD-only. Constrained to USD to keep the reconstruction schema explicit and reviewable.';

comment on column historical_usd_market_snapshots.observation_time is
'Decision timestamp for the reconstructed USD observation. This is the parent time reference for later observation creation.';

comment on column historical_usd_market_snapshots.snapshot_mode is
'historical_reconstruction for rebuilt history, forward for future-compatible snapshots if the same schema is later used prospectively.';

comment on column historical_usd_market_snapshots.raw_us_2y_yield is
'Imported raw daily source value before derived deltas are computed. Source expected: FRED DGS2.';

comment on column historical_usd_market_snapshots.raw_de_2y_yield is
'Imported raw Germany 2Y historical source value before relative-rate derivations. Source expected: Bundesbank or equivalent historical series.';

comment on column historical_usd_market_snapshots.vix_d1 is
'Derived 1-day VIX change used by USD Factor 1 and short-horizon reconstruction.';

comment on column historical_usd_market_snapshots.us_de_2y_spread_d5_bps is
'Derived 5-day change in the US-Germany 2Y spread. This is a key USD relative-rates driver in the live logic.';

comment on column historical_usd_market_snapshots.latest_us_event_event is
'Latest significant US event visible at the observation timestamp, used for Factor 7 reconstruction.';

comment on column historical_usd_market_snapshots.fed_bias is
'Derived historical Fed-bias state at observation time, used for Factor 8 and structural USD reconstruction.';

comment on column historical_usd_market_snapshots.tier1_event_due_next_24h is
'Helper flag for conviction adjustment on the following-24hrs horizon.';

comment on column historical_usd_market_snapshots.collector_version is
'Version label for the historical snapshot construction logic, separate from live collector versions.';

comment on column historical_usd_market_snapshots.reconstruction_logic_version is
'Version label for the deterministic historical rebuild process.';

comment on column historical_usd_market_snapshots.logic_document_version is
'USD logic version this reconstructed snapshot is intended to support.';

comment on column historical_usd_market_snapshots.is_reconstructable_following_24hrs is
'True when the row has sufficient data quality to support following-24hrs USD reconstruction.';

comment on column historical_usd_market_snapshots.is_reconstructable_current_month is
'True when the row has sufficient 20-day and context coverage to support current-month USD reconstruction.';

create index if not exists idx_historical_usd_market_snapshots_observation_time
  on historical_usd_market_snapshots (observation_time desc);

create index if not exists idx_historical_usd_market_snapshots_snapshot_date
  on historical_usd_market_snapshots (snapshot_date desc);

create index if not exists idx_historical_usd_market_snapshots_reconstructable
  on historical_usd_market_snapshots (
    is_reconstructable_following_24hrs,
    is_reconstructable_3d_from_call,
    is_reconstructable_current_week,
    is_reconstructable_current_month
  );

create index if not exists idx_historical_usd_market_snapshots_logic_version
  on historical_usd_market_snapshots (logic_document_version, reconstruction_logic_version);

create index if not exists idx_historical_usd_market_snapshots_source_status
  on historical_usd_market_snapshots (source_status, market_data_coverage_status, event_coverage_status);

create index if not exists idx_historical_usd_market_snapshots_fed_bias
  on historical_usd_market_snapshots (fed_bias, observation_time desc);

create index if not exists idx_historical_usd_market_snapshots_regime
  on historical_usd_market_snapshots (equities_regime, observation_time desc);

create index if not exists idx_historical_usd_market_snapshots_next_event
  on historical_usd_market_snapshots (next_tier1_us_event_time);
