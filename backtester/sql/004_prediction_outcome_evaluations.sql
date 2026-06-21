create table if not exists research_prediction_evaluations (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references research_observations(id) on delete cascade,
  verdict_id uuid not null references research_agent_verdicts(id) on delete cascade,
  prediction_id uuid not null references research_timeframe_predictions(id) on delete cascade,
  asset_code text not null,
  evaluated_market text not null,
  timeframe text not null references research_timeframes(code),
  call_date date not null,
  call_day_of_week text not null,
  call_time_et timestamptz not null,
  open_time_et timestamptz,
  close_time_et timestamptz,
  open_price numeric,
  close_price numeric,
  pct_change numeric,
  abs_pct_change numeric,
  flat_threshold_used numeric not null,
  move_magnitude_bucket text,
  conviction_bucket text,
  conviction_move_alignment text,
  evaluation_quality text,
  expected_move_threshold numeric,
  exceeded_expected_move boolean,
  calibration_notes text,
  market_outcome_direction text,
  agent_direction text,
  agent_conviction numeric,
  result text not null,
  result_reason text,
  evaluation_version text not null,
  evaluation_mode text not null default 'primary',
  market_relationship text not null default 'direct',
  evaluation_payload jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint research_prediction_evaluations_day_of_week_check
    check (call_day_of_week in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),

  constraint research_prediction_evaluations_market_outcome_direction_check
    check (market_outcome_direction is null or market_outcome_direction in ('BULLISH', 'BEARISH', 'FLAT')),

  constraint research_prediction_evaluations_move_magnitude_bucket_check
    check (
      move_magnitude_bucket is null or
      move_magnitude_bucket in ('FLAT_NOISE', 'SMALL_MOVE', 'MEDIUM_MOVE', 'LARGE_MOVE')
    ),

  constraint research_prediction_evaluations_conviction_bucket_check
    check (
      conviction_bucket is null or
      conviction_bucket in ('LOW_CONVICTION', 'MODERATE_CONVICTION', 'HIGH_CONVICTION', 'VERY_HIGH_CONVICTION', 'UNKNOWN_CONVICTION')
    ),

  constraint research_prediction_evaluations_conviction_move_alignment_check
    check (
      conviction_move_alignment is null or
      conviction_move_alignment in ('ALIGNED_STRONG', 'ALIGNED_MODEST', 'OVERCONFIDENT', 'UNDERCONFIDENT', 'NEUTRAL')
    ),

  constraint research_prediction_evaluations_quality_check
    check (
      evaluation_quality is null or
      evaluation_quality in ('EXCELLENT', 'GOOD', 'WEAK_CORRECT', 'WRONG', 'FLAT', 'NO_CALL', 'NOT_EVALUABLE', 'MIXED')
    ),

  constraint research_prediction_evaluations_result_check
    check (result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED', 'NO_CALL', 'NOT_EVALUABLE')),

  constraint research_prediction_evaluations_evaluation_mode_check
    check (evaluation_mode in ('primary', 'contextual', 'secondary')),

  constraint research_prediction_evaluations_market_relationship_check
    check (market_relationship in ('direct', 'inverse', 'contextual')),

  constraint research_prediction_evaluations_time_order_check
    check (
      open_time_et is null or
      close_time_et is null or
      open_time_et <= close_time_et
    )
);

comment on table research_prediction_evaluations is
'Deterministic Phase 1 market outcome scoring table. One row represents one replayed prediction evaluated against one concrete market using the locked America/New_York window rules.';

comment on column research_prediction_evaluations.prediction_id is
'References one research_timeframe_predictions row. Every replayed verdict should create one prediction per active timeframe, and that prediction can then be evaluated against one or more markets.';

comment on column research_prediction_evaluations.evaluated_market is
'Concrete evaluation market such as DXY, EURUSD, XAUUSD, QQQ_NQ_PROXY, or BTCUSD.';

comment on column research_prediction_evaluations.call_time_et is
'Original replay call timestamp stored as an ET-anchored instant for deterministic Phase 1 windowing.';

comment on column research_prediction_evaluations.open_time_et is
'ET window open used for outcome measurement.';

comment on column research_prediction_evaluations.close_time_et is
'ET window close used for outcome measurement.';

comment on column research_prediction_evaluations.flat_threshold_used is
'Absolute percent-change band inside which the realised move is classified as FLAT for this market.';

comment on column research_prediction_evaluations.move_magnitude_bucket is
'Phase 1 realised move bucket derived from abs_pct_change versus the market flat threshold.';

comment on column research_prediction_evaluations.conviction_bucket is
'Phase 1 conviction bucket used for calibration and expected-move analysis.';

comment on column research_prediction_evaluations.conviction_move_alignment is
'Calibration label indicating whether conviction and realised move size were aligned, overconfident, or underconfident.';

comment on column research_prediction_evaluations.evaluation_quality is
'Higher-level quality label that distinguishes strong correct calls from weak or flat correct calls.';

comment on column research_prediction_evaluations.market_relationship is
'How the evaluated market maps to the agent call: direct, inverse, or contextual.';

comment on column research_prediction_evaluations.result is
'Final deterministic scoring label for this market evaluation row.';

create unique index if not exists idx_research_prediction_evaluations_unique
  on research_prediction_evaluations (prediction_id, evaluated_market, evaluation_version);

create index if not exists idx_research_prediction_evaluations_timeframe_result
  on research_prediction_evaluations (timeframe, result);

create index if not exists idx_research_prediction_evaluations_day_of_week
  on research_prediction_evaluations (call_day_of_week, timeframe, result);

create index if not exists idx_research_prediction_evaluations_asset_market
  on research_prediction_evaluations (asset_code, evaluated_market, timeframe);

create index if not exists idx_research_prediction_evaluations_prediction
  on research_prediction_evaluations (prediction_id);
