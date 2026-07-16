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
| immutable ownership ledger | 7,159,272 events from blocks 278,319–958,303 | cutoff-safe ownership reconstruction |
| UTXO-holder ledger events | 92,481 | preserve polymorphic Counterparty holder semantics |

The balance snapshot range was only blocks 955,875–958,303. Therefore current supply, holder count, and
concentration can support a **current descriptive screen**, but cannot be joined to older cutoffs in a predictive
backtest. Historical holder state must first be reconstructed from cutoff-safe ledger events. Current Emblem asks
likewise cannot be projected backward. Counterparty dispenser states can be reconstructed from their on-chain
open, refill, close, and dispense lifecycle.

The ownership ledger stores both ordinary addresses and UTXO holders in `address_dictionary`; UTXO identities use
the canonical `txid:vout` form and may separately retain their controlling address. A validation query found no
holder/asset pair with a negative lifetime net quantity. Historical replay must nevertheless use signed 64-bit
integer quantities in event order. Server-side `REAL` aggregation would lose satoshi-level precision, while a
comparison that joins only `balances.address_id` silently drops UTXO balances. The safe implementation is a
resumable, event-indexed export replayed into a local exact-integer balance state, emitting derived concentration
features at frozen cutoffs rather than copying millions of balance rows back into production.

The completed replay reproduced 1,834,390 of 1,834,391 canonical holder/asset rows exactly, with no missing or
replay-only identities. The single mismatch is native XCP for `15AaPbjutocUSnwECuVpF29sSF9DpvMbZd`: historical
ledger deltas net to 453.21225889 XCP while canonical state is 153 XCP. All issued-asset rows—the population Radar
evaluates—match exactly. Treat canonical balances as operational truth and retain this native escrow/accounting
exception as an audit finding; do not “correct” production from the analytical replay.

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

1. **Build cutoff-safe ownership states.** Export immutable ledger events in bounded `event_index` chunks, replay
   exact signed integers in order, and emit features at selected cutoffs. Preserve address and `txid:vout` holder
   identities; attribute UTXOs to controlling addresses only in a separately named view. Validate the final replay
   against both branches of canonical `balances`, then add issuer/non-issuer concentration and holder activity
   excluding the target asset.
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

## Initial concentration ablation

The first cutoff-safe comparison is reproducible with `npm run evaluate:radar-concentration`. It evaluates assets
with at least three prior sales, two prior buyers, and two prior active months against sales and persistent activity
in the following 180 days. Cohort sizes are 7,623–7,844 across the three cutoffs.

- The prior **market persistence core** (sale recency plus active-month breadth) remains strongest. Its top-decile
  return lift is 4.18–4.64x and persistence lift is 6.23–6.92x; precision at 100 is 90–98%.
- Lower top-one concentration has a consistent but modest standalone association with future activity: top-one
  safety produces 1.22–1.47x return lift and 1.27–1.64x persistence lift.
- Giving concentration equal weight with the market core materially degrades every temporal fold. Even a 10%
  top-one modifier slightly reduces precision and whole-ranking average precision in all three folds.
- A `top1 < 50%` safety gate retains about 53% of the established-market cohort and preserves most, but not all,
  of the market core's precision. It is therefore a plausible user-controlled risk constraint, not a demonstrated
  demand-ranking factor.
- Supply at or below 300 is common (about 77.5% of this cohort) and strongly predicts *less* future trading by
  itself. This reflects the many dormant one-of-one and tiny editions. Scarcity may remain an investor preference
  or payoff-shape constraint, but must not be presented as evidence of future demand.
- Creator share in either direction is not a useful standalone predictor. The proposed creator exception requires
  behavioral evidence—holding duration, outflows, and realized selling—not merely a balance percentage.

Decision: keep concentration and normalized supply as explicit facts and potential filters. Do not add either to
the main activity ranking based on this experiment. Next evaluate concentrated-holder and creator selling outcomes,
then build the dislocation price reference; those outcomes test downside risk rather than incorrectly asking a
risk feature to predict demand.

### Dominant-holder outcome

The exact ledger was replayed a second time to track the cutoff's dominant, creator, owner, and largest non-creator
holder to the 180-day horizon. `npm run evaluate:radar-holder-outcomes` evaluates inventory reduction and separately
reports directly observed sales. Inventory reduction is potential sell pressure, not proof of sale; direct sales
undercount origin-funded dispensers because the normalized trade seller may be the dispenser source.

- A dominant holder reduced inventory at all in only 3.5–9.7% of established-market assets, depending on band and
  cutoff; the median reduction is zero in every band.
- Dominant holders owning at least 50% reduced inventory by at least 10% in 1.5–3.7% of assets. This is not higher
  than the less-concentrated bands and therefore does not show that concentrated holders are more likely to act.
- Creator-dominant assets had lower material-reduction rates than non-creator-dominant assets in the first two
  folds (3.47% vs 3.94%; 1.87% vs 2.72%), but the ordering reverses in the newest fold (1.95% vs 0.78%). Creator
  identity alone is not a stable exception policy.
- Directly observed dominant-holder sales occur in only about 0.4–0.9% of the cohort and are a lower bound because
  of dispenser attribution.

Decision: concentration is an **exposure/severity** fact—how much supply one actor could move—not a demonstrated
probability that the actor will sell. Display it and permit risk filtering, but do not claim “likely dump.” A creator
exception should require prior behavior (holding duration, historical net outflows, and observed selling) and remain
an explanation or penalty adjustment until it survives temporal validation.

## Initial price-dislocation evaluation

`npm run evaluate:radar-dislocations` builds a robust reference from the median of monthly median unit-USD prices
between 730 and 90 days before each cutoff. “Current” is the median completed-sale unit price in the final 90 days;
the outcome is the following 180-day median. Eligibility requires at least three reference sales across at least two
months. Emblem sales are excluded because the source identifies a whole vault sale but does not expose the quantity
of the Counterparty asset inside it. Treating every vault as one asset unit produced an invalid initial result and is
not an acceptable normalization.

- After restricting prices to DEX fills and dispenses, the cohorts contain only 36–81 assets per fold. Ranking by
  deeper dislocation has positive-return lift of 1.29x, 1.96x, and 0x. The newest fold has only one positive-return
  outcome in the entire cohort, so it cannot support a stable production ranking.
- Deep discounts still do not generally recover all the way to the old reference within 180 days. “Positive return”
  and “full recovery” are different claims and must remain separate.
- The deepest bands contain only 1–9 assets. Their occasional strong subsequent multiples are useful hypotheses, not
  threshold evidence.
- Reference depth and holder breadth often improve recovery/liquidity, but their interaction with return varies by
  regime. A small depth contribution is a challenger; no fixed weight is justified yet.
- Two or more current sales and four or more reference months consistently improve future-sale coverage relative to
  a one-sale observation. Confidence should be shown explicitly rather than hiding sparse evidence in a score.

Decision: keep **Dislocations** as a research/audit surface, not a validated ranking product yet. Show discount,
market-depth confidence, and distribution risk separately, and say “below its established range,” never “will return
to its old price.” Current candidates use canonical dispenser asks only. Emblem asks require inventory-aware vault
normalization before they can be compared to per-token history. The next evidence milestone is a frozen forward
tracker of executable asks plus named-candidate review.

`npm run audit:current-dislocations` now joins the robust on-chain reference to current canonical dispenser asks.
`npm run snapshot:current-dislocations` freezes an append-only cohort in the local analytical database and rejects a
duplicate observation timestamp atomically. The first prospective cohort contains 133 discounted candidates measured
on 2026-07-16. Re-observe it after 30, 90, and 180 days to measure offer removal, completed-sale coverage, subsequent
unit return, and movement toward the prior reference. Do not tune thresholds against those outcomes before the final
checkpoint; doing so would turn the holdout into training data.
