# n8n Workflow Exports

This directory stores version-controlled n8n workflow JSON exports.

Expected files:

- `master_orchestrator.json`
- `eco_events_collector.json`
- `usd_collector.json`
- `eur_collector.json`
- `gold_collector.json`
- `nq_collector.json`
- `btc_collector.json`
- `usd_layer1_agent.json`
- `eur_layer1_agent.json`
- `gold_layer1_agent.json`
- `nq_layer1_agent.json`
- `btc_layer1_agent.json`
- `dashboard_writer.json`

## Rule

Exports are snapshots/backups of n8n workflows.

The live execution source is n8n. GitHub keeps version history and supports review/diff before and after changes.

## Security

Never commit API keys, credentials, Supabase service keys, n8n secrets, or OpenAI keys inside exported workflow JSON.

If exports include credential references, only credential IDs/placeholders should be present.
