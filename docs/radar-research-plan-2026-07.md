# Radar research plan: new opportunities and market dislocations

## Decision

Radar should not force two different investment theses into one score.

- **Dislocations** asks whether a historically desirable asset is currently offered below a defensible prior
  market range without unacceptable sell-pressure risk.
- **New** asks whether credible, organic adoption is forming before the asset has enough market history to support
  a price-dislocation claim.

They may share facts and presentation components, but require different cohorts, features, outcomes, and
calibration. The existing Radar is an experimental discovery surface: high holder-network Conviction plus a low
*maximum realized sale*. That is closer to "not yet priced highly" than "formerly priced highly and now cheap."
A historical maximum is also outlier-sensitive. It must not be described as a robust prior market range.

## What the canonical database supports now

The reproducible coverage audit is `npm run audit:radar` from `apps/api`. On 2026-07-16 it measured:

| Evidence | Coverage | Use |
| --- | ---: | --- |
| normalized completed trades | 557,583 across 21,354 assets | price, breadth, persistence, outcomes |
| assets with USD-valued trades | 20,249 | cross-currency historical ranges |
| DEX / dispense / Emblem / Scarce City trades | 225,603 / 179,508 / 150,214 / 2,258 | venue-aware realized history |
| assets with open Counterparty dispensers | 17,979 | executable present asks |
| assets with current Emblem asks | 562 | executable present asks, subject to provider freshness |
| assets with collection evidence | 27,516 | collection membership and provenance |
| assets with corroborated collection evidence | 7,668 | higher-confidence membership |
| current balance snapshots | 4,783 rows across 2,381 assets | only recent historical ownership |

The balance snapshot range was only blocks 955,875–958,303. Therefore current supply, holder count, and
concentration can support a **current descriptive screen**, but cannot be joined to older cutoffs in a predictive
backtest. Historical holder state must first be reconstructed from cutoff-safe ledger events. Current Emblem asks
likewise cannot be projected backward. Counterparty dispenser states can be reconstructed from their on-chain
open, refill, close, and dispense lifecycle.

## Shared factual layer

Both Radars should consume named, independently inspectable facts rather than a universal quality number:

1. **Collection position:** canonical tag, evidence sources, corroboration count, collection market/activity depth.
2. **Holder evidence:** holder activity excluding activity in the evaluated asset, historical participation breadth,
   creator history, and graph standing shown separately from direct behavior.
3. **Distribution:** normalized supply, holder count, top-holder and top-five share, issuer share, non-issuer share.
4. **Market history:** completed sales, distinct buyers and sellers, active months, venue mix, robust unit prices.
5. **Current execution:** cheapest live unit ask, venue, available units, staleness, and seller inventory.
6. **Ongoing use:** recent owner transactions, trades, collecting, and retention rather than a launch-day burst.

Holder quality must exclude evidence created solely by owning or trading the target asset. Otherwise the model says
that an asset is attractive because its holders are attractive because they interacted with that same asset.

## Dislocation model

### Eligibility

- At least three defensible completed sales, two buyers, and two active months before the observation time.
- A current executable ask with known unit quantity and currency conversion.
- Valid asset state and no low-quality/wash exclusion.
- Sufficient price coverage to form a reference; never substitute the maximum trade.

These are starting research thresholds, not production constants. Compare them to 5-sale/3-buyer/3-month variants.

### Candidate features

- **Robust reference:** time-weighted median unit USD price over prior active months. Compare ordinary median,
  volume-capped weighted median, and median of monthly medians.
- **Dislocation:** `current unit ask / robust reference`, accompanied by the dollar values and sample size.
- **Sustained high regime:** number of distinct months and counterparties trading within the reference band.
- **Liquidity confidence:** buyers, sellers, active months, recency, and venue diversity—not raw transaction count.
- **Sell pressure:** non-issuer top share, units currently offered, largest holder's historically observed sale rate,
  and the number of units required to absorb visible bids/typical demand.
- **Issuer exception:** issuer share is reported separately. Long-held issuer inventory may reduce the penalty only
  when issuer age, outflows, and realized selling behavior support it; age alone is not evidence of restraint.

### Outcomes

At 90, 180, and 365 days: any sale, distinct buyers, recovery to 75%/100% of the prior reference, relative return
against comparable assets, maximum adverse realized price, and concentrated-holder sales. Assets with no later
sale are failures for liquidity and censored—not zero-return observations—for price-return calculations.

## New model

### Cohort and clock

Evaluate assets at fixed ages after first valid issuance (for example 7, 30, and 90 days), using only events known at
that age. This prevents an older asset from winning merely because it had more time to accumulate evidence.

### Candidate features

- Issuer's prior record, calculated before this issuance.
- Organic holder growth after removing issuer-controlled transfers, burns, services, and obvious sybil clusters.
- Holder retention and continued owner activity after the initial distribution.
- Early buyer/seller breadth and paid acquisition, separated from direct sends and airdrops.
- Supply, issuer allocation, non-issuer concentration, locked state, metadata/media permanence, and collection
  evidence available at the observation age.
- Burst shape: one-day activity share versus continued activity across weeks.

The new model should not require historical price strength. A thin early price may be evidence, but cannot be given
the same meaning as a sustained established market.

### Outcomes

At 90, 180, and 365 days: holder retention, organic holder growth, later completed sales, buyer/seller breadth,
active months, liquidity formation, and survival beyond the launch burst. Evaluate monetary outcomes separately so
the model does not learn that expensive issuance alone means quality.

## Research sequence and recommendation gate

1. **Build cutoff-safe ownership states.** Reconstruct balances at selected cutoffs and validate totals against the
   canonical current balances. Add issuer/non-issuer concentration and holder activity excluding the target asset.
2. **Reconstruct historical Counterparty offers.** Model dispenser inventory/state at each cutoff. Treat historical
   external listings as unavailable unless a timestamped source exists.
3. **Generate cohorts.** Established-market observations for Dislocations; fixed post-issuance ages for New.
4. **Run transparent baselines and ablations.** Single factors, filters, small additive rankings, current Radar, and
   graph-free variants. Report temporal folds and named false positives—not one aggregate score.
5. **Run a current descriptive screen.** Manually inspect the highest-ranked and most-discounted named assets with
   their issuer and concentration histories before changing production.
6. **Freeze a challenger and forward-track it.** Store daily recommendations and outcomes. Do not tune the same
   period used for the final comparison.

A production recommendation is ready only after steps 1–5. It must state: proposed change; exact formula and
eligibility; evidence across temporal folds; examples helped and harmed; query/storage cost; known blind spots;
priority; rollback; and the forward metric that can falsify it. Expected first recommendations are architectural—
split the surfaces, replace maximum price with robust market evidence, and separate issuer from non-issuer sell
pressure—while weights and thresholds remain contingent on the experiments.

