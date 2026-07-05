# L2L Move Reliability Findings (2026-07-05)

Downstream-only statistical audit of whether the ~70% L2L Move win rates shown in the
dashboard represent real directional reliability. Reproducible via:

```
node backtester/scripts/analyze_l2l_directional_edge.js
```

The script reads only `data/adr-reach-research.json` and the checked-in hourly caches.
It recomputes the guaranteed directional move in BOTH directions for every evaluated
day (0 mismatches against the artifact's stored outcomes), then compares the model
against no-skill baselines. No production or research semantics were changed.

## Headline verdict

**The ~70% L2L Move win rate is NOT evidence of directional reliability. It is the
base rate of daily volatility.** On most days a 50%-of-ADR20 swing occurs in *both*
directions, so a coin-flip caller scores ~70% too. However, two genuinely reliable
directional signals exist elsewhere in the system: **BTC close-to-close** and
**Gold close-to-close**, plus a real L2L edge in **NQ/USD Layer 2** signals.

## Why the 70% is base rate

For every evaluated day the guaranteed-move logic was run in both directions:

| Group | Model L2L win | No-skill null* | Both dirs win | Skill (z, p) |
|---|---|---|---|---|
| L1 EUR  | 72.0% (571) | 73.4% | 52.0% | z=-1.10, n.s. |
| L1 GOLD | 73.2% (571) | 73.7% | 54.1% | z=-0.39, n.s. |
| L1 NQ   | 73.3% (561) | 73.6% | 54.2% | z=-0.26, n.s. |
| L1 BTC  | 66.9% (794) | 68.1% | 51.4% | z=-1.25, n.s. |

*Null = a caller with the model's bull/bear call frequencies but no day-level information.

No Layer 1 asset beats its no-skill null; all four are marginally below it.

### Discriminating days (the only place skill can show)

On days where exactly one direction reached the L2L distance (~33-43% of days),
the call direction decides the outcome. Model accuracy there:

- EUR 46.5% (245 days), GOLD 48.0% (227), NQ 53.0% (202), BTC 46.2% (266) — all
  statistically indistinguishable from (or below) a coin flip.
- Layer 2: **NQ/USD 62.5% (120 days, z=2.74, p=0.006)** — real, and stable across
  2024/2025/2026 (61/61/68%). **BTC/USD 69.0% (29 days, p=0.04)** — suggestive but
  small-sample. EUR/USD 44.7% and XAU/USD 46.4% — no edge.

### Confidence buckets do not calibrate

Win rates are flat-to-inverted across Weak → Very Strong in every group; VERY_STRONG
is frequently the *worst* bucket (NQ 64.4%, Gold 68.3%, BTC 61.4%, BTC/USD 47.4%).
Headline confidence currently carries no usable information about L2L outcomes and
must not be used for trade sizing or filtering until recalibrated.

## Where real directional skill DOES exist (close-to-close lens)

Day direction is exactly reconstructable from call direction + checker verdict, so
each asset was tested against a drift-matched null (a no-information caller with the
same bull-call frequency facing the same up-day frequency):

| Asset | Correct (ex-flat) | Drift null | Edge | Significance | Yearly stability |
|---|---|---|---|---|---|
| **BTC**  | **61.1% (481)** | 50.0% | **+11.2 pts** | z=4.89, p<0.0001 | 59.8 / 60.5 / 66.7% |
| **GOLD** | **56.7% (390)** | 49.8% | **+6.8 pts**  | z=2.70, p=0.007  | 56.2 / 56.6 / 60.0% |
| EUR  | 48.5% (357) | 50.0% | -1.5 pts | n.s. | declining |
| NQ   | 50.6% (354) | 52.8% | -2.3 pts | n.s. | declining |

BTC is the strongest finding in the system: 63.8% bull calls against 49.9% up days
still lands 61.1% correct, three years running. Gold is smaller but consistent.
Caveat: flats are excluded (BTC has 312 flat rows of 794), so these are accuracies
on days the market subsequently moved beyond the flat band — a trader cannot know in
advance which days those are.

## Lean calls and per-direction splits (follow-up, same session)

The research folds `BULLISH_LEAN`/`BEARISH_LEAN` into bullish/bearish, and leans
dominate the samples (BTC 86% leans, Gold 72%). Close-direction accuracy by raw
call type (ex-flat):

- **BTC**: edge holds for every call type — bull lean 57.5% (266), bear lean 65.7%
  (143), full bull 65.9% (41), full bear 64.5% (31). Leans are fully tradable.
- **GOLD**: the edge is one-sided. Bullish full 70.4% (71) and bullish lean 66.9%
  (121) are strong; bearish full 55.3% (47) is thin; **bearish lean is 42.4% (151)**
  — it lost more than it won. (Against the conditional down-day base rate of ~38.7%
  it still nudges above no-skill, but at face value a trader taking gold bearish
  leans lost money.) Practical rule: take Gold bullish calls only.
- **NQ**: full bearish 34.5% (116); bullish 58.8% vs a 60.5% up-day base rate
  (pure drift-riding). Confirms no-take.
- **EUR**: 47.5-54.5% across all call types. No edge anywhere.

Layer 2 note: pair logic accepts only exact BULLISH/BEARISH, so **pair signals
never fire on leans** — the NQ/USD and BTC/USD historical results are full-calls-only
by construction, and no lean-handling rule is needed at Layer 2.

## Practical daily guidance (historical evidence only)

Signals with defensible historical directional value:

1. **BTC Layer 1 24H call** (full or lean, either direction) — 61% close-direction
   accuracy vs 50% null. Strongest.
2. **Gold Layer 1 24H call, BULLISH side only** (full or lean) — 67-70%
   close-direction accuracy. Gold bearish leans were 42.4% and should be skipped.
3. **NQ/USD Layer 2 tradable signal** — 62.5% correct on direction-decisive L2L days.
4. **BTC/USD Layer 2 tradable signal** — promising (69%) but only 29 decisive days.

Signals with NO demonstrated directional value (treat as no-trade):

- EUR Layer 1, NQ Layer 1 (both lenses ≈ coin flip; both declining year-over-year)
- EUR/USD and XAU/USD Layer 2 pair signals
- Any filtering/sizing based on the confidence score, at any strength bucket

## L2L hit rates by call type at 50/55/60% of ADR20 (follow-up, same session)

For the level-to-level trade model (enter at a level, exit at the directional level
L2L away), hit = a guaranteed swing ≥ threshold × ADR20 in the call direction during
the day. Each call type was compared against the any-day base rate for that same
direction (how often that swing happens with no call at all):

- **The system's only real L2L edge is on the SELL side.** Up-swings ≥ 50% ADR20
  happen on 68-80% of all days (markets drift up), so no bullish call adds anything
  (deltas -4 to +2 everywhere). Bearish calls that select genuinely bigger-down-swing
  days: **NQ clear bearish +8.1 pts** (76.2% vs 68.1% base, n=164), **BTC clear
  bearish +10.9** (79.2%, n=48), **NQ/USD sell +15.1** (79.6% vs 64.5%, n=93 —
  best signal in the system, holds at 55/60%: +11.9/+9.6), **BTC/USD sell +20.4**
  (85.7%, but only n=28).
- Below-base call types to skip: EUR clear bearish (-6.0), Gold clear bearish
  (-10.0), EUR/USD sell (-6.2), XAU/USD sell (54.5% absolute). EUR bullish lean
  looks awful (-14 to -25) but is only n=22.
- **Threshold cost**: moving the target from 50% to 60% of ADR20 costs roughly
  13-16 points of hit rate across the board (e.g. NQ/USD sell 79.6 → 61.3).
- **Confidence still doesn't help at any threshold**: Very Strong is the worst
  bucket in most groups (BTC/USD Very Strong 47.4% vs Weak 88.9%).
- Notable regime paradox: NQ clear bearish adds L2L edge intraday while being
  34.5% correct on the close — down-swings happen, then the index closes back up.
  Good for level-to-level shorts, bad for hold-to-close shorts.

## What needs fixing (proposed, not yet done)

1. **Dashboard honesty**: the L2L Move Research tab shows raw win % with no base-rate
   context. It should display the no-skill baseline and decisive-day accuracy beside
   every win rate, and label EUR/NQ Layer 1 as "no directional edge demonstrated".
2. **Confidence recalibration**: headline confidence needs to be studied against
   outcomes before it is displayed as call quality for trade decisions.
3. **Statistical caveats**: ~12 tests were run; BTC close (p<0.0001) survives any
   correction, Gold close and NQ/USD (p≈0.006-0.007) survive with 3-year stability
   as support, BTC/USD does not yet. Rows are treated as independent days.

## Method notes

- Hourly candles joined by UTC date exactly as the builder does; recomputed
  call-direction outcomes matched the artifact on every row (0 mismatches).
- "Both directions win" days make the L2L metric direction-insensitive; they are
  52-54% of all days (and neither-direction days another 5-15%), leaving only a
  minority of days where the call direction matters at all.
- The L2L metric also ignores adverse excursion: on a both-win day price moved
  ≥ L2L against the call as well. L2L win % therefore cannot prove trade
  profitability on its own even where directional skill exists.
