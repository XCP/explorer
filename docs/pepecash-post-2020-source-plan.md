# PEPECASH post-2020 price-source plan

Date: 2026-07-18

C3 establishes what the recovered Zaif archive can support; it does not establish that post-2020 PEPECASH is
unpriceable. This plan defines the additional evidence search before C4 freezes production coverage.

## Identity boundary

Native Counterparty PEPECASH is CoinMarketCap UCID 1405, with `xchain.io` as its explorer and approximately 701.88
million total units. This is the identity relevant to historical Rare Pepe payments.

Do not import CoinGecko `pepecash-2` or CoinMarketCap UCID 36656. Those pages identify Ethereum contract
`0x3230d8e0ac4d6887cf3bddd57e9d8c1a06f33b62`, whose tracked market begins in 2025. A matching ticker and similar
supply do not prove redemption, custody, or economic identity with the Counterparty asset.

## Source track 1 — original CMC aggregate

Recover an official historical export for UCID 1405, preserving daily close, volume, market capitalization, identity,
and provider precision. CMC still maintains the original identity page and describes TuxExchange, Zaif, Counterparty
DEX, and Dex-Trade as its historical markets. The export may therefore extend beyond the Zaif execution archive.

Admission requires an official export or documented API response tied to UCID 1405. Search-engine snippets,
third-party chart copies, and ticker-only downloads are not acceptable. Any recovered series remains an aggregate
observation and must be compared against overlapping Zaif and on-chain candidates before selection.

## Source track 2 — attributable Counterparty PEPECASH/XCP

The canonical ledger contains the following completed PEPECASH/XCP executions after 2020:

| Year                 | Executions | Active days | PEPECASH volume |
| -------------------- | ---------: | ----------: | --------------: |
| 2021                 |      1,182 |         178 |   10,947,225.30 |
| 2022                 |        798 |         237 |   14,699,745.59 |
| 2023                 |        350 |         156 |    6,710,189.27 |
| 2024                 |        161 |          68 |    4,473,093.44 |
| 2025                 |         65 |          38 |      419,780.92 |
| 2026 through July 18 |         93 |          39 |      307,888.50 |

This supports a candidate `PEPECASH → XCP → USD` path from attributable executions and the selected XCP/USD calendar.
It does not yet support admission. Against the older Zaif JPY benchmark, the unfiltered daily on-chain path has median
absolute log error 0.175 and only 60.82% of days within 25%. Even days with at least ten executions reach only 70.73%
within 25%. Simple execution or volume thresholds are insufficient.

The next evaluation must be historical-cutoff safe and compare same-day VWM with trailing robust estimators built only
from prior and current executions: rolling log median, volume-weighted log median, and median/MAD filtering. It must
predeclare maximum age, minimum independent matches, minimum volume, and disagreement checks against any recovered
aggregate. No future trade can smooth an earlier price.

## Source track 3 — additional attributable archives

- Ask Dex-Trade for historical PEPECASH/BTC executions or candles tied to an exact market identity. The current
  ticker endpoint is only a latest-execution observation and cannot backfill history.
- Countertools documents PEPECASH daily snapshots and confidence labels, but its public endpoints currently return a
  site 404 and its pricing methodology fields are described as internal. Treat it as a lead until raw source,
  constituent, timestamp, and reproducibility details are available.
- Search for licensed TuxExchange or other historical execution archives. Do not reconstruct them from screenshots or
  generic chart sites.

## Decision sequence

1. Recover CMC UCID 1405 history if an official export is available.
2. Build and retrospectively evaluate on-chain XCP-path estimators against the 2017–2020 Zaif holdout.
3. Freeze rules before measuring post-2020 trade coverage.
4. Use exact-day admitted observations first; evaluate a short carry only as a separate cohort.
5. Return to C4 with a combined census. Unsupported days remain null.

This is a bounded expansion of explicit path classes, not permission for generic recursive routing.

## Evaluation update

The causal XCP-estimator evaluation is checked in as
[`pepecash-xcp-estimators-2026-07-18.json`](./data/pepecash-xcp-estimators-2026-07-18.json). Same-day VWM remains the
least inaccurate tested method at 60.82% within 25%. Trailing 7-, 14-, and 30-day VWM and a 14-day median/MAD filter
all perform worse. Their apparent post-2020 coverage is therefore rejected as smoothing-driven coverage, not improved
measurement.

Completed PEPECASH dispensers provide a second attributable market: exact PEPECASH quantities exchanged for exact BTC
payments. The immutable [`dispenser evaluation`](./data/pepecash-dispenser-prices-2026-07-18.json) contains 1,131
daily observations from 5,303 executions. Its direct Zaif overlap is too small for standalone validation, so a
dispenser-only calendar is not admitted.

A strict dual-market candidate is promising. On post-2020 days requiring:

- same-day dispenser PEPECASH/BTC and Counterparty DEX PEPECASH/XCP observations;
- at least two executions in each market;
- at least two distinct dispenser sellers; and
- maximum 10% disagreement between the independently converted USD paths;

73 days pass. They cover 3,397 PEPECASH-quoted matches across 689 assets: 3,074 matches in 2021, 280 in 2022, and 43 in 2023. This is the next candidate for a row-level census. It does not yet support 2024–2026, and neither path may carry.
