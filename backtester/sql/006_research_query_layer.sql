create or replace view research_prediction_primary_summary as
with primary_evaluations as (
  select
    e.prediction_id,
    e.observation_id,
    e.verdict_id,
    e.asset_code,
    e.timeframe,
    min(e.call_date) as call_date,
    min(e.call_day_of_week) as call_day_of_week,
    min(e.call_time_et) as call_time_et,
    min(e.conviction_bucket) as conviction_bucket,
    min(e.move_magnitude_bucket) as move_magnitude_bucket,
    min(e.agent_conviction) as agent_conviction,
    count(*) as primary_market_count,
    count(*) filter (where e.result = 'CORRECT') as correct_count,
    count(*) filter (where e.result = 'WRONG') as wrong_count,
    count(*) filter (where e.result = 'FLAT') as flat_count,
    count(*) filter (where e.result = 'NO_CALL') as no_call_count,
    count(*) filter (where e.result = 'NOT_EVALUABLE') as not_evaluable_count,
    avg(e.pct_change) as avg_pct_change,
    avg(e.abs_pct_change) as avg_abs_pct_change,
    max(e.abs_pct_change) as max_abs_pct_change
  from research_prediction_evaluations e
  where e.evaluation_mode = 'primary'
  group by
    e.prediction_id,
    e.observation_id,
    e.verdict_id,
    e.asset_code,
    e.timeframe
)
select
  p.prediction_id,
  p.observation_id,
  p.verdict_id,
  p.asset_code,
  p.timeframe,
  p.call_date,
  p.call_day_of_week,
  p.call_time_et,
  p.conviction_bucket,
  p.move_magnitude_bucket,
  p.agent_conviction,
  p.primary_market_count,
  p.correct_count,
  p.wrong_count,
  p.flat_count,
  p.no_call_count,
  p.not_evaluable_count,
  p.avg_pct_change,
  p.avg_abs_pct_change,
  p.max_abs_pct_change,
  ro.snapshot_date,
  tp.predicted_direction,
  tp.predicted_conviction,
  tp.verdict_strength,
  coalesce(ro.market_regime ->> 'equities_regime', ro.market_snapshot ->> 'equities_regime') as equities_regime,
  coalesce(ro.market_regime ->> 'fed_bias', ro.market_snapshot ->> 'fed_bias') as fed_bias,
  case
    when p.correct_count > 0 and p.wrong_count = 0 and p.flat_count = 0 and p.no_call_count = 0 and p.not_evaluable_count = 0 then 'CORRECT'
    when p.wrong_count > 0 and p.correct_count = 0 and p.flat_count = 0 and p.no_call_count = 0 and p.not_evaluable_count = 0 then 'WRONG'
    when p.flat_count > 0 and p.correct_count = 0 and p.wrong_count = 0 and p.no_call_count = 0 and p.not_evaluable_count = 0 then 'FLAT'
    when p.no_call_count > 0 and p.correct_count = 0 and p.wrong_count = 0 and p.flat_count = 0 and p.not_evaluable_count = 0 then 'NO_CALL'
    when p.not_evaluable_count > 0 and p.correct_count = 0 and p.wrong_count = 0 and p.flat_count = 0 and p.no_call_count = 0 then 'NOT_EVALUABLE'
    else 'MIXED'
  end as combined_result,
  case
    when p.correct_count > 0 and p.wrong_count = 0 and p.flat_count = 0 and p.no_call_count = 0 and p.not_evaluable_count = 0 then 1
    else 0
  end as is_win,
  case
    when p.wrong_count > 0 and p.correct_count = 0 and p.flat_count = 0 and p.no_call_count = 0 and p.not_evaluable_count = 0 then 1
    else 0
  end as is_loss
from primary_evaluations p
join research_timeframe_predictions tp
  on tp.id = p.prediction_id
join research_observations ro
  on ro.id = p.observation_id
;

comment on view research_prediction_primary_summary is
'Primary-market combined research scoring layer. One row represents one prediction summarized across its primary evaluation markets, which prevents USD multi-market rows from double-counting win-rate analysis.';

create or replace view research_overall_win_rate as
select
  count(*) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_prediction_primary_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED');

create or replace view research_win_rate_by_timeframe as
select
  timeframe,
  count(*) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_prediction_primary_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by timeframe
order by timeframe;

create or replace view research_win_rate_by_conviction_bucket as
select
  coalesce(conviction_bucket, 'UNKNOWN') as conviction_bucket,
  count(*) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    avg(agent_conviction)::numeric,
    2
  ) as avg_conviction,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_prediction_primary_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by coalesce(conviction_bucket, 'UNKNOWN')
order by
  case coalesce(conviction_bucket, 'UNKNOWN')
    when 'LOW_CONVICTION' then 1
    when 'MODERATE_CONVICTION' then 2
    when 'HIGH_CONVICTION' then 3
    when 'VERY_HIGH_CONVICTION' then 4
    else 5
  end;

create or replace view research_win_rate_by_weekday as
select
  call_day_of_week,
  count(*) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_prediction_primary_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by call_day_of_week
order by
  case call_day_of_week
    when 'Monday' then 1
    when 'Tuesday' then 2
    when 'Wednesday' then 3
    when 'Thursday' then 4
    when 'Friday' then 5
    when 'Saturday' then 6
    when 'Sunday' then 7
    else 8
  end;

create or replace view research_win_rate_by_magnitude_bucket as
select
  coalesce(move_magnitude_bucket, 'UNKNOWN') as move_magnitude_bucket,
  count(*) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    avg(avg_abs_pct_change)::numeric,
    4
  ) as avg_abs_move_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_prediction_primary_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by coalesce(move_magnitude_bucket, 'UNKNOWN')
order by
  case coalesce(move_magnitude_bucket, 'UNKNOWN')
    when 'FLAT_NOISE' then 1
    when 'SMALL_MOVE' then 2
    when 'MEDIUM_MOVE' then 3
    when 'LARGE_MOVE' then 4
    else 5
  end;

create or replace view research_win_rate_by_market_regime as
select
  coalesce(equities_regime, 'UNKNOWN') as equities_regime,
  coalesce(fed_bias, 'UNKNOWN') as fed_bias,
  count(*) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_prediction_primary_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by
  coalesce(equities_regime, 'UNKNOWN'),
  coalesce(fed_bias, 'UNKNOWN')
order by equities_regime, fed_bias;

create or replace view research_factor_reliability as
select
  fo.factor_key,
  fo.factor_name,
  fo.timeframe,
  fo.factor_signal,
  count(*) as factor_occurrences,
  count(*) filter (where ps.combined_result = 'CORRECT') as wins,
  count(*) filter (where ps.combined_result = 'WRONG') as losses,
  count(*) filter (where ps.combined_result = 'FLAT') as flats,
  count(*) filter (where ps.combined_result = 'MIXED') as mixed,
  round(avg(fo.factor_weight)::numeric, 2) as avg_factor_weight,
  round(
    100.0 * count(*) filter (where ps.combined_result = 'CORRECT')
    / nullif(count(*) filter (where ps.combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from research_factor_observations fo
join research_prediction_primary_summary ps
  on ps.prediction_id = fo.timeframe_prediction_id
where
  fo.factor_signal in ('BULLISH', 'BEARISH')
  and ps.combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by
  fo.factor_key,
  fo.factor_name,
  fo.timeframe,
  fo.factor_signal;

create or replace view research_factor_contribution as
select
  fo.factor_key,
  fo.factor_name,
  fo.timeframe,
  fo.factor_signal,
  count(*) as factor_occurrences,
  round(avg(fo.factor_weight)::numeric, 2) as avg_factor_weight,
  round(avg(ps.agent_conviction)::numeric, 2) as avg_prediction_conviction,
  round(avg(case
    when ps.combined_result = 'CORRECT' then 1.0
    when ps.combined_result = 'WRONG' then -1.0
    else 0.0
  end)::numeric, 4) as contribution_score,
  round(avg(case
    when ps.combined_result = 'CORRECT' then fo.factor_weight
    when ps.combined_result = 'WRONG' then -fo.factor_weight
    else 0.0
  end)::numeric, 4) as weighted_contribution_score
from research_factor_observations fo
join research_prediction_primary_summary ps
  on ps.prediction_id = fo.timeframe_prediction_id
where
  fo.factor_signal in ('BULLISH', 'BEARISH')
  and ps.combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
group by
  fo.factor_key,
  fo.factor_name,
  fo.timeframe,
  fo.factor_signal;

create or replace view research_best_factor_combinations as
with directional_factors as (
  select
    fo.timeframe_prediction_id,
    fo.timeframe,
    fo.factor_key,
    fo.factor_signal,
    fo.factor_weight
  from research_factor_observations fo
  join research_prediction_primary_summary ps
    on ps.prediction_id = fo.timeframe_prediction_id
  where
    fo.factor_signal in ('BULLISH', 'BEARISH')
    and ps.combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')
),
factor_pairs as (
  select
    left_side.timeframe_prediction_id,
    left_side.timeframe,
    left_side.factor_key as factor_key_1,
    left_side.factor_signal as factor_signal_1,
    left_side.factor_weight as factor_weight_1,
    right_side.factor_key as factor_key_2,
    right_side.factor_signal as factor_signal_2,
    right_side.factor_weight as factor_weight_2
  from directional_factors left_side
  join directional_factors right_side
    on right_side.timeframe_prediction_id = left_side.timeframe_prediction_id
   and right_side.factor_key > left_side.factor_key
)
select
  fp.timeframe,
  fp.factor_key_1,
  fp.factor_signal_1,
  fp.factor_key_2,
  fp.factor_signal_2,
  count(*) as combo_occurrences,
  count(*) filter (where ps.combined_result = 'CORRECT') as wins,
  count(*) filter (where ps.combined_result = 'WRONG') as losses,
  count(*) filter (where ps.combined_result = 'FLAT') as flats,
  count(*) filter (where ps.combined_result = 'MIXED') as mixed,
  round(avg(fp.factor_weight_1 + fp.factor_weight_2)::numeric, 2) as avg_combined_weight,
  round(
    100.0 * count(*) filter (where ps.combined_result = 'CORRECT')
    / nullif(count(*) filter (where ps.combined_result in ('CORRECT', 'WRONG', 'FLAT', 'MIXED')), 0),
    2
  ) as win_rate_pct
from factor_pairs fp
join research_prediction_primary_summary ps
  on ps.prediction_id = fp.timeframe_prediction_id
group by
  fp.timeframe,
  fp.factor_key_1,
  fp.factor_signal_1,
  fp.factor_key_2,
  fp.factor_signal_2
having count(*) >= 3
order by
  win_rate_pct desc nulls last,
  combo_occurrences desc,
  avg_combined_weight desc;

create or replace view research_dashboard_infrastructure_status as
with warehouse as (
  select
    (select count(*) from historical_macro_series) as macro_series_rows,
    (select count(*) from historical_price_series) as price_series_rows,
    (select count(*) from historical_economic_events) as economic_event_rows,
    (select count(*) from historical_usd_market_snapshots) as snapshot_rows
),
replay as (
  select
    count(*) as observation_count,
    min(snapshot_date) as first_replay_date,
    max(snapshot_date) as last_replay_date
  from research_observations
  where agent_name = 'USD'
    and asset_code = 'USD'
),
predictions as (
  select count(*) as prediction_count
  from research_timeframe_predictions tp
  join research_observations ro
    on ro.id = tp.observation_id
  where ro.agent_name = 'USD'
    and ro.asset_code = 'USD'
),
evaluations as (
  select count(*) as evaluation_row_count
  from research_prediction_evaluations e
  join research_observations ro
    on ro.id = e.observation_id
  where ro.agent_name = 'USD'
    and ro.asset_code = 'USD'
),
outcomes as (
  select count(*) as realised_outcome_count
  from research_realised_outcomes r
  join research_observations ro
    on ro.id = r.observation_id
  where ro.agent_name = 'USD'
    and ro.asset_code = 'USD'
),
views_ready as (
  select exists(select 1 from research_overall_win_rate) as research_sql_ready
)
select
  case
    when (macro_series_rows + price_series_rows + economic_event_rows) > 0 then 'Complete'
    else 'Not yet available'
  end as historical_warehouse_status,
  case
    when snapshot_rows > 0 then 'Complete'
    else 'Not yet available'
  end as snapshot_builder_status,
  case
    when observation_count > 0 and prediction_count > 0 then 'Complete'
    else 'Not yet available'
  end as replay_engine_status,
  case
    when evaluation_row_count > 0 and realised_outcome_count > 0 then 'Complete'
    else 'Not yet available'
  end as outcome_evaluation_status,
  case
    when research_sql_ready then 'Complete'
    else 'Not yet available'
  end as research_sql_status,
  macro_series_rows,
  price_series_rows,
  economic_event_rows,
  snapshot_rows,
  first_replay_date,
  last_replay_date,
  case
    when first_replay_date is not null and last_replay_date is not null
      then first_replay_date::text || ' to ' || last_replay_date::text
    else null
  end as replay_coverage,
  observation_count,
  prediction_count,
  evaluation_row_count,
  realised_outcome_count
from warehouse
cross join replay
cross join predictions
cross join evaluations
cross join outcomes
cross join views_ready;
