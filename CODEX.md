# Codex Operating Instructions — Trading Agent Dashboard

## Role

Codex acts as the implementation engineer for this repository.

ChatGPT is used for architecture, planning, debugging, and review. Codex is used for file edits, workflow export/import tooling, code changes, commits, and implementation.

## First Files To Read On Every Session

Read these files before making changes:

1. `docs/CURRENT_TASK.md`
2. `docs/CURRENT_STATE.md`
3. `docs/NEXT_STEPS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/N8N_INTEGRATION.md`
6. `workflows/WORKFLOW_INVENTORY.md`
7. `issues/active_bugs.md`
8. `docs/DECISIONS.md`
9. `docs/CHANGELOG.md`

## Core Architecture Rule

GitHub is the source of truth.

n8n is the execution engine.

Supabase is the data layer.

Netlify is the presentation layer.

## Layer 1 Isolation Rule

Do not introduce cross-agent contamination into Layer 1.

Each Layer 1 agent may read only:

- its own logic document
- latest usable market snapshot

Each Layer 1 agent must not read:

- other agent outputs
- dashboard output
- Layer 2 output
- synthetic pair conclusions from other agents

## n8n Environment Variables

The following secrets should be configured in the Codex/runtime environment, never committed:

```bash
N8N_BASE_URL=https://silver17.app.n8n.cloud
N8N_API_KEY=<secret>
```

Do not write the API key to any file.

## n8n API Access Pattern

Use the n8n API for workflow inspection/export/update.

Expected first integration tasks:

1. List all workflows.
2. Match workflow names against `workflows/WORKFLOW_INVENTORY.md`.
3. Export each active workflow JSON into `exports/`.
4. Create/update the matching `workflows/*.md` file for each workflow.
5. Do not edit workflows until exports exist.

## Safety Rules

1. Always make the smallest targeted change possible.
2. Prefer editing a specific node over rewriting an entire workflow.
3. Export the workflow before editing it.
4. Never commit credentials.
5. Never commit raw API keys.
6. Never store Supabase service role keys or OpenAI keys in exports.
7. After workflow edits, update:
   - `docs/CHANGELOG.md`
   - `docs/SESSION_LOG.md`
   - `docs/CURRENT_TASK.md`
   - relevant `workflows/*.md`
8. If a task changes architecture, update `docs/DECISIONS.md`.

## Current Priority Bugs

1. EUR Layer 1 parser must support OpenAI output as object or string.
2. Eco Events Collector must handle duplicate inserts idempotently.
3. Master Orchestrator needs final success/failure summary.

## Preferred Branching

For material changes, create a branch:

```bash
codex/<short-task-name>
```

Open a pull request before merging unless explicitly instructed otherwise.

## Current Repository

```text
kevincreedycars-debug/trading-agent-dashboard
```
