# PEPECASH post-2020 dual-market census

Date: 2026-07-18

This report evaluates a second, non-overlapping PEPECASH admission regime after the Zaif evidence ends. It remains
offline. The immutable row-level result is
[`pepecash-post2020-census-2026-07-18.json`](./data/pepecash-post2020-census-2026-07-18.json).

## Frozen rule

An exact UTC day is admitted only when it has:

- at least two completed PEPECASH dispenser purchases paid in BTC;
- at least two distinct dispenser sellers;
- at least two completed PEPECASH/XCP DEX executions; and
- no more than 10% disagreement between the dispenser/BTC/USD and DEX/XCP/USD paths.

Neither market carries. The selected candidate is the daily PEPECASH-volume-weighted median of completed dispenser
BTC payments because it is a direct PEPECASH payment market with multiple independently identified sellers. The XCP
path is corroboration and cannot fill a day alone.

The 10% band is the previously declared tight agreement band used throughout the pricing diagnostics. It is materially
stricter than the 25% rejection boundary used for the two attributable Zaif markets because this regime lacks an
external fiat-market anchor.

## Result

| Measure                             |        Result |
| ----------------------------------- | ------------: |
| Dual-market overlap days            |           564 |
| Admitted days                       |            73 |
| Rejected overlap days               |           491 |
| Post-2020 PEPECASH-quoted matches   |        14,211 |
| Admitted matches                    |         3,397 |
| Match coverage                      |        23.90% |
| Assets with admitted matches        |           689 |
| Admitted PEPECASH payments          | 44,074,811.67 |
| Approximate historical USD payments | $2,477,740.55 |

Coverage consists of 3,074 matches in 2021, 280 in 2022, and 43 in 2023. No 2024–2026 day satisfies the complete
rule, so those payments remain null.

Combined with the non-overlapping Zaif regime, the proposal admits 28,709 PEPECASH-quoted matches and approximately
$3,535,894.53 of historical payment value. The two regimes have zero match overlap by construction.

## Review

The largest admitted match is 850,000 PEPECASH for one SMUGGLASSES on 2021-09-13, approximately $61,893.01. That day
has 112 completed dispenser purchases from 22 distinct dispenser sellers, 20 PEPECASH/XCP executions, and 2.30% path
disagreement. Other large observations cluster in the documented 2021 Rare Pepe market period and are supported by
multi-seller and cross-market activity rather than a single listing or execution.

The magnitude is a historical payment conversion, not evidence that the purchased asset, all PEPECASH supply, or an
address portfolio could have been liquidated at that unit price.

## Decision

This census passes the bounded coverage gate for a post-2020 candidate. Production implementation may combine it with
the Zaif regime only if it retains regime-specific provenance, exact-day rules, null rejected days, health counts, and
a reversible rebuild. It must not generalize dispenser pricing to arbitrary quote assets or carry these 73 prices
into adjacent days.
