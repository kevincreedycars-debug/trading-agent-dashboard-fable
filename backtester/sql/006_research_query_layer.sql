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
'Primary-market combined research scoring layer. One row represents one prediction summarized across its primary evaluation markets. For USD Phase 2 this basket summary is diagnostic only and is not the headline benchmark accuracy surface.';

create or replace view research_prediction_usd_benchmark_summary as
with base as (
  select
    e.prediction_id,
    e.observation_id,
    e.verdict_id,
    e.asset_code,
    e.timeframe,
    e.call_date,
    e.call_day_of_week,
    e.call_time_et,
    e.conviction_bucket,
    e.move_magnitude_bucket,
    e.agent_conviction,
    e.open_price,
    e.close_price,
    e.pct_change,
    e.abs_pct_change,
    e.market_outcome_direction,
    e.agent_direction,
    e.result as combined_result,
    e.result_reason,
    e.evaluated_market as benchmark_market,
    e.market_relationship,
    e.evaluation_mode,
    ro.snapshot_date,
    tp.predicted_direction,
    tp.predicted_conviction,
    tp.verdict_strength,
    coalesce(ro.market_regime ->> 'equities_regime', ro.market_snapshot ->> 'equities_regime') as equities_regime,
    coalesce(ro.market_regime ->> 'fed_bias', ro.market_snapshot ->> 'fed_bias') as fed_bias,
    tp.bull_case_pct,
    tp.bear_case_pct,
    tp.net_edge_pct,
    tp.participation_pct
  from research_prediction_evaluations e
  join research_timeframe_predictions tp
    on tp.id = e.prediction_id
  join research_observations ro
    on ro.id = e.observation_id
  where
    ro.agent_name = 'USD'
    and ro.asset_code = 'USD'
    and e.evaluation_mode = 'primary'
    and e.evaluated_market = 'DXY'
),
scored as (
  select
    *,
    case
      when bull_case_pct is null or bear_case_pct is null or net_edge_pct is null or participation_pct is null then null
      else round(
        greatest(
          0,
          least(
            100,
            (
              (greatest(bull_case_pct, bear_case_pct) * 0.45) +
              (participation_pct * 0.35) +
              (abs(net_edge_pct) * 0.20) -
              (case when participation_pct < 25 then 30 when participation_pct < 40 then 10 else 0 end) -
              (case when abs(net_edge_pct) < 20 then 10 else 0 end)
            )
          )
        )::numeric,
        0
      )
    end as headline_confidence_pct
  from base
)
select
  prediction_id,
  observation_id,
  verdict_id,
  asset_code,
  timeframe,
  call_date,
  call_day_of_week,
  call_time_et,
  conviction_bucket,
  move_magnitude_bucket,
  agent_conviction,
  open_price,
  close_price,
  pct_change,
  abs_pct_change,
  market_outcome_direction,
  agent_direction,
  combined_result,
  result_reason,
  benchmark_market,
  market_relationship,
  evaluation_mode,
  snapshot_date,
  predicted_direction,
  predicted_conviction,
  verdict_strength,
  equities_regime,
  fed_bias,
  case when combined_result = 'CORRECT' then 1 else 0 end as is_win,
  case when combined_result = 'WRONG' then 1 else 0 end as is_loss,
  case
    when agent_direction = 'NO_CALL' or agent_direction = 'NO 24H CALL' then 'NO_CALL'
    when headline_confidence_pct is null then 'PENDING'
    when headline_confidence_pct >= 80 and abs(coalesce(net_edge_pct, 0)) >= 25 and coalesce(participation_pct, 0) >= 50 then 'VERY_STRONG'
    when headline_confidence_pct >= 65 and abs(coalesce(net_edge_pct, 0)) >= 18 and coalesce(participation_pct, 0) >= 35 then 'STRONG'
    when headline_confidence_pct >= 50 and abs(coalesce(net_edge_pct, 0)) >= 10 and coalesce(participation_pct, 0) >= 25 then 'MODERATE'
    when headline_confidence_pct > 0 then 'WEAK'
    else 'NO_CALL'
  end as headline_confidence_strength,
  bull_case_pct,
  bear_case_pct,
  net_edge_pct,
  participation_pct,
  headline_confidence_pct
from scored
;

comment on view research_prediction_usd_benchmark_summary is
'USD Phase 2 benchmark-accuracy surface. One row represents one USD timeframe prediction evaluated only against the direct DXY benchmark. Basket and translation outcomes remain available elsewhere for diagnostics only.';

create or replace view research_usd_24h_direction_accuracy as
with benchmark_24h as (
  select *
  from research_prediction_usd_benchmark_summary
  where timeframe = 'following 24hrs'
),
evaluated_24h as (
  select *
  from benchmark_24h
  where combined_result in ('CORRECT', 'WRONG', 'FLAT')
),
bullish_directional as (
  select *
  from evaluated_24h
  where agent_direction = 'BULLISH'
    and combined_result in ('CORRECT', 'WRONG')
),
bearish_directional as (
  select *
  from evaluated_24h
  where agent_direction = 'BEARISH'
    and combined_result in ('CORRECT', 'WRONG')
)
select
  'DXY'::text as benchmark_market,
  count(*) as evaluated_calls,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  (select count(*) from benchmark_24h where combined_result = 'NOT_EVALUABLE') as not_evaluable,
  count(*) filter (where agent_direction = 'BULLISH' and combined_result in ('CORRECT', 'WRONG', 'FLAT')) as bullish_calls,
  count(*) filter (where agent_direction = 'BEARISH' and combined_result in ('CORRECT', 'WRONG', 'FLAT')) as bearish_calls,
  count(*) filter (where agent_direction = 'BULLISH' and combined_result = 'CORRECT') as bullish_wins,
  count(*) filter (where agent_direction = 'BULLISH' and combined_result = 'WRONG') as bullish_losses,
  count(*) filter (where agent_direction = 'BULLISH' and combined_result = 'FLAT') as bullish_flats,
  count(*) filter (where agent_direction = 'BEARISH' and combined_result = 'CORRECT') as bearish_wins,
  count(*) filter (where agent_direction = 'BEARISH' and combined_result = 'WRONG') as bearish_losses,
  count(*) filter (where agent_direction = 'BEARISH' and combined_result = 'FLAT') as bearish_flats,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*), 0),
    2
  ) as overall_accuracy_pct,
  round(
    100.0 * (select count(*) from bullish_directional where combined_result = 'CORRECT')
    / nullif((select count(*) from bullish_directional), 0),
    2
  ) as bullish_call_accuracy_pct,
  round(
    100.0 * (select count(*) from bearish_directional where combined_result = 'CORRECT')
    / nullif((select count(*) from bearish_directional), 0),
    2
  ) as bearish_call_accuracy_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'FLAT')
    / nullif(count(*), 0),
    2
  ) as flat_no_move_accuracy_pct
from evaluated_24h
;

comment on view research_usd_24h_direction_accuracy is
'Single-row USD following-24hrs benchmark summary. Uses DXY-only benchmark accuracy, excludes MIXED and NOT_EVALUABLE from the evaluated denominator, and provides simple bullish, bearish, and flat/no-move accuracy splits for the dashboard.';

create or replace view research_accuracy_by_verdict_strength as
select
  asset_code,
  timeframe,
  benchmark_market,
  coalesce(verdict_strength, 'UNKNOWN') as verdict_strength,
  case coalesce(verdict_strength, 'UNKNOWN')
    when 'VERY_STRONG' then 1
    when 'STRONG' then 2
    when 'MODERATE' then 3
    when 'WEAK' then 4
    when 'NO_CALL' then 5
    when 'MARKET_CLOSED' then 6
    else 7
  end as strength_rank,
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_calls,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'NOT_EVALUABLE') as not_evaluable,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'FLAT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as flat_no_move_pct,
  round(
    avg(headline_confidence_pct) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT'))::numeric,
    2
  ) as avg_predicted_confidence,
  round(
    avg(abs_pct_change) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT'))::numeric,
    4
  ) as avg_abs_move_pct
from research_prediction_usd_benchmark_summary
group by
  asset_code,
  timeframe,
  benchmark_market,
  coalesce(verdict_strength, 'UNKNOWN')
;

comment on view research_accuracy_by_verdict_strength is
'DXY-only USD benchmark accuracy grouped by verdict strength. This tests whether the verdict-quality labels such as VERY_STRONG, STRONG, MODERATE, and WEAK actually predict directional accuracy.';

create or replace view research_accuracy_by_confidence_bucket as
with bucketed as (
  select
    asset_code,
    timeframe,
    benchmark_market,
    combined_result,
    abs_pct_change,
    headline_confidence_pct as predicted_confidence,
    case
      when headline_confidence_pct is null then 'UNKNOWN'
      when headline_confidence_pct < 50 then '<50'
      when headline_confidence_pct < 55 then '50-54'
      when headline_confidence_pct < 60 then '55-59'
      when headline_confidence_pct < 65 then '60-64'
      when headline_confidence_pct < 70 then '65-69'
      when headline_confidence_pct < 75 then '70-74'
      when headline_confidence_pct < 80 then '75-79'
      when headline_confidence_pct < 85 then '80-84'
      when headline_confidence_pct < 90 then '85-89'
      when headline_confidence_pct < 95 then '90-94'
      else '95-100'
    end as confidence_bucket,
    case
      when headline_confidence_pct is null then 12
      when headline_confidence_pct < 50 then 1
      when headline_confidence_pct < 55 then 2
      when headline_confidence_pct < 60 then 3
      when headline_confidence_pct < 65 then 4
      when headline_confidence_pct < 70 then 5
      when headline_confidence_pct < 75 then 6
      when headline_confidence_pct < 80 then 7
      when headline_confidence_pct < 85 then 8
      when headline_confidence_pct < 90 then 9
      when headline_confidence_pct < 95 then 10
      else 11
    end as confidence_bucket_rank
  from research_prediction_usd_benchmark_summary
)
select
  asset_code,
  timeframe,
  benchmark_market,
  confidence_bucket,
  confidence_bucket_rank,
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_calls,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'NOT_EVALUABLE') as not_evaluable,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'FLAT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as flat_no_move_pct,
  round(
    avg(predicted_confidence) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT'))::numeric,
    2
  ) as avg_predicted_confidence,
  round(
    avg(abs_pct_change) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT'))::numeric,
    4
  ) as avg_abs_move_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as actual_win_rate_pct,
  round(
    (
      100.0 * count(*) filter (where combined_result = 'CORRECT')
      / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0)
    ) - avg(predicted_confidence) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')),
    2
  ) as calibration_gap_pct
from bucketed
group by
  asset_code,
  timeframe,
  benchmark_market,
  confidence_bucket,
  confidence_bucket_rank
;

comment on view research_accuracy_by_confidence_bucket is
'DXY-only USD benchmark accuracy grouped by predicted confidence bands. Includes a calibration gap so research can test whether the confidence score is overconfident or underconfident.';

create or replace view research_trade_quality_thresholds as
with base as (
  select
    asset_code,
    timeframe,
    benchmark_market,
    combined_result,
    abs_pct_change,
    headline_confidence_pct as predicted_confidence,
    coalesce(headline_confidence_strength, 'UNKNOWN') as verdict_strength,
    case coalesce(headline_confidence_strength, 'UNKNOWN')
      when 'VERY_STRONG' then 1
      when 'STRONG' then 2
      when 'MODERATE' then 3
      when 'WEAK' then 4
      when 'NO_CALL' then 5
      when 'MARKET_CLOSED' then 6
      else 7
    end as strength_rank
  from research_prediction_usd_benchmark_summary
),
totals as (
  select
    asset_code,
    timeframe,
    benchmark_market,
    count(*) as total_available_predictions
  from base
  group by
    asset_code,
    timeframe,
    benchmark_market
),
threshold_rows as (
  select *, 'All Calls' as threshold_label, 1 as threshold_rank from base
  union all
  select *, 'Confidence >= 60' as threshold_label, 2 as threshold_rank from base where predicted_confidence >= 60
  union all
  select *, 'Confidence >= 70' as threshold_label, 3 as threshold_rank from base where predicted_confidence >= 70
  union all
  select *, 'Confidence >= 75' as threshold_label, 4 as threshold_rank from base where predicted_confidence >= 75
  union all
  select *, 'Confidence >= 80' as threshold_label, 5 as threshold_rank from base where predicted_confidence >= 80
  union all
  select *, 'Confidence >= 85' as threshold_label, 6 as threshold_rank from base where predicted_confidence >= 85
  union all
  select *, 'Confidence >= 90' as threshold_label, 7 as threshold_rank from base where predicted_confidence >= 90
  union all
  select *, 'Strength >= MODERATE' as threshold_label, 8 as threshold_rank from base where strength_rank <= 3
  union all
  select *, 'Strength >= STRONG' as threshold_label, 9 as threshold_rank from base where strength_rank <= 2
  union all
  select *, 'Strength = VERY_STRONG' as threshold_label, 10 as threshold_rank from base where strength_rank = 1
  union all
  select *, 'Confidence >= 75 AND Strength >= STRONG' as threshold_label, 11 as threshold_rank from base where predicted_confidence >= 75 and strength_rank <= 2
  union all
  select *, 'Confidence >= 80 AND Strength >= STRONG' as threshold_label, 12 as threshold_rank from base where predicted_confidence >= 80 and strength_rank <= 2
  union all
  select *, 'Confidence >= 85 AND Strength = VERY_STRONG' as threshold_label, 13 as threshold_rank from base where predicted_confidence >= 85 and strength_rank = 1
)
select
  t.asset_code,
  t.timeframe,
  t.benchmark_market,
  t.threshold_label,
  t.threshold_rank,
  totals.total_available_predictions,
  count(*) as tradeable_predictions,
  round(
    100.0 * count(*)
    / nullif(totals.total_available_predictions, 0),
    2
  ) as coverage_pct,
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_calls,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'FLAT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as flat_no_move_pct,
  round(
    avg(predicted_confidence) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT'))::numeric,
    2
  ) as avg_predicted_confidence,
  round(
    avg(abs_pct_change) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT'))::numeric,
    4
  ) as avg_abs_move_pct,
  round(
    (
      100.0 * count(*) filter (where combined_result = 'CORRECT')
      / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0)
    ) - avg(predicted_confidence) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')),
    2
  ) as calibration_gap_pct
from threshold_rows t
join totals
  on totals.asset_code = t.asset_code
 and totals.timeframe = t.timeframe
 and totals.benchmark_market = t.benchmark_market
group by
  t.asset_code,
  t.timeframe,
  t.benchmark_market,
  t.threshold_label,
  t.threshold_rank,
  totals.total_available_predictions
;

comment on view research_trade_quality_thresholds is
'DXY-only USD benchmark trade-quality thresholds. Measures how win rate, coverage, confidence, and realised move change when research filters to higher-confidence or stronger verdict subsets without changing production behavior.';

create or replace view research_overall_win_rate as
select
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_prediction_usd_benchmark_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT');

create or replace view research_win_rate_by_timeframe as
select
  timeframe,
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_prediction_usd_benchmark_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT')
group by timeframe
order by timeframe;

create or replace view research_win_rate_by_conviction_bucket as
select
  coalesce(conviction_bucket, 'UNKNOWN') as conviction_bucket,
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    avg(headline_confidence_pct)::numeric,
    2
  ) as avg_conviction,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_prediction_usd_benchmark_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_prediction_usd_benchmark_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    avg(abs_pct_change)::numeric,
    4
  ) as avg_abs_move_pct,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_prediction_usd_benchmark_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
  count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')) as evaluated_predictions,
  count(*) filter (where combined_result = 'CORRECT') as wins,
  count(*) filter (where combined_result = 'WRONG') as losses,
  count(*) filter (where combined_result = 'FLAT') as flats,
  count(*) filter (where combined_result = 'MIXED') as mixed,
  round(
    100.0 * count(*) filter (where combined_result = 'CORRECT')
    / nullif(count(*) filter (where combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_prediction_usd_benchmark_summary
where combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
    / nullif(count(*) filter (where ps.combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from research_factor_observations fo
join research_prediction_usd_benchmark_summary ps
  on ps.prediction_id = fo.timeframe_prediction_id
where
  fo.factor_signal in ('BULLISH', 'BEARISH')
  and ps.combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
  round(avg(ps.headline_confidence_pct)::numeric, 2) as avg_prediction_conviction,
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
join research_prediction_usd_benchmark_summary ps
  on ps.prediction_id = fo.timeframe_prediction_id
where
  fo.factor_signal in ('BULLISH', 'BEARISH')
  and ps.combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
  join research_prediction_usd_benchmark_summary ps
    on ps.prediction_id = fo.timeframe_prediction_id
  where
    fo.factor_signal in ('BULLISH', 'BEARISH')
    and ps.combined_result in ('CORRECT', 'WRONG', 'FLAT')
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
    / nullif(count(*) filter (where ps.combined_result in ('CORRECT', 'WRONG', 'FLAT')), 0),
    2
  ) as win_rate_pct
from factor_pairs fp
join research_prediction_usd_benchmark_summary ps
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
