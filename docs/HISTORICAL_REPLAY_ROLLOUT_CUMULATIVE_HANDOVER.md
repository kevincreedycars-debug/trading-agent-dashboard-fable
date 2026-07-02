# Historical Replay Rollout Cumulative Handover

Last updated: 2026-07-02

## Scope

This document is the cumulative handover for the validated historical replay rollout across:

- USD
- EUR
- Gold
- NQ
- BTC

The purpose is not to improve model quality.

The purpose is to reproduce exactly what each live Layer 1 agent would have displayed historically, then evaluate that historical output downstream without changing production semantics.

---

## Permanent Architecture Rules

1. Layer 1 historical replay is downstream-only.
2. Do not change live workflow logic to make replay easier.
3. Do not redesign the platform architecture during replay work.
4. Do not blend Layer 1 assets together.
5. Do not build Layer 2 logic into Layer 1 replay.
6. Audit the live/exported implementation first, then reproduce it historically.
7. If markdown docs and exported workflow/live implementation differ, exported workflow/live implementation wins.
8. The replay target is live display parity, not better accuracy.
9. Historical evaluation is only trusted after the checker validates replay -> evaluation -> stored artifact -> dashboard.
10. Dashboard rendering is not proof of correctness by itself.

---

## Standard Build Order

1. Audit live asset implementation.
2. Confirm benchmark convention from production behavior.
3. Build a one-snapshot parity fixture.
4. Build and pass the parity script.
5. Build historical snapshot generation.
6. Build historical replay.
7. Build outcome evaluation.
8. Run flat-band sensitivity if the asset uses a 24H directional evaluation.
9. Build checker artifact.
10. Validate checker with PASS / 0 fail / 0 missing / 0 tolerance.
11. Wire dashboard matrix/checker views.
12. Run browser smoke.
13. Re-run existing asset regression checks.
14. Commit and push only after validation passes.

Do not skip the parity gate.

---

## Source Of Truth Rules

- Exported workflow JSON is the primary implementation source.
- Live deterministic node semantics are the operational source of truth.
- Live dashboard output examples are required when display semantics are ambiguous.
- Markdown logic docs are supporting references only.
- Existing replay code is never authoritative over production behavior.

---

## Confidence And Conviction Rules

- Separate raw replay conviction from displayed headline confidence.
- Use displayed headline confidence for dashboard matrix buckets when the dashboard is showing the live display value.
- Use the shared helper only:
  `backtester/lib/headline_confidence.js`
- Do not duplicate headline confidence logic in asset-specific replay code.
- Do not mix raw conviction and displayed confidence in checker comparisons.

Current dashboard confidence buckets:

- Weak: 0-49
- Moderate: 50-64
- Strong: 65-79
- Very Strong: 80-100

---

## Checker Requirements

The checker must validate the full chain:

`replay -> outcome evaluation -> stored artifact -> dashboard`

Minimum acceptance standard:

- PASS
- 0 fail
- 0 missing
- 0 tolerance

Anything weaker is provisional.

---

## Asset-Specific Benchmark And Session Rules

### USD

- Primary benchmark is DXY-only for headline accuracy.
- Basket and translation markets remain diagnostic only.
- Historical 24H path is the canonical short-horizon research path.
- Do not reinterpret USD results through FX pair moves for the primary checker.

### EUR

- Benchmark must be the direct live market expression, not a generic macro proxy.
- Historical rollout validated the EUR direct-path replay/evaluation architecture.
- Confidence bucketing must follow displayed headline confidence, not replay raw conviction.

### Gold

- Gold historical replay was validated on the parity-trusted 24H path first.
- Dashboard and checker trust only comes after full chain validation.
- Browser availability is not a substitute for checker trust.

### NQ

- NQ required close auditing of live examples, not just the markdown logic doc.
- Missing inputs must remain missing; do not coerce to `0`.
- Secondary or auxiliary live-style outputs must not be forced into warehouse shapes if the canonical research path does not support them cleanly.
- Flat-band sensitivity must be run against the actual evaluation table shape, not assumed table semantics.

### BTC

- BTC is 24/7.
- Keep weekend rows.
- Do not apply weekday/session filtering copied from USD/EUR/Gold/NQ.
- Primary evaluation benchmark is `BTCUSD`.
- Historical evaluation must stay aligned to the ET-anchored 24H evaluation window model used by the shared backtester framework.
- Replay must preserve live semantics for:
  direction, lean, no clear bias, bull case, bear case, participation, net edge, displayed headline confidence, strength, warnings, missing inputs, and no-call behavior.

---

## BTC Implementation Lessons

- BTC live semantics are defined by the exported deterministic node, not by assumptions from other assets.
- Weekend handling matters for BTC and must be snapshot-date aware during replay.
- BTC missing-input behavior must be preserved instead of backfilled with invented values.
- BTC replay uses canonical headline confidence downstream, while retaining the live raw-conviction semantics inside replay output.
- Historical BTC snapshot generation must enumerate all calendar dates in range, then forward-fill non-24/7 supporting series so weekend BTC rows still reflect live collector semantics.
- Historical BTC currently tolerates missing ETF flow series by resolving that factor to missing/neutral, matching live-style missing-input behavior rather than fabricating history.

---

## BTC Validated Outcome

Validated on 2026-07-02:

- Live-vs-replay parity: PASS
- Historical snapshots built: 850
- Historical replay predictions written: 850
- Outcome evaluations written: 850
- BTC 24H baseline flat band: 1.00
- Checker result: 850 pass / 0 fail / 0 missing / 0 tolerance

Regression status after BTC:

- USD parity/checker: PASS
- EUR parity/checker: PASS
- Gold parity/checker: PASS
- NQ parity/checker: PASS

---

## Closing Instructions

1. Preserve the asset-isolated Layer 1 architecture.
2. Treat live/exported implementation as the authority before touching replay code.
3. Require parity before scale.
4. Require checker PASS before trust.
5. Use displayed headline confidence consistently in dashboard accuracy matrices.
6. Keep asset-specific benchmark and session rules explicit.
7. Do not include unrelated local modifications in replay commits.
8. Extend the rollout one asset at a time using the same validation ladder.

If future work adds more assets, start from this same sequence rather than copying logic across assets blindly.
