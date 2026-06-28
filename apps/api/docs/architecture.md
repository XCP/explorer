# Data architecture — xcp.io API

The mental model in one sentence: **boring deterministic capture of Counterparty (Layer 1), features
derived on top and maintained per-block as we ingest (Layer 2), scoring computed at read time (Layer 3).**
A short list of genuinely-global computations can't be done per-block; those run periodically.

---

## The four concerns

### A. Ingest — raw 1:1 Counterparty capture (Layer 1)
The `src/indexer/events/` handlers replay the CP event stream chronologically and write:
- **One mirror table per event/state type** — `issuances, sends, destructions, burns, dividends, sweeps,
  broadcasts, btcpays, cancels, orders, order_matches, dispensers, dispenses, dispenser_refills,
  bets/bet_matches/bet_match_resolutions, rps/rps_matches, fairminters, fairmints, pools/pool_*`, plus
  `blocks, transactions`.
- **Canonical current-state tables** the handlers keep live: `balances`, `assets` (supply/divisible/locked/
  type/stamp/…), and `balance_snapshots` (reorg rollback).

This layer is deterministic and authoritative. **Nothing derived lives here.** The indexer never writes
features; re-indexing from genesis reproduces it exactly.

### B. Cascade — derived features, maintained per block (Layer 2)
Features are a pure function of Layer 1. As each block's events apply, the handlers record the **dirty set**
of entities touched this block (`asset` ids and `address` ids). A maintenance step then recomputes the
feature rows **for only those entities** and re-evaluates their tags.

- **Recompute, don't delta-patch.** Each dirty entity is fully recomputed from raw (scoped re-aggregation,
  `WHERE asset IN (dirty)`), so there is **no incremental drift** — the failure mode of hand-maintained
  counters. Cost is bounded by what changed, not table size.
- This is the same dirty-queue pattern `crawlAssetSupply` already uses for supply, generalized to all
  features + tags. It **replaces** the old batch signals-cursor (`runSignalsStep`), which is retired to a
  full-rebuild / repair tool only.
- **Completeness:** every asset and address gets a feature row the first time it is seen (at issuance / first
  event), so the feature tables are a *complete matrix* — one row per entity, dead ones zero-filled. (Dead =
  real signal, not absence; and the signal-test harness runs over these tables, so an incomplete table would
  silently bias every experiment.)

Feature tables: `asset_signals`, `address_signals`. Categorical projection: `tags`.

### C. Periodic — the genuinely-global exceptions
Cannot be per-block because each depends on the *whole* population. Run on a slow cadence (cron):
- **Percentile anchors** for mapping raw scores → 0–100 (needs the population distribution).
- **PageRank** (`address_signals.rep_score`) — graph-global.
- **`low_quality` propagation** — guilt-by-association across an issuer's whole portfolio.
- **Community averages** — `holder_breadth`, `pct_creator_holders` (average over *other* addresses' features;
  a cascade would fan out across all co-holders, so batch is cheaper).

### D. Score — read time (Layer 3)
`src/reputation/score.ts` + `config.ts`. Turns features → raw score → 0–100 + bands + archetypes, using the
cached anchors from (C). No storage; weight edits take effect on deploy. Tunable surface = `config.ts`.

---

## Tags — the rule that keeps them clean

`tags` is the polymorphic categorical layer (`entity_type, entity_id, tag, source`). Tags come from three places, distinguished by `source`:

- **`source='computed'`** — derived from the **feature tables** (Layer 2) by rules in `tags.ts`: behavioral
  labels like `trader, active_trader, collector, whale, merchant, creator, liquid, broad, durable, wash,
  vaulted, og`, plus the asset-type labels (`named, subasset, numeric`) read from `assets`. The builder
  `DELETE`s all `source='computed'` rows and re-inserts from the rules, so these are self-healing — an entity
  that stops matching a rule loses the tag on the next rebuild.
- **`source='protocol'`** — stamp classification (`stamp, src20, src721, src101, src20_deploy`), written at
  **ingest** by the issuance handler. The classifier base64-decodes the issuance description (can't be
  expressed in SQL), so there's no rebuild rule; these are persisted at ingest and the computed rebuild
  leaves them untouched. SRC-20/721 are meta-protocols layered on Counterparty — we tag that a CP asset is
  *used* for one, but we do **not** index the protocol's own token registry (e.g. the SRC-20 tick).
- **`source='curated'`** — human-owned validation anchors (`grail`, named scams). Sticky; removed by hand.
- **`source='manual'`** — one-off hand-set. Sticky.

So: **intrinsic/protocol facts → written at ingest, behavior → rebuilt from features.** Either way the
enhancement is a tag/overlay, never a column added to the raw Counterparty mirror tables.

---

## Freshness summary

| data | layer | freshness | mechanism |
|---|---|---|---|
| raw mirror, `balances`, `assets` | 1 | per block | event handlers |
| `asset_signals`, `address_signals`, `tags` | 2 | per block (dirty-scoped) | cascade maintenance |
| percentile anchors, `rep_score`, propagation, community avgs | 2 (global) | periodic | cron |
| scores / bands / archetypes | 3 | read time | `score.ts` + config |

---

## Migration path (from today's batch model)

1. **Doc + tag rule** (this file): classification tags from `assets`, behavioral from features. ✅
2. **Feature completeness**: create a feature row per entity at first-seen, so the matrix is complete (fixes
   harness bias + SRC-20 absence at the source).
3. **Dirty-set cascade**: handlers enqueue touched ids; per-block maintenance recomputes features + tags for
   the dirty set. Retire `runSignalsStep` from the hot path → keep only as a repair/full-rebuild tool.
4. **Isolate the periodic globals** (C) onto their own slow cadence.
5. **Resume the testing regime** over the now-complete, always-fresh feature matrix.
