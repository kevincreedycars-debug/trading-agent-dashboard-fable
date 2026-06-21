# Backtester Foundation

This directory contains the repo-side foundation for the observation-first backtester and research platform.

The backtester is downstream-only.

Safety rules:

- Do not read backtester outputs from live Layer 1 agents.
- Do not feed backtester outputs into collectors, agents, or live signal workflows.
- Do not change the live Layer 1 data contract to support the backtester.
- Treat `agent_outputs` as an upstream historical source, not a dependency to redesign.

## Purpose

The long-term platform has three research goals:

1. Evaluate agent directional accuracy across timeframes.
2. Research factor reliability and factor combinations.
3. Support future optimization without contaminating production Layer 1 logic.

## Observation-First Model

The primary object is an Observation.

An Observation is one permanent record of everything known at the moment an agent made a decision:

- market snapshot
- market regime
- warnings
- missing inputs
- agent verdict
- timeframe predictions
- factor observations
- model and workflow versions
- realized outcomes
- later AI reviews
- later optimization results

## Current Scope

Phase 1 adds safe scaffolding only:

- canonical timeframe constants
- legacy-to-canonical mapping definitions
- observation normalizer for existing `agent_outputs` rows
- schema documentation
- SQL for research tables

This directory does not wire the backtester into production workflows.

## Structure

- `constants/`: shared research constants
- `mappings/`: legacy-to-canonical field and timeframe mappings
- `normalizers/`: transforms existing upstream shapes into observation-first research records
- `schema/`: human-readable schema and architecture notes
- `sql/`: SQL to create the research tables manually in Supabase/Postgres
