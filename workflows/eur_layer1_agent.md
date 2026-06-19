# EUR Layer 1 Agent

## Purpose

Generate the independent raw EUR directional call using only:

- EUR logic document
- latest usable market snapshot

## Layer 1 Rule

This workflow must not read other agent outputs, dashboard output, or Layer 2.

## Current Known Bug

The parser can fail after enabling OpenAI `Output Format: JSON Object`.

The parser currently assumes the OpenAI result is always a string and calls `JSON.parse(text)`.

It must support both string and object output.

## Required Parser Pattern

```js
let report;

if (typeof text === 'string') {
  report = JSON.parse(text);
} else if (typeof text === 'object' && text !== null) {
  report = text;
} else {
  throw new Error('Unsupported OpenAI output format');
}
```

## Next Fix

After n8n API connection:

1. Fetch EUR Layer 1 Agent workflow.
2. Find parser/code node.
3. Replace brittle parsing logic with object|string safe parser.
4. Save workflow.
5. Run EUR Layer 1 Agent only.
6. If successful, run Master Orchestrator.
7. Export updated workflow JSON to GitHub.
