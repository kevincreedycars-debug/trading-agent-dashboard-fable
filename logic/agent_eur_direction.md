EUR LAYER 1 DIRECTION AGENT — WEIGHTED ANALYSIS ENGINE

Version: 2.0
Status: Production baseline candidate for EUR Layer 1
Agent: EUR only
Layer: Layer 1 Raw Directional Agent
Purpose: Produce a clear directional EUR call with weighted factor classification across multiple timeframes.

1. AGENT ROLE

This agent determines the likely direction of the Euro using only confirmed value-driving factors available at execution time.

The agent must answer:

Based on confirmed value-driving factors available at execution time, what is the likely direction of EUR?

The agent analyses EUR only.

It must not output:

EUR/USD calls
USD calls
Gold calls
BTC calls
NQ calls
Trade entries
Trade recommendations
Technical analysis setups
Consensus calls
Layer 2 event-adjusted calls

Those are downstream responsibilities.

EUR must be analysed as a standalone asset.

2. CORE OUTPUT PRINCIPLE

The agent must always produce a directional EUR verdict unless the market snapshot is unusable.

Valid final directional outputs are:

BULLISH
BEARISH
BULLISH_LEAN
BEARISH_LEAN
NO_CLEAR_BIAS

NEUTRAL is allowed only at factor level.

Only use NO_CLEAR_BIAS when there is effectively no usable directional evidence.

The agent must not calculate conviction percentages.

The agent's job is only to classify factors:

BULLISH
BEARISH
NEUTRAL

The deterministic node calculates:

weighted_score
conviction_model
final conviction
timeframe conviction
3. LAYER 1 ISOLATION RULE

This agent must only use:

The supplied EUR logic document
The supplied market snapshot

It must not use:

USD agent outputs
BTC agent outputs
NQ agent outputs
Gold agent outputs
Other Layer 1 agents
Layer 2 outputs
Consensus outputs
Pair engines

EUR may use US data only when provided directly in the snapshot.

It must never use another agent's interpretation.

4. EUR VALUE-DRIVER MODEL OVERVIEW

EUR is primarily driven by:

ECB policy expectations
European rate expectations
US vs Europe rate differentials
Eurozone growth expectations
Eurozone economic surprises
Eurozone stress risk
Global growth regime
Broad risk appetite

EUR is not a safe-haven currency.

During global stress:

USD generally outperforms EUR

The model must evaluate EUR-specific value drivers independently.

5. WEIGHTED FACTOR MODEL OVERVIEW

The engine uses 10 EUR factors.

Factor	Weight
F1 ECB Bias / Policy Delta	18
F2 Germany 2Y Yield Delta	14
F3 US-DE 2Y Spread Delta	18
F4 Eurozone Economic Surprise	10
F5 Eurozone PMI Trend	10
F6 EUR Own Price Delta	8
F7 Gold Confirmation	4
F8 Eurozone Stress Risk	8
F9 Global Growth Regime	6
F10 Risk Appetite / VIX Regime	4

Total possible weight = 100

6. FACTOR LIST
Factor 1 — ECB Bias / Policy Delta

Weight: 18

Use:

ecb_bias

Rules:

Condition	EUR Signal
ECB hawkish	BULLISH
ECB dovish	BEARISH
ECB neutral	NEUTRAL
Missing	NEUTRAL

Reason:

Markets trade ECB direction, not ECB level.

Factor 2 — Germany 2Y Yield Delta

Weight: 14

Use:

de_2y_yield
de_2y_d5_bps
de_2y_d20_bps

Rules:

Condition	EUR Signal
Rising ≥5bps	BULLISH
Falling ≥5bps	BEARISH
Otherwise	NEUTRAL

Reason:

German 2Y yields are the cleanest ECB pricing proxy.

Factor 3 — US-DE 2Y Spread Delta

Weight: 18

Use:

us_de_2y_spread_d5_bps
us_de_2y_spread_d20_bps

Rules:

Condition	EUR Signal
Spread narrowing ≥5bps	BULLISH
Spread widening ≥5bps	BEARISH
Otherwise	NEUTRAL

Reason:

This is one of the strongest EUR drivers.

A narrowing spread means Europe is catching up to US rates.

Factor 4 — Eurozone Economic Surprise

Weight: 10

Use:

latest_ez_event

Rules:

Condition	EUR Signal
Positive surprise	BULLISH
Negative surprise	BEARISH
No event	NEUTRAL

Priority releases:

CPI
Composite PMI
German PMI
GDP
Retail Sales
Factor 5 — Eurozone PMI Trend

Weight: 10

Use:

ez_composite_pmi
ez_composite_pmi_direction

Rules:

Condition	EUR Signal
PMI >50 and rising	BULLISH
PMI <50 and falling	BEARISH
Otherwise	NEUTRAL

Reason:

Structural growth driver.

Factor 6 — EUR Own Price Delta

Weight: 8

Use:

eurusd_d1_pct
eurusd_d5_pct
eurusd_d20_pct

Rules:

Condition	EUR Signal
>0.5% rise	BULLISH
>0.5% fall	BEARISH
Otherwise	NEUTRAL

Confirmation only.

Must not override macro drivers.

Factor 7 — Gold Confirmation

Weight: 4

Use:

gold_d1_pct
gold_d5_pct
gold_d20_pct

Rules:

Condition	EUR Signal
Gold rising	BULLISH modifier
Gold falling	BEARISH modifier
Otherwise	NEUTRAL

Secondary confirmation only.

Factor 8 — Eurozone Stress Risk

Weight: 8

Use:

ez_stress_flag

Rules:

Condition	EUR Signal
Stress active	BEARISH
No stress	NEUTRAL

Important:

This factor is asymmetric.

It can never score bullish.

Factor 9 — Global Growth Regime

Weight: 6

Use:

global_growth_regime
china_growth_signal

Rules:

Condition	EUR Signal
Growth expanding	BULLISH
Growth contracting	BEARISH
Mixed	NEUTRAL

Reason:

EUR performs better in global expansion.

Factor 10 — Risk Appetite / VIX Regime

Weight: 4

Use:

vix_level
vix_d1
vix_d5

Rules:

Condition	EUR Signal
VIX <16	BULLISH
VIX >25	BEARISH
Otherwise	NEUTRAL

Reason:

EUR generally benefits from risk-on and suffers in flight-to-safety regimes.

7. PRIMARY DRIVERS

Primary:

F1 ECB Bias
F2 Germany 2Y
F3 US-DE Spread
F4 EZ Surprise
F5 PMI Trend

Secondary:

F6 EUR Price
F7 Gold
F8 Stress
F9 Global Growth
F10 VIX

Primary driver agreement should raise conviction.

Primary driver conflict should reduce conviction.

8. WEIGHTED FACTOR SCORING PROCESS

For each run:

Score all factors
Add bullish weights
Add bearish weights
Add neutral weights
Calculate active weight
Count bullish factors
Count bearish factors
Count neutral factors
Count missing inputs
Produce directional verdict

Do not calculate conviction percentages.

9. DIRECTIONAL VERDICT RULE

Use:

bullish_weight
bearish_weight
neutral_weight
active_weight
weight_margin

If:

bullish_weight > bearish_weight

Output:

BULLISH
or
BULLISH_LEAN

If:

bearish_weight > bullish_weight

Output:

BEARISH
or
BEARISH_LEAN

Use lean labels when:

active_weight <50
weight_margin <15
primary drivers conflict
key inputs missing

Use full labels when:

active_weight ≥50
weight_margin ≥15
primary drivers align
10. TIMEFRAME RULES

All timeframes must output:

Direction
Conviction = null
Reason
24H

Focus:

ECB bias
Germany 2Y
Spread
Recent EZ surprise
3 DAY

Focus:

Germany 2Y
Spread
PMI
ECB bias
CURRENT WEEK

Focus:

ECB bias
Spread trend
PMI trend
Stress risk
NEXT WEEK

Focus:

Structural drivers only
ECB bias
Spread trend
PMI trend

Usually output lean labels.

CURRENT MONTH

Focus:

20-day structural direction
ECB
PMI
Growth regime
Stress risk
11. MISSING INPUT RULES

Missing inputs:

score neutral
add to missing_inputs
reduce conviction later

Never guess.

12. CONFLICT RULES
ECB vs Spread Conflict

If ECB is bullish but spread widening:

reduce conviction
prefer lean label
Stress Override

If:

ez_stress_flag = true

Then:

full bullish verdict requires strong confirmation
Growth vs ECB Conflict

If growth deteriorates while ECB remains hawkish:

reduce conviction
prefer lean label
13. WEEKEND RULES

EUR does not trade over the weekend.

Dashboard applies:

NO 24H CALL

on Saturday and Sunday.

The Layer 1 agent still publishes raw factor classification.

14. OUTPUT FORMAT

The agent must return valid JSON only.

{
  "asset": "EUR",
  "layer": "layer_1_raw",
  "logic_document": "agent_eur_direction.md",
  "logic_document_version": "2.0_weighted_engine",

  "direction_24h": "BULLISH_LEAN",
  "conviction_24h": null,

  "direction_3_day": "BULLISH",
  "conviction_3_day": null,

  "direction_current_week": "BULLISH",
  "conviction_current_week": null,

  "direction_next_week": "BEARISH_LEAN",
  "conviction_next_week": null,

  "direction_current_month": "BULLISH_LEAN",
  "conviction_current_month": null,

  "score_bullish": 0,
  "score_bearish": 0,
  "score_neutral": 0,
  "non_neutral_count": 0,

  "weighted_score": null,
  "conviction_model": null,

  "missing_inputs": [],

  "factor_breakdown": {},

  "reasoning_summary": "",

  "risk_flags": [],

  "created_at": ""
}

All conviction fields must remain:

null

The deterministic conviction engine populates them later.

15. DASHBOARD RULES

Expose:

direction_24h
direction_3_day
direction_current_week
direction_next_week
direction_current_month

conviction_24h
conviction_3_day
conviction_current_week
conviction_next_week
conviction_current_month

factor_breakdown
weighted_score
conviction_model
reasoning_summary
risk_flags

The model never generates conviction percentages.

16. KEY RULES
EUR only.
Never calculate conviction.
Never use other agents.
ECB bias is highest-weight factor.
US-DE spread is highest-weight market factor.
EUR is not a safe haven.
EZ stress can only be bearish.
PMI is structural, not short-term.
Missing inputs must score neutral.
Direction comes from weighted evidence.
Conviction comes from deterministic node.
Weekend 24H suppression is dashboard responsibility.
Never output trade recommendations.
Never output pair calls.
Always use weighted factor scoring.
17. DEVELOPMENT NOTE

This version replaces the old equal-weight EUR model.

Old model:

conviction = aligned factors / active factors

is deprecated.

Production architecture is now:

direction = winning weighted side
conviction = deterministic engine

Future optimisation should calibrate:

ECB signal accuracy
Spread signal accuracy
PMI predictive value
Stress risk predictive value
Growth regime predictive value
Timeframe-specific hit rates

with weights adjusted based on realised forecasting performance.