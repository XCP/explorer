# PEPECASH unsupported-payment sensitivity

Date: 2026-07-18

This is a sensitivity analysis, not a revised admission rule. It asks how the post-2020 payments that fail the frozen
10% dual-market rule are distributed. A match has a complete active day only when that day has at least two completed
BTC dispenser executions, two distinct dispenser sellers, and two completed PEPECASH/XCP executions.

| Year | Matches | Strictly admitted | No dual-market day | Activity failure | Active, 10-15% apart | Active, 15-25% apart | Active, over 25% apart |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021 | 10,840 | 3,074 | 1,208 | 1,356 | 968 | 1,239 | 2,995 |
| 2022 | 2,218 | 280 | 513 | 643 | 73 | 196 | 513 |
| 2023 | 801 | 43 | 356 | 263 | 11 | 42 | 86 |
| 2024 | 140 | 0 | 104 | 5 | 31 | 0 | 0 |
| 2025 | 133 | 0 | 119 | 14 | 0 | 0 | 0 |
| 2026 | 79 | 0 | 68 | 11 | 0 | 0 | 0 |

The 2024 result is genuinely near the boundary: 31 payments have complete multi-market activity and fall between 10%
and 15% disagreement. Changing the frozen threshold after seeing that result would be post-hoc threshold selection,
so these rows should not silently enter the original high-confidence class. They are defensible candidates for a
separately named, visibly lower-confidence sensitivity tier if that tier is declared prospectively and independently
validated.

The 2025-2026 gap is qualitatively different. Most payments have no same-day observation in both markets. The few
overlap days are not near misses: 2025 proportional disagreement ranges from about 92% to extreme outliers, while
2026 ranges from about 36% to extreme outliers, and all also fail at least one activity condition. Relaxing 10% to 15%
or even 25% would add no 2025-2026 payments. Recent support therefore requires new attributable price evidence, not
merely a looser cutoff or a carried PEPECASH price.

Database implementation should preserve three states rather than flattening them: selected high-confidence price,
non-selecting lower-confidence candidate, and unavailable. That permits honest display of uncertainty without turning
a sensitivity analysis into an authoritative historical payment conversion.
