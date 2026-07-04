# OANDA daily OHLC importer

Downloads daily OHLC candles from the OANDA v20 REST API into tracked caches under
`backtester/cache/ohlc/`, for use by the ADR/L2L reach research builder.

## Credentials

Set these environment variables (never commit them):

- `OANDA_API_TOKEN` (required) — personal access token from the OANDA account portal.
- `OANDA_ENV` (optional) — `practice` (default) or `live`. Must match where the token was issued.
- `OANDA_ACCOUNT_ID` (optional) — only needed for `--list-instruments` when the token can see multiple accounts.

## Verify the account's instrument names first

ADR reach research must use the instruments actually traded in the account. List them:

```
node backtester/importers/oanda/download_oanda_daily_ohlc.js --list-instruments
```

Expected mappings (confirm against the listing before downloading):

- EUR/USD -> `EUR_USD`
- XAU/USD -> `XAU_USD`
- NAS100/NQ CFD -> `NAS100_USD` (name can differ by division; use the exact name from the listing)

## Download

```
node backtester/importers/oanda/download_oanda_daily_ohlc.js
```

Defaults: instruments `EUR_USD,XAU_USD,NAS100_USD`, range `2023-11-01`..today, `--alignment=utc`.
Override with `--instrument=NAS100_USD --start=2023-11-01 --end=2026-07-04 --alignment=ny17`.

Alignment:

- `utc` (default): candles cover UTC calendar days (dailyAlignment=0), matching the Binance
  BTCUSDT cache and the checker artifacts' calendar-date convention.
- `ny17`: platform-style FX session days (17:00 New York alignment); the candle is labeled
  with the session close date.

Output CSVs are written to `backtester/cache/ohlc/<instrument>_daily_oanda.csv` with columns
`instrument,date,open,high,low,close,volume,source,complete`. Incomplete (still-forming)
candles are stored with `complete=false` and excluded by the research builder.

## After downloading

Regenerate the ADR reach artifact:

```
node backtester/scripts/validate_adr_reach_research.js --write
node backtester/scripts/validate_adr_reach_research.js
```

The builder automatically prefers OANDA caches over legacy fallback sources
(Alpha Vantage EUR/USD, QQQ proxy for NQ) once the cache files exist, and Gold
ADR reach unlocks as soon as `xau_usd_daily_oanda.csv` is staged.
