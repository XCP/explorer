# PEPECASH asset-history evaluation

Date: 2026-07-18

This evaluation tests contemporaneous PEPECASH/USD candidates against the purchased asset's strictly prior
PEPECASH-denominated trade history. The reproducible output is
[`pepecash-asset-history-2026-07-18.json`](./data/pepecash-asset-history-2026-07-18.json).

## Coverage and variance

Of 12,850 post-2020 matches with a contemporaneous selected or candidate conversion, 12,749 have at least one prior
PEPECASH trade for the same purchased asset. Across those observations, the new unit payment is a median 4.0 times
away from the asset's prior median; the 75th percentile is 10.6 times and the 90th percentile is 28.4 times. Only
3,982 observations are within 2 times, while 9,124 are within 10 times.

This large dispersion also occurs on strictly corroborated conversion days. Asset-relative deviation therefore
describes an unusual purchase but does not identify which PEPECASH/USD lane is correct. Using it to select a currency
path would circularly prefer the conversion that makes a transaction resemble its past.

## Recent candidate magnitudes

| Year | Candidate payments | Estimated payment total | Median PEPECASH/USD | Median payment | 90th-percentile payment |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2024 | 71 | $23,397-$23,915 | $0.01563 | $121.58 | $439.13 |
| 2025 | 26 | $2,326 | $0.00959 | $62.99 | $148.02 |
| 2026 | 44 | $2,516 | $0.00851 | $17.03 | $113.53 |

The 2024 dispenser-only and XCP-only median PEPECASH prices are $0.01631 and $0.01547, respectively. The 31
dual-lane conflicts add only about $518 between their aggregate low and high payment bounds. This supports reporting
the 2024 candidates as estimates with provenance and ranges.

The 2025 lane medians are $0.00959 for dispenser-only days and $0.00652 for XCP-only days. The 2026 medians are
$0.00851 and $0.00515. These lanes occur on different days, so the difference is not a same-day disagreement measure,
but it argues against collapsing them into an unexplained annual scalar.

## Decision

Store same-day single-lane conversions in a separate estimated-payment projection. For dual-lane disagreement, store
and display the lower and upper payment values. Retain the existing strict conversions as the selected series. Add an
asset-history deviation flag for review and presentation, but do not use that flag to change the PEPECASH conversion
or erase a completed payment. Keep missing evidence null and keep interpolation experimental.

This yields useful recent demand totals without presenting low-liquidity observations as liquidation value, market
capitalization evidence, or a consensus PEPECASH price.
