alter table research_timeframe_predictions
  add column if not exists factor_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  add column if not exists missing_inputs jsonb not null default '[]'::jsonb,
  add column if not exists logic_document text,
  add column if not exists logic_document_version text,
  add column if not exists replay_version text;

create unique index if not exists idx_research_observations_replay_snapshot
  on research_observations (source_workflow, source_snapshot_id, agent_name)
  where source_snapshot_id is not null;

create unique index if not exists idx_research_factor_observations_prediction_factor
  on research_factor_observations (timeframe_prediction_id, factor_key);

create index if not exists idx_research_timeframe_predictions_replay_version
  on research_timeframe_predictions (replay_version, timeframe);
