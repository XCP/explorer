# USD pricing roadmap

Last updated: 2026-07-19

This is the working checklist for extending XCP.io's historical USD coverage without manufacturing precision in thin,
asynchronous, or manipulated markets. The full evidence and literature review lives in
[`usd-pricing-audit-2026-07-18.md`](./usd-pricing-audit-2026-07-18.md). Update this file when a task or decision gate is
completed so future work resumes here rather than reconstructing the plan from commits.

## Fixed product claim

`usd_value` is historical payment value. It is either a directly USD-denominated payment or an approximate conversion
using an admitted price from the transaction's UTC day. It is not an exact timestamp quote, fair value, reference
price, or market capitalization.

Missing values remain `NULL` when no admitted historical path exists. Current quotes never replace missing historical
prices.

## Fixed data constraints

- [x] Coinbase provides the primary BTC/USD and ETH/USD calendars after their supported start dates.
- [x] CoinMarketCap provides the early BTC aggregate and the broad XCP/USD aggregate history.
- [x] First-party Zaif execution archives and official ECB FX observations are imported with checksums.
- [x] Counterparty burns and completed DEX matches provide attributable on-chain XCP/BTC observations.
- [ ] Poloniex, Bittrex, Bter, and other historical execution archives are unavailable and are not assumed obtainable.

The last item is a constraint, not an active acquisition task. Revisit it only if a licensed archive becomes available
without relying on chart scraping or ticker-only identity matching.

The subsequent official CMC historical-listings acquisition and its exact downstream census are recorded in
[`cmc-counterparty-import-result-2026-07-19.md`](./cmc-counterparty-import-result-2026-07-19.md). It adds source
observations, not automatic selected prices.

The clean, non-selecting collection-currency expansion is evaluated in
[`clean-usd-bridge-expansion-2026-07-19.md`](./clean-usd-bridge-expansion-2026-07-19.md). Its conservative sensitivity
adds 2,556 reachable matches and identifies the material outlier days that a production rule must reject.

The post-promotion remainder and the bounded 785-match lower-confidence PEPECASH sensitivity are documented in
[`remaining-clean-dex-coverage-2026-07-19.md`](./remaining-clean-dex-coverage-2026-07-19.md).

## Aggregate residual rule

We may calculate a descriptive reported-volume residual:

```text
CMC aggregate reported USD volume
  - independently reconstructed Zaif USD volume
  - independently reconstructed Counterparty DEX USD volume
  = unattributed reported volume residual
```

This residual can establish that reported activity existed outside the named venues and can be summarized by day or
era. It likely includes Poloniex, Bittrex, Bter, other venues, source-methodology differences, timing differences,
filtered markets, and potentially unreliable exchange-reported volume.

The residual must:

- preserve negative values rather than clamping them;
- retain CMC methodology/identity separately from execution venues;
- show all component coverage and missingness;
- be called `unattributed reported volume`, never Poloniex or Bittrex volume;
- never be used to recover an unattributed venue price;
- never become an additional selected price observation.

An aggregate price and aggregate volume do not identify the prices, weights, or constituent set of omitted venues.

## Completed foundation

- [x] Repair duplicate DEX identities and converge on public underscore-form IDs.
- [x] Reconcile the canonical ledger to 100% USD coverage for admitted BTC, XCP, ETH, and USDC payments.
- [x] Import early BTC history and full CMC XCP history deterministically.
- [x] Derive genesis XCP from valid protocol burns.
- [x] Preserve Zaif XCP, PEPECASH, SJCX, BITCRYSTALS, ZAIF, and CICC markets as raw observations.
- [x] Import official ECB EUR/USD and EUR/JPY reference observations.
- [x] Add source manifests, checksums, venue identity, volume, executions, and observation windows.
- [x] Add the read-only production USD audit and Zaif/CMC comparison.
- [x] Add daily materialized pricing health and an alert-ready admin health verdict.
- [x] Expose `usd_basis`, source, price day, and observed day on unified trade rows.
- [x] Mark execution-day conversions as approximate in the primary trade UI.

## Workstream A — terminology and reproducible baseline

### A1. Finish terminology review

- [x] Replace remaining `execution-time USD` wording with `execution-day USD` where a daily rate is used.
- [x] Preserve `execution-time` only for future timestamp-matched conversions.
- [x] Verify specialized record tables and receipts label approximate daily conversions consistently.
- [x] Add or retain a regression test proving current quotes never fill historical `usd_value`.

**Gate:** Every displayed or serialized USD field states whether it is direct USD, execution-day historical USD, a
current estimate, a literal last sale, or a future reference estimate.

### A2. Check in a frozen production baseline

- [x] Add an operator command that writes a deterministic baseline report outside D1.
- [x] Record block/event frontier, trade tip, reconciliation cursor, source counts, coverage, derivation method, and
      import-manifest checksums.
- [x] Record XCP CMC/Zaif agreement metrics using natural logarithms.
- [x] Store the generated report under `docs/data/` or another reviewed, versioned location:
      [`usd-pricing-baseline-2026-07-18.json`](./data/usd-pricing-baseline-2026-07-18.json).

**Gate:** Later changes can produce a before/after comparison against an immutable baseline rather than moving
production totals.

## Workstream B — XCP source quality

### B1. Materialize non-selecting disagreement diagnostics

- [x] For each XCP day, retain CMC USD and every available Zaif JPY, Zaif BTC, burn, or Counterparty DEX candidate.
- [x] Record observation window, FX day/age, volume, executions, derivation depth, and historical CMC precision.
- [x] Calculate natural-log disagreement without changing the selected `prices` row.
- [x] Use factual flags: `single_source`, `thin_venue`, `possible_quantization`, `asynchronous_window`, and disagreement
      bands. Do not label a source `bad` from disagreement alone.

The reproducible daily materialization is
[`xcp-price-disagreement-2026-07-18.json`](./data/xcp-price-disagreement-2026-07-18.json); regenerate a new immutable
snapshot with `npm run audit:xcp-price-disagreement -w xcp-api` and `DIAGNOSTIC_OUTPUT` set to a new path.

**Gate:** Every XCP selection can be explained using stored candidates and factual diagnostics.

### B2. Evaluate predeclared cohorts

- [x] Predeclare execution-count buckets: 1, 2–9, and at least 10.
- [x] Predeclare XCP-volume buckets before reviewing results.
- [x] Compare exact-day versus carried FX, old CMC CSV versus precise API, and DEX-active versus inactive days.
- [x] Report median, P90, P99, fixed 10%/25% bands, and named worst dates for every cohort.
- [x] Determine whether large disagreement is predictably associated with thin markets, quantization, or timing.

The checked-in interpretation is
[`xcp-price-cohort-analysis-2026-07-18.md`](./xcp-price-cohort-analysis-2026-07-18.md), backed by the full immutable
[`cohort report`](./data/xcp-price-cohorts-2026-07-18.json).

**Gate:** A checked-in report supports retaining or changing source priority. No selection change is justified by the
overall median alone.

### B3. Calculate unattributed reported volume

The original official CMC CSV was recovered and exactly matched the production manifest checksum. Migration 0073 and
the CMC importers now preserve reported quote volume separately from attributable base execution volume. The CSV was
reimported after the migration; no selected price changed.

- [x] Reconstruct Zaif USD volume from every execution and the same admitted daily conversion path.
- [x] Reconstruct Counterparty DEX USD volume from completed on-chain executions.
- [x] Subtract both from CMC aggregate reported USD volume without clamping negative values.
- [x] Report the residual by day, year, and source-coverage regime.
- [x] Flag days whose components have strong price disagreement or mismatched observation coverage.
- [x] Document that the residual is evidence of unattributed reported activity, not a venue price or verified volume.

The checked-in interpretation is
[`xcp-volume-residual-analysis-2026-07-18.md`](./xcp-volume-residual-analysis-2026-07-18.md), backed by the immutable
[`daily residual`](./data/xcp-volume-residual-2026-07-18.json).

- [x] Reconcile the negative tail with component-removal and whole-day-shift sensitivity tests. The checked-in
      [`reconciliation note`](./xcp-volume-residual-reconciliation-2026-07-18.md) finds that DEX constituent mismatch
      explains most negative dollars and that shifting Zaif by a whole day makes agreement substantially worse.

**Gate:** The report is arithmetically reproducible and cannot be mistaken for reconstructed Poloniex/Bittrex data.

### B4. Version selected-price policy

- [x] Supplement scalar `fidelity` with direct/derived status, age, depth, observation count, venue count, volume, and
      disagreement class.
- [x] Name the first explicit policy version: [`usd-payment-v1`](./usd-price-selection-policy-v1.md).
- [x] Add a compact selection-change log containing old/new selection and reason (migration 0074).
- [x] Add an equal-fidelity overlap test proving forward and reverse replay select the same winner.

**Gate:** A `(day,currency)` selection is reproducible from retained observations plus a named policy version.

## Workstream C — PEPECASH quote support

### C1. Build candidates offline — complete

- [x] Admit only two candidate path classes: `PEPECASH → JPY → USD` and `PEPECASH → BTC → USD`.
- [x] Start with same-day Zaif PEPECASH observations and no PEPECASH price carry.
- [x] Store executions, PEPECASH volume, first/last time, FX/BTC source, age, and complete path provenance.
- [x] Keep ECB weekend/holiday carry as a separately measured candidate capped at four calendar days.
- [x] Do not write candidates into the selected production calendar yet.

The checked-in C1 interpretation is
[`pepecash-usd-candidates-2026-07-18.md`](./pepecash-usd-candidates-2026-07-18.md), backed by the immutable
[`candidate census`](./data/pepecash-usd-candidates-2026-07-18.json). Both predeclared path classes are present.

**Gate:** Both paths are deterministic from checksummed inputs and cannot create cycles or exceed depth two.

### C2. Evaluate path agreement

- [x] Compare JPY and BTC paths on overlapping days using natural-log error and fixed percentage bands.
- [x] Break results down by execution count, volume, FX age, year, and time-window overlap.
- [x] Compare with unambiguous on-chain PEPECASH/XCP or PEPECASH/BTC relationships as corroboration, not ground truth.
- [x] Inspect the worst dates and persistence of disagreement across adjacent days.
- [x] Predeclare admission rules before producing the final census.

The checked-in interpretation is
[`pepecash-path-agreement-2026-07-18.md`](./pepecash-path-agreement-2026-07-18.md), backed by the immutable
[`agreement report`](./data/pepecash-path-agreement-2026-07-18.json).

**Gate:** A checked-in report identifies path classes and factual conditions that are stable enough for payment
conversion. Agreement is corroboration, not proof of fair value.

### C3. Produce the exact admission census

- [x] Correctly orient all completed PEPECASH-quoted matches.
- [x] Count exact-day JPY path, BTC path, both paths, and neither path.
- [x] Count rejections by missing market, stale FX, insufficient activity, severe disagreement, or invalid orientation.
- [x] Report admitted coverage by year and asset plus the USD payment distribution.
- [x] Manually review the largest payments, earliest matches, worst disagreements, and a thin-market sample.

The checked-in interpretation is
[`pepecash-trade-census-2026-07-18.md`](./pepecash-trade-census-2026-07-18.md), backed by the immutable row-level
[`admission census`](./data/pepecash-trade-census-2026-07-18.json).

**Gate:** Every proposed trade has a stored admission or rejection reason. The headline `28,761 reachable matches` is
not itself an admission decision.

### C4. Implement the narrow production path

Before C4, complete the post-2020 source recovery and on-chain estimator evaluation in
[`pepecash-post-2020-source-plan.md`](./pepecash-post-2020-source-plan.md). C3 closes the Zaif census but does not make
its 2020 endpoint the final coverage boundary.

The strict post-2020 dual-market census is complete:
[`pepecash-post2020-census-2026-07-18.md`](./pepecash-post2020-census-2026-07-18.md), backed by the immutable
[`row-level result`](./data/pepecash-post2020-census-2026-07-18.json). It adds 3,397 candidate matches on 73 exact days
through 2023 without price carry.

The [`unsupported-payment sensitivity`](./pepecash-unsupported-sensitivity-2026-07-18.md) shows that 31 payments in
2024 are close but outside the frozen threshold, whereas relaxing the threshold to 15% or 25% adds no 2025-2026
payments. Those recent years require new evidence rather than threshold relaxation.

The [`sparse-lane evaluation`](./pepecash-sparse-lane-evaluation-2026-07-18.md) separately finds same-day,
lower-confidence evidence for 71 payments in 2024, 26 in 2025, and 44 in 2026. These are candidates for an explicitly
estimated-payment projection, not automatic additions to the selected calendar.

The [`asset-history evaluation`](./pepecash-asset-history-evaluation-2026-07-18.md) confirms that most candidates have
same-asset history but that purchase prices are intrinsically highly dispersed. Asset-relative deviation should be a
warning signal, not a conversion-selection rule.

The [`bridge-asset survey`](./usd-bridge-asset-survey-2026-07-18.md) finds BITCRYSTALS is the only additional retained
asset with both defensible dual-path USD evidence and material downstream use: 1,241 matches against 208 other assets
fall on 196 conservatively admitted price days. It requires its own row-level census before production.

The [`CMC snapshot feasibility review`](./cmc-historical-snapshot-feasibility-2026-07-18.md) identifies BitCrystals,
Scotcoin, LTBcoin, GetGems, Swarm, and TileCoin by stable CMC UCID. Website crawling is technically possible but barred
by current CMC terms and top-200 truncation; the checked-in importer uses the authorized historical API instead.

- [x] Proceed only if C2 and C3 pass their gates. Both offline gates pass, and the later post-2020 dual-market census
      adds a second bounded regime without weakening the Zaif rule.
- [ ] Add selected PEPECASH/USD days using only approved path classes.
- [ ] Cap derivation depth at two, reject cycles, and retain the complete selected path.
- [ ] Reconcile only affected trades and expose `usd_basis`, source, price day, and observed day.
- [ ] Add health counts and invariants by path and rejection reason.
- [ ] Publish before/after coverage and a reversible rollback procedure.
- [ ] Do not enable arbitrary Counterparty quote currencies as a side effect.

**Gate:** PEPECASH adds measured, attributable historical payment coverage while unsupported matches remain `NULL`.

## Workstream D — payment versus valuation evidence

### D1. Add composable evidence flags

- [ ] Separate transaction structure, counterparty integrity, quantity shape, conversion quality, and statistical
      outlier reasons.
- [ ] Preserve real payment flow even when unit-price evidence is excluded.
- [ ] Never call a statistical price outlier a scam without ownership/funding evidence.
- [ ] Exclude bundles from per-unit price while retaining their payment total.

**Gate:** One transaction can truthfully count as payment flow while being excluded from reference-price or Rating
evidence, with factual reasons exposed.

### D2. Evaluate robust reference-price methods offline

- [ ] Use historical cutoffs so future sales never influence earlier decisions.
- [ ] Compare prior-window log median/MAD, winsorized contribution, independent buyers, venue breadth, age, and
      dispersion.
- [ ] Include legitimate fractional assets, known abuse shapes, Fairmints, and current dump classifications.
- [ ] Measure rank/tier effects and worst historical-cutoff regression.
- [ ] Treat insufficient history as no reference price rather than automatic acceptance.

**Gate:** No reference-price or Rating change ships without a checked-in outcome and false-positive review.

## Workstream E — methodology and stopping point

- [ ] Publish sources, coverage, precision, staleness, depth, disagreement, and missing-value policy.
- [ ] Publish the distinction between payment flow, attributed volume, market evidence, last sale, and reference price.
- [ ] Surface compact pricing health from the materialized status snapshot.
- [ ] Re-review Rating, Radar, collection totals, and asset headers against the intended aggregate.

We stop expanding routing when the next quote asset lacks attributable, time-matched history or would require a path
deeper than two. We do not add a generic graph merely because it increases coverage. New quote currencies require a
new checked-in evaluation and explicit path class.

## Recommended execution order

1. A1 — finish terminology.
2. A2 — freeze the baseline.
3. B1 and B2 — understand XCP disagreement without changing selection.
4. B3 — describe unattributed reported volume under the residual rule.
5. B4 — version selection only after diagnostics establish the required fields.
6. C1 through C3 — evaluate PEPECASH completely offline.
7. C4 — implement PEPECASH only if the evidence gates pass.
8. D1 and D2 — keep valuation research separate from payment coverage.
9. E — publish the final methodology and enforce the stopping rules.

This order prevents moving production values before the baseline and evaluation exist, and it avoids using a generic
conversion graph to solve a problem that only has evidence for a few explicit paths.
