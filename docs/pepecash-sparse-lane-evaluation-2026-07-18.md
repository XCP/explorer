# PEPECASH sparse-lane evaluation

Date: 2026-07-18

This evaluation asks whether low-volume PEPECASH demand can be estimated without weakening the selected-price rule.
The reproducible result is [`pepecash-sparse-lanes-2026-07-18.json`](./data/pepecash-sparse-lanes-2026-07-18.json).
None of these additional candidates currently writes to the selected price calendar.

## Same-day evidence classes

The dispenser-only lane requires at least two completed purchases from at least two distinct sellers. The XCP DEX-only
lane requires at least two completed executions. Both use an exact UTC day and neither carries a price.

| Year | Payments | Strict dual-lane | Dispenser only | XCP DEX only | Both but conflicting | Unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021 | 10,840 | 3,074 | 1,492 | 469 | 5,202 | 603 |
| 2022 | 2,218 | 280 | 414 | 423 | 782 | 319 |
| 2023 | 801 | 43 | 308 | 83 | 139 | 228 |
| 2024 | 140 | 0 | 22 | 18 | 31 | 69 |
| 2025 | 133 | 0 | 16 | 10 | 0 | 107 |
| 2026 | 79 | 0 | 24 | 20 | 0 | 35 |

This makes 71 of 140 payments in 2024, 26 of 133 in 2025, and 44 of 79 in 2026 measurable from contemporaneous market
evidence. They should be presented as lane-specific estimates, not silently promoted into the high-confidence series.
The conflicting class should expose both values or their range rather than choose the more convenient path.

## Interpolation diagnostic

A leave-one-day-out test interpolated log price only between observations on both sides. With a maximum three-day
bracketing span, 84.0% of dispenser estimates and 80.3% of XCP DEX estimates were within 25% of the omitted same-lane
observation. Median errors were 5.6% and 9.2%; 90th-percentile errors were 56.1% and 38.4%.

This is a temporal-smoothness test against the same lane, not independent truth. It supports an explicit uncertainty
range but not an authoritative scalar. A three-day span would add only 6 otherwise unavailable 2024 payments, none in
2025, and 4 in 2026. Interpolation therefore cannot solve the recent gap by itself.

## Decision

Keep the strict dual-lane result as the selected historical payment conversion. Add a separate estimated-payment
projection for same-day single-lane evidence, retaining lane, counts, volume, price, and uncertainty class. Preserve
conflicting paths as an interval and keep truly unsupported rows null. Interpolation should remain experimental until
validated out of time and assigned a conservative error interval.
