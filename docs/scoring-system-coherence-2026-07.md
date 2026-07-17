# Scoring system coherence audit

## End-state contract

The canonical ledger and its projections remain the only production source of truth. Product outputs are views over
that data, not competing models of the ledger. Each output answers one question:

| Output | Question | Primary source | Integrity treatment | Refresh |
| --- | --- | --- | --- | --- |
| Rating | How substantial is the asset's demonstrated historical market evidence? | `asset_signals` | retain evidence; cap `low_quality` tier | read time |
| Activity Outlook | How strong is relative evidence of continued activity? | `asset_signals` -> `asset_activity_outlook` | exclude `low_quality` | daily |
| Conviction | How broad and established is current holder participation? | `asset_signals` | exclude `low_quality` | read time |
| Radar | Which eligible assets satisfy a named opportunity screen? | signals, offers, emergence snapshot | exclude `low_quality` | read time / emergence refresh |
| Address Track Record | How substantial and sustained is observed address history? | `address_signals` | factual address classifications stay separate | read time |
| Network Standing | What relationships surround an entity? | graph projections | separate from Rating, Reputation, and Conviction | explicit graph build |
| Collection Profile | What evidence, breadth, activity, and concentration describe a collection? | memberships + signals | expose low-quality share; no composite grade | read time |
| Tags | What factual or curated categories apply? | `tags` | classification, never an implicit score | block-gated rebuild |

## Findings

1. Canonical ingestion is cohesive: one chronological event replay updates normalized tables and enqueues bounded
   projections. There are not multiple production ledgers.
2. Derived product policy was duplicated in SQL. Radar and emergence excluded `low_quality`; Rating applied a hard
   cap; Activity Outlook originally omitted the exclusion. That allowed 40 classified assets into Outlook.
3. The market-evidence ledger is coherent for attributable direct sales. Migration 0063 materializes clean realized
   USD, independent paid buyers, active months, and venue count under one tested eligibility rule.
4. Bundle payments are intentionally stored once. Dispenser legs exist. Emblem multi-asset constituents can be
   reconstructed from vault ownership, but their sale-time composition has not yet been proven temporally stable.
   Do not materialize Emblem legs until that historical invariant is established.
5. Graph data is useful for exploration and cohesion, but seed selection materially influenced former rankings.
   It is correctly isolated from Rating, Track Record, Conviction, and Radar ranking.
6. Refresh orchestration is centralized in canonical maintenance, but its jobs have different gates and state keys.
   Operational status should expose the freshness and eligibility invariants of every public derived product.

## Changes from this audit

- `assetRankingEligibleSql()` is the single integrity predicate for products that rank or recommend assets.
- Activity Outlook, established/available Radar, and new-asset Radar use that predicate.
- Rating deliberately remains an exception: it preserves historical evidence and visibly caps classified assets.
- Production Outlook was reconciled after deployment: 21,314 contiguous ranks, one population value, and zero
  `low_quality` rows. `OXBT`, `ORDIPEPE`, and `OGPASS` have no Outlook row.

## Ordered remaining work

1. Add an automated cross-product integrity audit to canonical maintenance/status. It must fail visibly if a
   low-quality asset appears in any recommendation population or ranks/population cease to be contiguous.
2. Replace Rating's peak-sale proxy only after the already successful clean-market-depth challenger passes named
   asset review. The accepted candidate is clean total realized USD + independent buyers + active months; the
   public product remains named Rating.
3. Audit address classification coverage for exchange deposit addresses. Manual low-quality classification protects
   known fake-volume assets today, but the causal address pattern is not presently detected for their sellers.
4. Research Emblem vault contents at sale time. If historical composition is deterministic, add bundle participation
   legs without allocating the entire payment to every asset. Otherwise retain bundle evidence only at trade level.
5. Expose refresh state and invariant failures in one operator status surface, then remove one-off operational scripts
   when their finite backfills finish.

No new score, table, compatibility layer, or graph influence should be added until it fits this contract and improves
a frozen outcome or a clearly factual product requirement.
