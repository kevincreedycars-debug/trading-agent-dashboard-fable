create extension if not exists pgcrypto;

create table if not exists research_timeframes (
  code text primary key,
  sort_order integer not null unique
);

insert into research_timeframes (code, sort_order)
values
  ('12hr', 1),
  ('current day', 2),
  ('following 24hrs', 3),
  ('3d from call', 4),
  ('current week', 5),
  ('following week', 6),
  ('current month', 7),
  ('following month', 8)
on conflict (code) do update
set sort_order = excluded.sort_order;

create table if not exists research_observations (
  id uuid primary key default gen_random_uuid(),
  observation_time timestamptz not null,
  snapshot_date date,
  agent_name text not null,
  asset_code text not null,
  layer integer not null default 1,
  source_workflow text,
  source_run_id text,
  source_snapshot_id text,
  market_status text,
  weekend_rule_active boolean,
  market_snapshot jsonb not null,
  market_regime jsonb,
  warnings jsonb,
  missing_inputs jsonb,
  data_quality jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_observations_agent_time
  on research_observations (agent_name, observation_time desc);

create index if not exists idx_research_observations_asset_time
  on research_observations (asset_code, observation_time desc);

create table if not exists research_model_contexts (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  logic_document text,
  logic_document_version text,
  collector_versions jsonb,
  prompt_version text,
  weight_model_version text,
  conviction_model_version text,
  workflow_version_id text,
  repo_commit_sha text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_research_model_contexts_observation
  on research_model_contexts (observation_id);

create table if not exists research_agent_verdicts (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  agent_name text not null,
  reasoning_summary text,
  raw_agent_output jsonb not null,
  full_output jsonb,
  score_bullish numeric,
  score_bearish numeric,
  score_neutral numeric,
  verdict_status text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_research_agent_verdicts_observation
  on research_agent_verdicts (observation_id);

create table if not exists research_timeframe_predictions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  agent_verdict_id uuid not null references research_agent_verdicts(id) on delete cascade,
  timeframe text references research_timeframes(code),
  legacy_timeframe_key text,
  mapping_status text not null,
  mapping_notes text,
  predicted_direction text not null,
  predicted_conviction numeric,
  bull_case_pct numeric,
  bear_case_pct numeric,
  net_edge_pct numeric,
  participation_pct numeric,
  neutral_pct numeric,
  verdict_strength text,
  reason_text text,
  weighted_score jsonb,
  conviction_model jsonb,
  prediction_status text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_research_timeframe_predictions_unique
  on research_timeframe_predictions (observation_id, legacy_timeframe_key);

create index if not exists idx_research_timeframe_predictions_timeframe
  on research_timeframe_predictions (timeframe);

create table if not exists research_factor_observations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  agent_verdict_id uuid not null references research_agent_verdicts(id) on delete cascade,
  timeframe_prediction_id uuid not null references research_timeframe_predictions(id) on delete cascade,
  timeframe text references research_timeframes(code),
  legacy_timeframe_key text,
  mapping_status text,
  factor_key text not null,
  factor_name text,
  factor_signal text,
  factor_weight numeric,
  factor_reason text,
  factor_evidence text,
  factor_family text,
  factor_payload jsonb,
  observation_order integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_factor_observations_lookup
  on research_factor_observations (factor_key, timeframe, factor_signal);

create index if not exists idx_research_factor_observations_observation
  on research_factor_observations (observation_id);

create table if not exists research_realised_outcomes (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  timeframe_prediction_id uuid not null references research_timeframe_predictions(id) on delete cascade,
  timeframe text references research_timeframes(code),
  evaluation_status text not null,
  entry_time timestamptz,
  horizon_end_time timestamptz,
  settlement_time timestamptz,
  entry_price numeric,
  exit_price numeric,
  realised_return_pct numeric,
  realised_direction text,
  outcome_label text,
  settlement_source text,
  settlement_payload jsonb,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_research_realised_outcomes_prediction
  on research_realised_outcomes (timeframe_prediction_id);

create table if not exists research_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  timeframe_prediction_id uuid references research_timeframe_predictions(id) on delete cascade,
  review_type text not null,
  reviewer text,
  review_summary text,
  review_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_ai_reviews_observation
  on research_ai_reviews (observation_id, created_at desc);

create table if not exists research_optimization_runs (
  id uuid primary key default gen_random_uuid(),
  run_name text not null,
  run_type text not null,
  scope jsonb,
  baseline_context jsonb,
  candidate_context jsonb,
  summary text,
  result_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists research_optimization_findings (
  id uuid primary key default gen_random_uuid(),
  optimization_run_id uuid not null references research_optimization_runs(id) on delete cascade,
  observation_id uuid references research_observations(id) on delete set null,
  timeframe_prediction_id uuid references research_timeframe_predictions(id) on delete set null,
  factor_key text,
  finding_type text not null,
  finding_summary text,
  finding_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_optimization_findings_run
  on research_optimization_findings (optimization_run_id);
