# Session Notes

Last updated: 2026-07-02

## Work Completed

- Confirmed the full Layer 1 historical replay rollout is already validated across USD, EUR, Gold, NQ, and BTC.
- Added a new `Weekday Breakdown` Backtest / Accuracy sub-tab so the main research area stays compact.
- Derived the weekday-by-confidence breakdown directly from the existing deterministic checker artifacts instead of generating new replay outputs or recalculating confidence.
- Used stored displayed headline confidence to bucket rows into Weak `0-49`, Moderate `50-64`, Strong `65-79`, and Very Strong `80-100`.
- Included all checker rows in the weekday totals, including `NO_CALL` and `NOT_EVALUABLE`, so per-asset weekday totals reconcile exactly back to the checker artifact row counts.
- Added `backtester/scripts/validate_weekday_breakdown.js` and confirmed reconciliation passes for USD `604`, EUR `602`, Gold `608`, NQ `604`, and BTC `850`.
- Expanded the local Playwright smoke script to verify the existing matrices, existing checker views, and the new weekday breakdown tab with correct weekday columns by asset.
- Re-ran validation successfully: syntax checks, five checker validators, weekday reconciliation validator, and browser smoke all pass.
- Updated Weekday Breakdown cells so flats are separated from directional wins/losses and the displayed rate is ex-flat only.
- Added a `Day Totals` table above each asset's confidence-bucket table, with ex-flat rate, `W / L / F / T`, and flat rate for each weekday plus the all-days total.
- Extended the weekday validator to prove day totals equal the sum of bucket rows for each weekday and still reconcile back to the checker row counts.
- Committed and pushed the flat-aware weekday breakdown follow-ups to `origin/main`.

## Unfinished Work

- Verify the public GitHub Pages dashboard after push.
- Decide the next Backtest / Accuracy analytical expansion.

## Blockers

- No repository-side blocker.
- No current release blocker.
- Any n8n API key previously exposed in chat should still be treated as compromised and replaced if it has not already been rotated.

## Assumptions

- Canonical memory documents live in `docs/`, with `CODEX_STARTUP.md` kept at the repository root.
- `docs/ACTIVE_MILESTONE.md` is the current checkpoint only; completed milestone history belongs in `docs/CHANGELOG.md`.
- GitHub remains the source of truth, n8n remains execution, Supabase remains data, and GitHub Pages remains the active dashboard host.
- Historical research work remains downstream-only and must not change production runtime behavior.
- Replay outputs, checker semantics, flat bands, and headline confidence logic remain frozen unless a later task explicitly changes them.

## Exact Next Task

Verify the public GitHub Pages dashboard renders the final Weekday Breakdown and Day Totals cleanly, then decide the next Backtest / Accuracy analytical expansion.
