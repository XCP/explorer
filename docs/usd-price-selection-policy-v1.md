# USD selected-price policy: `usd-payment-v1`

Date: 2026-07-18

This policy controls the compact daily `prices` projection used for historical payment conversion. It does not select
a fair value or reference price, and diagnostic disagreement does not alter the winner.

## Ordering

Candidates first compare the established integer fidelity tier. A higher tier wins. Equal tiers use this fixed source
order:

1. `coinbase`
2. `coinbase_spot`
3. `coinmarketcap_aggregate`
4. `dextrade_xcpbtc_spot`
5. `burn_vwm`
6. `dex_vwm`
7. unrecognized legacy sources

The list spans multiple fidelity tiers deliberately: fidelity remains the primary comparison, while the list resolves
only ties. A write from the same source may refresh its own value. A lower-ranked different source cannot replace an
equal-fidelity winner.

## Evidence interpretation

- Coinbase daily closes are direct observed USD market prices and remain the primary BTC/USD and ETH/USD calendar.
- Coinbase spot is a same-day fallback, never a historical backfill.
- CoinMarketCap is a direct observed aggregate USD close and remains the broad XCP/USD history and early BTC/USD
  history.
- Dex-trade spot is a latest-execution cross-rate used only for today's operational coverage.
- Burn VWM and DEX VWM are derived XCP/BTC × BTC/USD paths. They remain below direct USD observations.
- Observation count, venue count, volume, age, path depth, and disagreement are retained or derivable evidence, but
  version 1 does not introduce post-hoc thresholds based on the observed diagnostic results.

## Determinism and scope

The former `current fidelity <= candidate fidelity` rule allowed two different equal-fidelity sources to select the
last job that happened to run. Version 1 replaces that ambiguity with an explicit source tie-break. A regression test
applies CMC aggregate and dex-trade spot in both orders and requires the same CMC winner.

This policy is intentionally narrow. It does not admit PEPECASH/USD, recursively route arbitrary quote assets, use CMC
volume residuals as prices, or change the seven-day freshness bound on the existing Counterparty DEX derivation.

## Materialized explanation

Migration 0074 adds the policy version, direct/derived kind, age, derivation depth, observation and venue counts, base
volume, disagreement state, and selection reason to every selected row. Historical rows are deterministically
backfilled from their retained source and observation day; unavailable historical counts remain null rather than
being invented. New aggregate and derived selections copy counts and volume from their underlying observation.

`price_selection_changes` records replacements only when price, source, or observed day changes. It retains the old
and new selections, policy version, timestamp, and stated reason. Metadata-only refreshes do not inflate the log.
