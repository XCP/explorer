# New Radar model

Model identifier: `new-radar-2026-07`

Status: accepted shadow baseline. Do not replace the public Radar until the canonical projection reproduces the
research evaluator and named candidates pass review.

## Product claim

New Radar surfaces early, observable market formation around recently issued Counterparty assets. It does not claim
investment quality, fair value, future return, organic behavior, or safety.

## Clock and states

- **Fresh:** 7 through 29 complete days after first valid issuance. Show preliminary facts without the ranked
  Emerging label.
- **Emerging:** 30 through 89 complete days. Rank using the frozen first-30-day market evidence below.
- **Graduated:** 90 complete days. Remove from New Radar; retain the evidence on the asset page.
- Assets younger than seven days remain ordinary recent issuances, not scored opportunities.

Every age boundary uses `assets.first_issuance_block_time`, derived from the first valid issuance. Never approximate
time with a fixed number of Bitcoin blocks.

## Eligibility

An Emerging asset must:

1. have a valid first issuance timestamp and be 30-89 complete days old;
2. have positive current supply;
3. not be classified `low_quality`;
4. have at least one completed, non-self trade during its first 30 days;
5. have a canonical asset identity.

Numeric assets, subassets, divisible assets, and assets without collection membership are not excluded merely for
being in those categories. Those are factual attributes, not quality judgments.

## Ranking

For the eligible Emerging population at the observation time:

```text
buyer_rank = PERCENT_RANK(distinct non-self paid buyers in first 30 days)
active_day_rank = PERCENT_RANK(distinct UTC trade days in first 30 days)

market_formation = 0.50 * buyer_rank + 0.50 * active_day_rank
```

Order descending by `market_formation`, then buyer count, active-day count, first issuance time, and canonical asset
identity for deterministic ties. The percentile is relative to the current Emerging cohort; return the underlying
counts so users can interpret the rank when the cohort is small.

A completed trade is non-self when buyer or seller identity is unavailable from a real external provider sale, or
when both are known and differ. Same-identity DEX and Emblem rows do not contribute to features or validation
outcomes.

## Evidence shown beside the rank

These fields do not change the baseline rank:

- first-30-day trade count;
- distinct sellers;
- late buyers in days 16-30;
- distinct active days and first-to-last market span;
- completed-sale venue mix;
- current holders, supply, issuer share, and top-holder share;
- collection membership evidence and corroborating source count;
- low-quality or infrastructure classifications;
- model identifier, issuance time, observation cutoff, and evidence freshness.

Venue diversity is corroborating evidence only. It has positive standalone association with later markets, but a 10%
weight added to buyer breadth and active days produced no improvement in two temporal folds and regressed two.
DEX quote-pair diversity remains untested until the analytical snapshot preserves quote-currency identity.

Fairmint participation is primary-market evidence, not a completed secondary sale. Count every valid non-issuer
Fairminter as intentional participation because even a zero-XCP-price Fairmint requires an on-chain Bitcoin
transaction and its fee. Report XCP-paying Fairminters (`paid_quantity > 0`) separately. Do not add either count to
the baseline weight yet: Fairmints currently cover only 247 assets, and the mature day-30/day-180 Fairmint subgroup
contains 203 assets but only one strict later broad-market outcome. That is insufficient for a stable coefficient.

## Evidence for the baseline

The cutoff-safe evaluator reconstructs exact holder state from 7.16 million ledger events and uses actual Bitcoin
timestamps. The mature day-30 population contains 148,560 positive-supply assets with holders. Validation uses four
temporal issuance folds and day-180 outcomes.

- Paid buyer breadth and active trading days consistently outperform raw holders, issuer output count, and venue
  diversity for later market formation.
- Exact ordinary non-issuer holder retention validates holder breadth as useful evidence, but mass airdrops create
  named false positives with roughly 9,400 holders and only one or two buyers.
- Richer holder, concentration, persistence, and venue challengers do not beat the two-factor core consistently.
- Against the common day-90-through-180 market window, day 90 is most predictive but too late for discovery. Day 30
  preserves useful precision while leaving a 60-day opportunity window. Day 7 is materially noisier.
- Excluding 18,399 same-identity trades across 1,486 assets does not materially change model ordering.

The reproducible implementation is `ops/build-radar-new-features.mjs` plus `ops/evaluate-radar-new.mjs`. Research
results and limitations are recorded in `docs/radar-research-plan-2026-07.md`.

## Canonical serving projection

Create one compact, upsert-only emergence projection keyed by `asset_id`. It should freeze first-30-day counts after
the cutoff and retain them after graduation for auditability. Do not calculate the full history in the public route.

The writer must derive its rows from `assets` and `trades`, use the existing `(asset_id, block_time)` trade index,
and converge on replay. The current 90-day production workload is approximately 5,200 assets and 2,525 trades.
Projection fields should contain raw counts and timestamps, not a stored percentile; cohort percentile ranking belongs
in the bounded read query.

Acceptance:

1. fresh migration and existing-database migration tests pass;
2. repeated writer runs converge without delete-and-replace behavior;
3. same-identity trades are excluded;
4. assets freeze at the exact 30-day timestamp and graduate at 90 days;
5. a local fixture matches the research SQL for every raw feature;
6. the public query has a documented seek/bounded query plan;
7. shadow candidates receive named review before the route changes.

## API and frontend contract

The eventual Radar response should have separate `fresh`, `emerging`, and `dislocations` sections. An Emerging row
must expose the raw evidence and a short reason such as “12 buyers across 8 active days,” not only a score.

The frontend should provide:

- stage and age;
- buyer and active-day evidence;
- holder/distribution facts;
- collection and venue chips;
- explicit preliminary treatment for Fresh assets;
- a methodology link and model identifier;
- no “undervalued,” “smart money,” “organic,” or expected-return language.

## Change control

Any weight or eligibility change requires temporal-fold results, whole-ranking metrics, named entrants/exits, query
cost, and a worst-fold regression statement. A challenger replaces the baseline only when it improves bounded-review
precision and average precision/NDCG without relying on a longer outcome window. Forward recommendations must be
frozen before outcomes are observed.
