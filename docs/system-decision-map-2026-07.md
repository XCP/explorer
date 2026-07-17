# System decision map

This document is the current orientation for the explorer's derived intelligence. It reconciles the implementation,
migrations, tests, research notes, and the decisions recorded in Git history through 2026-07-16. Older documents are
useful evidence of how a decision evolved, but they do not override this map when they conflict with it.

## Source-of-truth order

1. Canonical normalized ledger relations and externally sourced records with explicit provenance.
2. Applied migrations, which define the production storage contract.
3. Current projection code and contract tests.
4. A dated decision backed by a frozen evaluation or named-case review.
5. Research notes and product inventories, which may describe hypotheses or superseded behavior.

A commit message explains intent; it does not prove that later projections still preserve that intent. A descriptive
document does not become an implementation contract merely because it is newer than the code.

## Data and refresh topology

```text
Counterparty API -> syncCoreEvents -> normalized canonical relations
                                      |-> event-scoped projection dirtiness

External providers -> staged Emblem, price, Bitcoin, collection records
                                      |-> explicit reconciliation queues

canonical relations + reconciled records
  -> trades / trade_legs
  -> asset_signals / address_signals
  -> Rating, Track Record, Conviction
  -> activity_outlook / emergence
  -> Radar
  -> tags / collection profiles
  -> graph projections / Network Standing / holder cohesion
```

`runCanonicalMaintenance` is the single serialized orchestrator after event sync catches up. Serialization prevents
overlapping writes; it does not by itself establish dependency correctness. Every derived table must have a trigger,
queue, or bounded rebuild that is caused by every upstream mutation on which it depends.

## Product contracts

| Product | Question | Included evidence | Excluded or separate evidence | Refresh owner |
| --- | --- | --- | --- | --- |
| Rating | How substantial is demonstrated historical market evidence? | attributable direct sales, independent buyers, active market history; present production formula also contains older correlated proxies | graph standing; collection identity; curated tags; bundle payment duplicated across legs | `asset_signals`, read-time score |
| Activity Outlook | How strong is relative evidence of continued activity? | historical activity features with a frozen validation target | `low_quality`; graph standing | daily materialization |
| Conviction | How broad and established is current holder participation? | holder breadth, distribution, concentration, creator ownership, scarcity | graph standing; direct price/volume | read time |
| Radar | Which eligible assets satisfy a named opportunity screen? | screen-specific market, ownership, emergence, or dislocation evidence | `low_quality`; graph eligibility/ranking | read time plus emergence refresh |
| Address Track Record | How substantial and sustained is observed address behavior? | direct address history and factual behavioral classifications | recency as reputation; seeded graph standing | `address_signals`, read time |
| Network Standing | What relationships surround an entity? | normalized graph and explicitly named seed proximity | claims of quality, trustworthiness, or eligibility | explicit graph build |
| Collection Profile | What describes a collection's breadth, market history, concentration, and classified share? | membership evidence and aggregate factual signals | a composite collection grade until independently justified | read time |
| Tags | Which categorical facts or curated identities apply? | controlled protocol, behavior, media, artist, collection, and manual vocabularies | implicit score contribution | block-gated rebuild |

The public product remains named **Rating**. “Market evidence” describes what Rating is intended to summarize; it is
not a replacement product name.

## Decisions that are settled

- There is one canonical production ledger, not pre-compaction and post-compaction read paths.
- `low_quality` is an explicit reviewed classification. Ranked recommendation products exclude it; Rating preserves
  the historical evidence but hard-caps the displayed tier.
- The graph remains useful for exploration, Network Standing, and holder-cohesion research. Evaluations showed seed
  choices materially affected rankings, so it is not a Rating, Reputation, Conviction, or Radar factor.
- Tags are categories and provenance, not numeric evidence merely because a tag exists.
- Bundle value is conserved. A payment is counted once. Asset legs prove participation but never receive a copy of
  the entire payment or an invented equal/quantity-weighted price.
- A Counterparty dispenser address can legitimately serve multiple assets. Shared address, origin, volume, or price
  alone is not proof of manipulation or an exchange-deposit relationship.
- Known exchange-deposit fake-volume examples remain protected by reviewed asset classification until independent
  Bitcoin-flow attribution can support a general detector.

## Decisions that evolved

### Graph terminology and influence

Older orientation and inventory documents call seeded graph output “trust/distrust” and describe it as part of
reputation. The 2026-07-16 ablations and named reviews supersede that product interpretation: current code exposes it
as Network Standing and removes it from Rating, Address Track Record, Conviction, and Radar ranking. Storage column
names remain implementation history, not permission to describe reachability as trustworthiness.

### Emblem high-supply single-unit dumps

Commit `d9650b6` introduced `emblem_vaults.is_dump` to identify sold single-unit vaults of fungible assets with supply
at least one million. It deliberately penalized the attributed operator's address while leaving the asset side to a
circulating-scarcity factor. That was coherent with the Rating model of 2026-07-08.

The later USD-led Rating work changed the consequence: an Emblem sale classified `real` now contributes realized USD,
buyer breadth, duration, and venue evidence. Migration 0063's “clean” projection inherits `sale_class='real'`, while
the current committed Emblem trade fold does not consult `is_dump`. Therefore known dump-vault activity can become
positive clean asset evidence. The older “scarcity handles the asset side” decision was not explicitly re-evaluated
when this new evidence family was added.

This is an open policy decision, not a schema discovery. Before changing production:

1. compare current and dump-excluded challengers on the frozen population;
2. inspect named legitimate high-supply assets and known dump factories;
3. quantify rank, tier, buyer-count, realized-USD, and active-month changes;
4. decide whether `is_dump` means fraudulent trade exclusion or only operator-risk evidence;
5. record the supersession explicitly if the old decision changes.

### Rating calibration

The current production Rating contains several correlated legacy market proxies and saturates many strong named
assets near 99–100. The clean direct-market challenger improves conceptual coherence, but its top ranks exposed the
dump-vault classification leak. It is not ready to replace the production formula until that leak is resolved and
calibration is tested separately from ranking quality. Percentile ranking can distinguish leaders even when a display
score saturates; those are different evaluation problems.

## Mechanical gaps independent of model policy

1. Trade-derived signal refresh: migration 0063 made `asset_signals` depend on mutable `trades`. Counterparty event
   dirtiness and periodic full sweeps do not guarantee prompt convergence after an external Emblem reconciliation,
   USD price application, trade reclassification, or trade deletion. A bounded asset dirty queue caused by trade
   insert/update/delete is the appropriate dependency mechanism.
2. Emblem classification refresh: the committed vault dirty trigger watches contents, crack state, and shell state,
   but not `is_dump`. If `is_dump` affects the trade contract, that column must enqueue trade reconciliation.
3. Maintenance order: `runCoreAssetSignalsStep` currently runs before Emblem crawl/classification/trade reconciliation
   and before `applyTradeUsd`. Correct queues make that ordering eventually consistent; the operator status surface
   must show queue depth/freshness so a partially converged cycle is visible.
4. One-off audits must use exactly the same eligibility contract as production and fail closed on extra, missing,
   ineligible, or non-contiguous rows.

These gaps can be corrected without selecting a new Rating model. Dump reclassification cannot.

## Document authority

| Document | Status |
| --- | --- |
| `system-decision-map-2026-07.md` | current orientation and conflict resolver |
| `scoring-system-coherence-2026-07.md` | current product boundary; its claim that direct-sale evidence is clean is conditional on resolving dump classification |
| `tags-graph-audit-2026-07.md` | current tags and graph boundary |
| `bundle-market-evidence.md` | current value-conservation contract and Emblem research plan |
| `reputation-recommendations-2026-07.md` | evaluation record; later dated decisions supersede earlier recommendations within the file |
| `reputation-system-audit-2026-07.md` | research baseline and method catalogue, not current production behavior in every section |
| `new-radar-model.md` | frozen new-asset model research contract |
| `orientation.md` | broad codebase orientation; graph/reputation language is partly stale |
| `product-inventory.md` | historical product simplification proposal; not an implementation contract |

## Review gate for the pending working tree

The uncommitted changes combine three concerns and must be split before acceptance:

1. **Keep after tests:** audit parity and fail-closed fixture updates.
2. **Keep after dependency review:** the trade-to-asset-signal dirty queue and queue draining.
3. **Do not accept yet:** changing dump-vault trades from `real` to `scam_dump`. Run the named/frozen comparison and
   document whether it supersedes the 2026-07-08 asset-side decision.

No deployment should combine the mechanical dependency repair with the unresolved Rating policy change.

