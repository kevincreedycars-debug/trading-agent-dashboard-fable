# Eco Events Collector

## Purpose

Collect relevant economic events and write them into Supabase for later event-risk and Layer 2 processing.

## Current Known Bug

The workflow currently attempts to insert duplicate events into Supabase.

Observed error:

```text
duplicate key value violates unique constraint

economic_events_event_date_currency_event_name_event_time_t_key
```

## Diagnosis

Supabase has a uniqueness constraint on event identity fields. The collector should be idempotent, but currently it uses a plain insert/create pattern.

## Preferred Fix

Use one of:

- upsert
- `ON CONFLICT DO NOTHING`
- Supabase RPC/custom API call

Avoid unnecessary Get → IF → Create logic unless the n8n Supabase node cannot support the preferred approach.

## Next Fix

After n8n API connection:

1. Fetch Eco Events Collector workflow.
2. Identify Supabase insert/create node.
3. Confirm table and unique constraint columns.
4. Replace insert behaviour with idempotent upsert/conflict-safe write.
5. Run Eco Events Collector only.
6. Confirm repeat execution does not fail on duplicate rows.
7. Export updated workflow JSON to GitHub.
