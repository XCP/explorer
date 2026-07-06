# Data architecture — xcp.io API

The mental model in one sentence: **boring deterministic capture of Counterparty (Layer 1), features
derived on top and maintained per-block as we ingest (Layer 2), scoring computed at read time (Layer 3).**
A short list of genuinely-global computations can't be done per-block; those run periodically.

## System picture

Three indexers stand side by side, feeding one database:

1. **Counterparty replayer** (`indexer/sync.ts` + `events/`) — the pure 1:1 mirror. Nothing derived
   ever lands in its tables; re-indexing from genesis reproduces them exactly.
2. **Emblem Vault crawler** (`indexer/emblem.ts`) — vaults enumerated via Alchemy/Etherscan, resolved
   to their BTC addresses. Lives *next to* the mirror, never in it.
3. **Emblem sales crawler** (`indexer/emblem-sales.ts`) — vault sale history, same sidecar rule.

Derived layers build on top and are always rebuildable from the sources: `asset_signals` /
`address_signals` / `tags` today, and the planned **unified `trades` projection** (order_matches +
dispenses + Emblem sales in one queryable surface). The web app consumes all of it through the read
API's layered caching.

## Pattern language (name things so code knows where to go)

- **Write side**: event-sourced projections (CQRS read models) maintained by idempotent replay;
  derived features via dirty-set **recompute-over-delta** (never delta-patching) with a self-healing
  full-rebuild backstop.
- **Scoring**: a pure **policy module** (`reputation/score.ts`) over a single config surface
  (`reputation/config.ts`); no storage, tunable per deploy.
- **Read side (target)**: **query modules returning DTOs** — named, typed query functions per domain
  (`src/queries/`), route handlers reduced to parse → query → envelope. SQL is private to the query
  module that owns it; it is never shared by exporting string fragments.
- **Contract (target)**: wire types defined once in `packages/shared` and consumed by both apps.
- There is deliberately **no rich domain model**: the chain enforced every invariant before we saw
  the data, so entities carry no behavior — the model *is* the schema plus the DTOs.

See `docs/refactor-proposal.md` (repo root) for the migration plan toward the target patterns.

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
  vaulted, og`, plus the asset-type labels (`named, subasset, numeric`) read from `assets`. Rebuilt with the
  same dirty-set discipline as the feature tables (mirrors `signals.ts`' full/scoped pair):
  - **Per block, dirty-scoped** (`buildTagsScoped`, right after the cascade, over the SAME touched entity
    sets): for each dirty entity, `DELETE` its behavioral computed tags then re-run every rule scoped to it —
    so an entity that stops matching a rule loses the tag that tick. Bounded by what changed, not table size
    (the old every-tick global `DELETE FROM tags WHERE source='computed'` re-wrote ~430k rows per tick).
  - **Intrinsic asset-type tags** (`named/subasset/numeric`) are **append-only** — an asset's type never
    changes once issued, so the scoped path never `DELETE`s them; it `INSERT OR IGNORE`s them for the dirty
    (incl. freshly-issued) assets.
  - **Daily full self-heal** (`buildTags`, block-delta gated ~144): drops and re-derives all computed tags,
    reconciling anything the dirty set couldn't have caught — chiefly the emblem-driven tags (`vault`,
    `vault_funder`, `vault_cracker`, `vaulted`) when a *newly-crawled* vault retroactively re-labels an entity
    whose own rows didn't change this tick. So a cascade gap is at worst briefly stale, never corrupt.
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
| `asset_signals`, `address_signals` (dirty entities) | 2 | per block (dirty-scoped) | cascade maintenance |
| `tags` — computed (dirty entities) | 2 | per block (dirty-scoped) | `buildTagsScoped` after the cascade |
| `tags` — computed (full self-heal) | 2 | daily (block-delta gate) | `buildTags` |
| heavy full-population scans (any unit whose `.full` aggregates a >1M-row mirror table: sends/balances/transactions) | 2 (global) | daily (block-delta gate) | `runSignalsStep` (per-unit `heavyEveryBlocks`); cascade `.scoped` keeps dirty entities fresh every tick |
| percentile anchors, `rep_score`, propagation, other periodic globals | 2 (global) | periodic | cron |
| scores / bands / archetypes | 3 | read time | `score.ts` + config |

---

## Migration path (from today's batch model)

1. **Doc + tag rule** (this file): classification tags from `assets`, behavioral from features. ✅
2. **Feature completeness**: create a feature row per entity at first-seen, so the matrix is complete (fixes
   harness bias + SRC-20 absence at the source). ✅
3. **Dirty-set cascade** ✅ (`signals.ts`): the analytic SQL is organized into documented **FEATURE UNITS**,
   each declaring `scope` / `reads` / `dependsOn` / `periodic` + a `full` and a dirty-`scoped` SQL. Two drivers
   over the same units: `runSignalsCascade` derives the entities touched per block range straight from the
   mirror tables (a block cursor — no per-handler annotation to miss) and recomputes only those via `.scoped`;
   `runSignalsStep` remains the canonical full rebuild / repair tool and keeps cycling on cron as a self-healing
   backstop (so a cascade gap is at worst briefly stale, never corrupt). `/admin/verify-signals` diffs the two
   for an entity as the safety gate.
4. **Isolate the periodic globals** (C) ✅: units that are whole-population or fan-out (community averages,
   `low_quality` propagation, the trailing-window `recent_events`, tip-relative ages/recency, infra flags,
   `rep_score`, percentile anchors) are marked `periodic` and run ONLY in `runSignalsStep`/cron — never the
   per-block cascade, because their inputs change for entities the block didn't touch.
5. **Resume the testing regime** over the now-complete, always-fresh feature matrix. ✅ (signal-test harness)
