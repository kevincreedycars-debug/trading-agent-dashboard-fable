# Active Bugs

Last updated: 2026-06-19

## 1. Eco Events Collector duplicate insert

### Status

Open.

### Error

```text
duplicate key value violates unique constraint

economic_events_event_date_currency_event_name_event_time_t_key
```

### Diagnosis

The Eco Events Collector is attempting to insert an economic event that already exists in Supabase.

This is not a Master Orchestrator issue.

### Preferred Fix

Use one of:

- upsert
- `ON CONFLICT DO NOTHING`
- Supabase RPC/custom API call

Avoid adding unnecessary Get → IF → Create logic unless required.

---

## 2. EUR Agent parser fails with OpenAI JSON Object output

### Status

Open.

### Diagnosis

The EUR parser assumes OpenAI output is always a string and attempts `JSON.parse(text)`.

After enabling OpenAI `Output Format: JSON Object`, the OpenAI node may return an already-parsed object.

### Required Fix

Update parser logic to support:

- string output → parse with `JSON.parse`
- object output → use object directly

### Expected Pattern

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

---

## 3. Master Orchestrator missing final summary

### Status

Open.

### Required Fix

Add final success/failure reporting node at the end of the Master Orchestrator.

### Desired Success Output

```text
Manual Refresh Complete

SUCCESS

Eco Events ✓
USD Collector ✓
EUR Collector ✓
Gold Collector ✓
NQ Collector ✓
BTC Collector ✓

USD Agent ✓
EUR Agent ✓
Gold Agent ✓
NQ Agent ✓
BTC Agent ✓

Dashboard Writer ✓
```

### Desired Failure Output

```text
FAILED

EUR Agent

Reason:
OpenAI invalid JSON
```
