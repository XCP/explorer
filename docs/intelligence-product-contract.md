# Intelligence product contract

This is the production end state for the explorer's ratings, reputation, discovery, and relationship products. It
defines what each product measures, the evidence it may use, what users see, and the claim we are willing to make.
Implementation and copy must conform to this contract. Research variants remain offline until they pass the named
acceptance gate for the product they would replace.

## Shared principles

1. **One question per output.** Historical market evidence, holder conviction, likely continued activity, network
   relationships, and integrity are different questions and must not be blended into one universal quality score.
2. **A score is a relative rank, not a probability.** A displayed 82 means stronger evidence than most eligible
   peers under a named model. It does not mean an 82% chance of appreciation, legitimacy, or future activity.
3. **Show the evidence beside the summary.** Exact buyers, active months, realized value, holders, concentration,
   last activity, and classifications are more durable than a model version.
4. **Keep integrity categorical.** Directly evidenced manipulation, invalid data, infrastructure, and reviewed
   low-quality classifications are flags or eligibility rules, not vague negative weights hidden inside a score.
5. **Conserve economic value.** One payment is one payment. Bundle membership can prove participation but cannot
   manufacture a price for every constituent.
6. **Prefer direct evidence to proxies.** Known distinct counterparties and attributable payments outrank volume,
   shared-address patterns, graph proximity, collection fame, or issuer output.
7. **Every model has an evaluation owner.** Changes require temporal cutoffs, ranking metrics, named entrants/exits,
   subgroup stability, query cost, and a stated rollback criterion.

## Asset Rating

### User question

How substantial is this asset's demonstrated historical market record?

### Production model

For every eligible asset, compute three within-era percentile components from attributable direct sales:

- **Market duration:** distinct active sale months.
- **Buyer breadth:** distinct known buyers, with buyer and seller required to be different identities.
- **Realized value:** `log1p` of total USD consideration, valued at the trade time where price data exists.

Rating is the equal-weight mean of those three components, converted to a 0–100 population rank. Equal weighting is
the accepted transparent baseline: the leakage-safe historical evaluation beat the buyer-gated peak-sale production
proxy at every cutoff on future return, persistence, buyer breadth, future realized value, average precision, and
NDCG. More complex correlated factor families have not earned incremental weight.

The number is accompanied by coarse relative tiers:

- **Bluechip:** exceptional demonstrated market record.
- **Premium:** strong, broad, durable market record.
- **Notable:** meaningful market evidence.
- **Speculative:** thin or limited market evidence, or an integrity-capped asset.
- **Untraded / Dormant:** honest unranked states, not zero-quality verdicts.

Tier cutoffs are distributional and versioned with the materialized Rating population. They are not handcrafted per
asset. A `low_quality` asset retains its factual market history but is capped at Speculative and excluded from ranked
recommendation products.

### Eligible sale evidence

- DEX matches with known, distinct counterparties.
- Single-asset dispenser purchases with known, distinct buyer and seller.
- Intact single-asset Emblem Vault sales with known, distinct buyer and seller.

Excluded from direct Rating value and buyer counts:

- self trades;
- unknown or identity-less counterparties;
- invalid transactions;
- bundle payments allocated to individual legs;
- post-crack, empty-shell, or classified dump-vault Emblem sales;
- listings, asks, and unfilled orders.

Excluded trades remain in historical trade data under an explicit classification. They are not deleted.

### Frontend

The asset header shows tier and Rating. The nearby explanation says **“Relative historical market evidence”**, never
“investment quality” or “chance of return.” The expanded evidence shows active months, independent buyers, realized
USD, venue presence, observation span, and any integrity cap. Price history stays in market charts and Dislocation
Radar rather than becoming a second hidden Rating formula.

## Activity Outlook

### User question

Which eligible assets have the strongest relative evidence of remaining active over the next 180 days?

### Production model

Equal percentile weight for historical active-month breadth and last-trade recency, materialized daily over eligible
assets. This two-factor baseline had the most stable whole-ranking performance and beat richer models in the newest
regime. It remains a relative rank, not a calibrated probability.

### Frontend

Show **Activity Outlook**, `/100`, the rank/population, a 180-day horizon, exact last activity, and active months.
Copy says “relative 180-day activity rank.” Classified low-quality assets receive no Outlook row.

## Conviction

### User question

How broad, distributed, and established is the current holder base?

### Production model

A transparent holder-profile score using holder breadth, current distribution, concentration, creator participation,
collector depth, and circulating scarcity. It excludes price, realized value, activity prediction, collection tags,
and graph standing. Classified low-quality assets are ineligible.

### Frontend

Show Conviction as a secondary holder statistic, followed by holder count, largest-holder share, issuer share, and
holder makeup. Do not place it beside price as an expected-return signal.

## Address Reputation

### User question

How substantial and sustained is this address's directly observed Counterparty track record?

### Production model

The public product remains **Reputation**; its numeric component is explicitly labeled **Track Record**. It summarizes
direct historical contributions and economic participation: longevity/span, successful creation, pro-holder actions,
fees and spending, collecting, commerce, and DEX participation. Directly attributable vault, shell, and dump behavior
is shown as negative evidence. Infrastructure receives factual states instead of user ranks.

Last activity and days since active remain separate facts. Evaluation rejected a single universal address predictor:
recency was the stable broad activity predictor, while balanced participation was stronger only for a small review
budget. Neither result justifies calling future behavior “reputation.”

### Frontend

Show persona, Reputation tier, Track Record score, historical evidence, exact last activity, and factual
classifications. The disclaimer states that it is not identity verification, an endorsement, or a guarantee.

## Network Standing

### User question

What selected relationship regions is this entity connected to?

### Production model

Seeded graph proximity and related-entity exploration remain separate. The graph must not change Rating, Reputation,
Conviction, or Radar eligibility/ranking. “Connected,” “flagged,” and “unscored” are relationship states—not trusted,
untrusted, good, or bad identities.

### Frontend

Use a secondary chip or dedicated relationship view with the method and seed provenance available. Never use a shield
or endorsement treatment that implies verification.

## Tags and collections

Tags are controlled categorical facts or curated identities with provenance. They do not alter scores merely because
they exist. Protocol type stays in canonical asset fields rather than redundant tags.

Collections expose a descriptive profile: evidence sources, corroboration, member count, market coverage, typical
member Rating/activity, issuer breadth, holders, realized value, and concentration. There is no universal collection
grade until time-aware membership supports leakage-safe validation. A popular collection is useful context, not proof
that every member is valuable.

## Radar

Radar has two distinct opportunity modes:

1. **New:** Fresh assets (7–29 days) show preliminary facts; Emerging assets (30–89 days) rank by the validated
   equal-percentile market core of independent buyers and active market months; Established begins at 90 days.
2. **Dislocation:** older assets whose executable current opportunity is materially below their own robust historical
   unit-price reference, subject to minimum depth and integrity eligibility.

Neither mode predicts profit. New and dislocated opportunities use different cohorts, clocks, features, and outcome
tests and must not be collapsed into one score.

## Integrity and manipulation

Use direct rules where the semantics are established: self-dealing, invalid protocol events, cracked/empty/dump vault
states, and reviewed exchange-deposit artifacts. Graph cycles, repeated counterparties, common funding, or anomalous
price/volume can populate an internal review queue, but they do not automatically convict an asset or address.

This follows the empirical wash-trading literature's useful distinction between direct on-chain ownership/flow
evidence and indirect anomaly indicators. The latter are candidates for review and evaluation, not silently promoted
facts.

## Change gate

A production change must include:

1. an exact formula and eligible population;
2. immutable temporal cutoffs and outcomes;
3. precision at bounded review sizes, average precision, and NDCG where it is a ranking;
4. era, venue, collection, supply, and age subgroup results;
5. named additions, removals, and known-adversary cases;
6. score/tier population movement and query/refresh cost;
7. a forward-tracked frozen cohort and rollback threshold;
8. matching API, frontend copy, methodology, and operator freshness checks.

