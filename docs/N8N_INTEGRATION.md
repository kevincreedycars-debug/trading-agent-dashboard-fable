# n8n Integration

Last updated: 2026-06-19

## Workspace

Base URL:

```text
https://silver17.app.n8n.cloud
```

Project/workflow UI URL supplied by user:

```text
https://silver17.app.n8n.cloud/projects/ISQG9XU7TGTT6Fcu/workflows
```

The project/workflow URL is useful for browser navigation, but API calls should use the base workspace URL.

## API Credential Handling

An n8n API key was supplied in chat during setup.

Do not commit the API key to GitHub.
Do not store it in repository documentation.
Do not paste it into workflow JSON exports.

Recommended long-term action:

1. Use the current key only for initial testing if needed.
2. Revoke it after connection is proven.
3. Generate a fresh API key.
4. Store it only in the secure runtime/tooling environment.

## Integration Strategy

Use n8n API first.

Reasons:

- stable production interface
- supports workflow inspection and updates
- supports workflow activation/deactivation and execution
- easier to reason about than AI browser automation

Add n8n MCP second if it improves AI-native workflow browsing.

## Intended Capabilities

The AI development environment should eventually be able to:

- list all workflows
- fetch a workflow by ID
- inspect workflow nodes
- locate a named node
- update node code/parameters
- save workflow changes
- export workflow JSON into GitHub
- execute a workflow
- inspect latest execution result
- update GitHub documentation after changes

## Safety Rules

1. Never change production workflows without recording the intent in GitHub.
2. Prefer exporting/backing up a workflow before editing it.
3. Never commit credentials.
4. Prefer targeted node edits over whole-workflow rewrites.
5. After editing, run the smallest relevant workflow first before running the full Master Orchestrator.
6. Record all changes in `docs/CHANGELOG.md` and `docs/SESSION_LOG.md`.

## Current n8n Priorities

1. Export all active workflows into `exports/`.
2. Create human-readable workflow documents in `workflows/`.
3. Fix EUR Layer 1 parser.
4. Fix Eco Events duplicate insert handling.
5. Add Master Orchestrator execution summary.
