# PEPECASH-quoted trade admission census

Date: 2026-07-18

This completes roadmap C3 without changing production. The immutable row-level
[`census`](./data/pepecash-trade-census-2026-07-18.json) records a decision and reason for every completed
PEPECASH-quoted Counterparty match.

## Orientation and scope

A match is PEPECASH-quoted only when one leg is PEPECASH and the other leg is neither XCP nor BTC. PEPECASH/XCP and
PEPECASH/BTC matches are market observations, not purchases denominated in PEPECASH. Quantities are oriented using
the sold asset's divisibility. The census contains 43,430 matches across 2,080 assets: 5,809 have PEPECASH in the
forward leg and 37,621 in the backward leg.

## Result

| Measure                             |        Result |
| ----------------------------------- | ------------: |
| Proposed matches                    |        43,430 |
| Admitted                            |        25,312 |
| Rejected                            |        18,118 |
| Match coverage                      |        58.28% |
| Assets with an admitted match       |         1,926 |
| Admitted PEPECASH payments          | 95,126,000.08 |
| Approximate historical USD payments | $1,058,153.98 |
| Admitted with exact ECB FX          |        17,357 |
| Admitted with carried ECB FX        |         7,955 |

Coverage is concentrated where attributable Zaif evidence exists: 88.93% of 2017 matches and 92.46% of 2018 matches
are admitted. It falls to 58.92% in 2019 and 25.72% in 2020. No post-2020 match is admitted because the Zaif market
archive has no later execution observation; current prices and stale market carries are not substituted.

## Rejections

| Reason                            | Matches |
| --------------------------------- | ------: |
| Missing market                    |  14,669 |
| Missing corroborating path        |   1,336 |
| Severe path disagreement          |   1,266 |
| Insufficient activity             |     760 |
| Non-overlapping execution windows |      87 |

The rejection hierarchy is deterministic. A row receives the first applicable factual reason, so categories are
mutually exclusive and sum exactly to all rejected rows.

## Review samples

The largest admitted payment is 665,000 PEPECASH for 10 MODERNPEPE on 2017-07-04, approximately $10,922.09. Its two
paths differ by about 5.2%, with at least 37 executions. Other large admitted observations include LORDKEK and
RAREPEPE trades during high-activity periods. Fractional LORDKEK quantities are preserved as protocol facts rather
than rounded into indivisible units.

The earliest PEPECASH-quoted trade is a 5,000,000 PEPECASH PEPEPIZZA match on 2016-09-30. It remains unpriced because
it predates the Zaif history. Large thin-market and severe-disagreement samples remain rejected even when their
payment amount is economically interesting. The immutable report retains 25 examples from each required review
class plus every row-level decision.

## Decision

C3 passes its reproducibility and explainability gate. It establishes a bounded production opportunity, not an
automatic deployment decision. C4 may implement only these 25,312 admitted historical payments using the retained
JPY candidate and full provenance. It must leave all 18,118 rejected matches null and must not create a generic quote
graph, post-2020 carry, or PEPECASH-based market capitalization by side effect.
