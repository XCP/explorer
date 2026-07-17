# Address Reputation production review

Date: 2026-07-17

## Claim and decision

Address Reputation answers one bounded question: **How substantial and sustained is this address's directly observed
Counterparty track record, relative to other ranked addresses?** It is not identity verification, trustworthiness,
safety, or a prediction that the owner will return.

The production model is a materialized 0–100 population rank. Heavy-tailed observations are log-transformed inside
four equally weighted evidence families:

1. Duration: observed span between first and latest Counterparty activity.
2. Creation: assets that retained holders, dividends, and locked asset supply.
3. Economic: Bitcoin fees, clean BTC spent collecting, and clean dispenser proceeds.
4. Participation: collecting breadth, completed DEX matches, and Stamps created.

Each family is converted to a population percentile, the four percentiles are averaged, and the result is ranked
again onto the public 0–100 scale. Reputation refreshes daily. Exact current activity remains a separate fact.

## Why this replaces the former model

The former read-time score combined hand weights, fixed score anchors, block-height bonuses, decay, current XCP
holdings, and categorical tiers. Those choices mixed accumulated history, present activity, infrastructure identity,
and implied trust without one testable claim.

Leakage-safe 180-day evaluations at three historical cutoffs found that recency beat balanced participation for broad
future return and persistence outcomes. Balanced participation was stronger only at a small top-review budget. The
evidence therefore rejected one universal address predictor. Reputation remains descriptive track record; exact
recency is shown separately and arbitrary activity-day boundaries were removed.

## Comparison contract

Exchanges, exchange deposit addresses, Emblem Vault custody addresses, burn addresses, likely service hubs, and
addresses with directly evidenced integrity incidents are classified rather than ranked. An otherwise user-like
address enters the comparison set only when at least one evidence family is observed.

The production refresh ranked 337,069 addresses. The source census contained 24 exchanges, 24,611 exchange deposits,
52,370 vaults, 103 burn addresses, 11 likely services, and one evidenced integrity address. The post-refresh invariant
query found **zero classified addresses in the ranked population**.

## Distribution

| Band | Definition | Addresses |
| --- | --- | ---: |
| Exceptional | 99–100, top 1% | 3,371 |
| Strong | 90–98.9, next 9% | 30,336 |
| Established | 50–89.9, upper half | 134,828 |
| Limited | 0–49.9 | 168,534 |

The observed range is exactly 0–100. All materialized rows share one population count, calculation timestamp, and
model version.

## Weight and sensitivity review

Creation evidence is intentionally sparse: 333,896 ranked addresses have no qualifying creation evidence, compared
with 199,728 for economic evidence, 164,399 for duration, and 96,183 for participation. It is nevertheless meaningful
at the top of the ranking: removing creation retains 67 of the top 100. Leave-one-family-out top-100 overlap was 43
without duration, 67 without creation, 68 without economic evidence, and 85 without participation. No family is
decorative; duration and economic evidence have the broadest ranking influence, while rare creation evidence provides
strong discrimination among deeply established addresses.

Equal family weights are retained because there is no defensible outcome that turns a descriptive track record into a
supervised optimization target. Predictive weighting would contradict the claim and the historical cutoff results.
Changing a family or weight requires rerunning the historical evaluation, production invariant audit, leave-one-family
out review, and named top-address review.

## Operations

- `npm run evaluate:reputation -w xcp-api` reruns the leakage-safe historical outcome comparison.
- `npm run audit:address-reputation -w xcp-api` checks production exclusions, metadata invariants, distribution,
  family coverage, leave-one-family-out sensitivity, and the top 25 addresses.
- `/v2/reputation/review` exposes model metadata, distribution, family weights, and a bounded face-validity sample.
- `/reputation` explains the claim, scale, inputs, current distribution, exclusions, and limitations.
