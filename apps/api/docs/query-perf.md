# Read-path query performance

How the read API stays fast on D1. Three layers, in priority order: **(1) query shape**, **(2) caching**,
**(3) payload size**. All findings below were grounded in D1's own metrics, not guessed —
`wrangler d1 insights xcpio --sort-by reads --sort-type avg` (rows-read is the cost/latency proxy in D1) and
`EXPLAIN QUERY PLAN` over live data.

## 2026-08-22 follow-up

One-hour production Insights separated the finite repair backlog from public read costs:

- Full asset-signal repair read 352,687 rows and wrote 7,944 rows. This is bounded catch-up work, not the main
  account cost.
- Scoped tag aggregation read 3,942,332 rows across 124 runs. The common first-page shapes now use the global D1
  response cache for six hours. Only limits 50, 100, and 1,000 at offset zero are persisted, keeping the keyspace
  bounded to three entries per known tag.
- Asset detail holder aggregation read 1,117,845 rows across 1,065 runs. Detail reads now consume the convergent
  `asset_signals` projection instead of re-scanning balances. Canonical event maintenance and the holder-only repair
  queue remain the owners of those fields.
- Rating refresh no longer waits for `asset_holder_signal_dirty`. Rating uses trade evidence and integrity fields
  owned by `asset_signal_dirty`; holder-community repairs cannot change the rating result.

## 2026-07-12 production findings

## 2026-07-16 follow-up

Seven-day Insights still contained signatures from code that had already been replaced, so candidates were
cross-checked against the current source before editing. This prevented adding indexes for the retired
cross-table asset identity `OR` and retired dynamic subasset `LIKE` query.

The current `/v2/radar` availability query averaged 73,999,859 rows read and 3,691ms over 18 cache refreshes.
Its eligibility predicate resolved the canonical numeric-asset classification through generic entity/tag rows.
`assets.type` reported 124,050 numeric assets while the derived tag projection reported 124,045; the five
differences were all canonical numeric assets missing the tag. Commit `f1f8475` now performs a primary-key
existence check against canonical `assets.type`. A forced production cache miss after deployment completed the
whole Radar producer in 621ms, down 83% from the Insights duration, with the same response size.

Research/evaluation SQL was separated mentally from serving and maintenance costs when ranking Insights. The
historical rating experiments are deliberately expensive operator queries and must not motivate serving indexes.

Seven-day D1 Insights showed the old `/v2/` heartbeat query ran **3,840 times**, averaging
**5,233,723 rows read** per run: about **20.1 billion rows**. The UI only consumed `tip` and
`indexed_block`. `/v2/status` now serves those two indexed scalar reads; `/v2/` keeps its
compatibility payload behind a one-hour D1 cache plus day-long stale-while-revalidate.

`assetFeedCounts()` was the next largest user-facing read: **10,601 runs**, averaging **264,346 rows
read** (about **2.8 billion rows** total). These exact counts power earned tabs and historical
navigation, so they must not simply be removed. The intended fix is a rebuildable
`asset_feed_counts` read model maintained by the existing full-rebuild + dirty-set cascade, with
parity tests against the current aggregation before cutover.

Implemented in migrations 0042-0043: the ten event-table counts plus the formerly full-scanning
subasset-prefix count now come from `asset_feed_counts`. Global parity checks returned zero mismatches.
The only live field left in that projection is `from_issuer`, served by the existing issuer/owner indexes.

Address summary likewise reads `assets_held`, `first_block`, `last_block`, and dispenser trust from the
cascade-maintained `address_signals` row. It retains exact indexed point counts for issued assets, dispensers,
open dispensers, and open orders. This removes the live balance count and bidirectional sends MIN/MAX scans.

Random-access pagination is a product requirement: investigators need to jump directly to the oldest
records or an arbitrary page. Offset pagination remains the public contract. Cursors may be added as an
optional fast path for sequential next/previous browsing, but must not replace page/offset navigation.

`cached()` responses expose `x-d1-cache: HIT|STALE|MISS`; producer misses also expose
`Server-Timing: producer;dur=...` for browser and synthetic diagnostics.

Measured heavy global aggregations (`metrics`, `trades:stats`, `exchanges`, `vaults`, network stats,
leaderboards, and tags) use a day-long stale window. Their normal TTL still controls refresh frequency;
the longer stale window only ensures that a user never waits on a multi-second cold producer after a quiet
period. Refresh runs in `waitUntil` behind the last known-good response.

The all-tags aggregate refreshes daily, matching its source tables' full self-heal cadence (it previously
recomputed an unchanged 8.5M-row/14s population hourly). The price job materializes daily XCP/BTC
volume-weighted medians;
the price calendar now scans order matches once and performs indexed day seeks instead of re-running a CTE
for every BTC day (~8.3M rows per refresh before the change).

Migration 0047 adds a partial burn-address index and the `assets_burned` rebuild fixes its join order to
start from the tiny curated burn set. The former plan drove from all sends and took 39s in D1 Insights.

Maintenance telemetry never recounts the full trades ledger after a bounded batch. Emblem trade folding is
rowid-cursor incremental for new sales with one daily full reconciliation for later vault reclassification;
the former two-minute full upsert produced ~158.7M writes and ~31 minutes of D1 work per day.

Scarce.city's immutable staging rows are also folded by rowid cursor. Asset-supply global derivations (XCP,
fairminter totals, pool values) are tip-gated instead of repeating on every two-minute cron tick; the dirty
asset queue continues draining independently even when the tip is unchanged.

Slow-moving first/last-seen repair passes and global infrastructure classification are generation-gated daily.
They previously ran 24-39 times/day; `addr_grant_seen` alone consumed ~224s/day, while the deposit classifier
rewrote ~11.2M rows/day despite infrastructure membership being stable.

Bounded Emblem/Scarce crawler responses report the batch and cursor state without recounting their complete
staging tables. Completion and retry logic never depended on those telemetry-only totals.

The daily burn-adjust self-heal starts from indexed burn addresses, materializes the 1,337 affected assets,
then seeks balances only for those assets. Production old/new parity was exact; the isolated new aggregation
read ~1.06M rows in 6.3s versus the former all-balances plan's ~3.04M rows / 23.6s.

Daily metric series cache for six hours (rather than 30 minutes), and lifetime trade-venue aggregates cache
hourly (rather than two minutes). Their live feeds remain independently fresh; only full-history regrouping is gated.

Address send-derived repairs use one source grouping and one destination grouping. `last_block` is folded into
the source pass and `assets_received` into the destination pass, removing two full sends scans per daily cycle.

Reputation tiers use the persistent global SWR cache instead of recomputing the ~867k-row histogram per colo.
Exchange globals refresh daily, vault globals hourly; expensive holder-cohort relationships use a one-hour edge TTL.

The exchange directory refreshes daily. Its plan already starts from the 23-wallet partial index; the remaining
work is an irreducible distinct aggregation over ~373k deposits. A covering sends index was rejected because the
database is 7.66GB against D1's 10GB ceiling and the persistent SWR cache removes the user-facing cold wait.

## Layer 1 — query shape (fewest rows scanned)

### Firsts (`/v2/firsts`) — was the #1 offender, FIXED in code
Each "first" is `the earliest row of a kind`. The natural `ORDER BY block_index, <tx_index|event_index> LIMIT 1`
**cannot** use a single-column `block_index` index for the secondary sort key, so SQLite full-scanned the whole
table into a TEMP B-TREE — `sends` read **1.75M rows to return 1**, ~30 such queries per page load.

Fix (`src/read/firsts.ts`, `earliest()` helper): narrow to `MIN(block_index)` first (that DOES use the
`block_index` index — and for filtered firsts it stops at the first matching block), then order only the handful
of rows inside that one earliest block. EXPLAIN went `SCAN + TEMP B-TREE` → `SEARCH ... USING INDEX
(block_index=?)`; verified to return the identical row for every key. No new index required.

### Counts (`/v2/`, `/v2/stats`) — materialized
Migration 0044 adds `network_stats_snapshot`, a singleton read model rebuilt by the periodic signal pass.
Exact counts, BTC fees, and XCP destroyed now cost one row read instead of scans across the mirror tables.
Production parity was zero for every field; the old aggregate read 14.5M rows in 7.8s, while the snapshot
lookup read one row in 0.23ms. The live tip and indexer cursor remain independently current.

Migration 0045 extends the singleton with exact raw-unit XCP supply. Native XCP detail no longer folds burns,
destructions, and protocol fees on every cold asset request; production parity against the former expression is exact.

### Index inventory note
Mirror tables are already well-indexed (`block_index`, `source`/`destination`/`asset` + `block_index DESC`),
and `balances` even has an **expression index** `idx_bal_asset_qty ON balances(asset, CAST(quantity AS INTEGER)
DESC)` that serves the richest-holder sorts. The DESC list feeds (`/v2/sends?…`) seek via the block index and
short-circuit on LIMIT — fine for shallow pages.

### Current operating checklist

Schema and read indexes are owned by `migrations-core/` and applied only to `xcpio-core`. The scheduled
`maybeAnalyze` job refreshes optimizer statistics after meaningful chain growth. Use
`wrangler d1 insights xcpio-core` to identify measured hot queries, then confirm their plans with
`EXPLAIN QUERY PLAN`; add an index only when the production workload demonstrates that it is needed.

## Layer 2 — caching

Two tiers:
- **Edge** (`cache-control: max-age`, via `J()` / the `edge` option) — per-colo browser/CDN cache.
- **D1 response cache** (`cached()` in `src/read/respond.ts`, backed by the `cache` table) — PERSISTS across
  colos and cold edge, with **stale-while-revalidate**: a stale hit is served immediately while a fresh value is
  recomputed in the background via `waitUntil`, so no user ever blocks on the heavy aggregation. A given heavy
  query runs at most once per `ttl` globally.

Wired on the low-cardinality, global (non per-entity) endpoints: `/v2/` (home), `/v2/stats`, `/v2/metrics`,
`/v2/leaderboards`, `/v2/vaults`, `/v2/exchanges`, `/v2/firsts`. Per-entity endpoints (asset/address pages) keep
edge caching only — their key space is too large for the response cache.

## Layer 3 — payload size (only ship what the client renders)

Audited the web consumer (`apps/web`) for field usage. Trims applied:
- `description` dropped from `/v2/assets/:asset/issuances` and `/v2/addresses/:addr/issuances` (not shown in
  those tabs); **truncated to 140 chars** in the `/v2/assets` list (the list clamps it to one line anyway; full
  text stays on the single-asset detail endpoint). `mime_type` dropped from the `/v2/assets` list.
- `memo` dropped from the `/v2/sends` list feed (only the `/v2/sweeps` page renders memos).
- `time` dropped from `/v2/firsts` rows (client renders the `date` string only).

Already lean (no action): the mirror tables don't store raw `data`/`unpacked_data`/`params` blobs, and list
feeds select `*_normalized` columns without the integer twins.

## D1 platform audit (2026-07-07, vs official docs + community reports)

- **Sessions API adopted** (`index.ts` /v2 middleware, `first-unconstrained`): read replication is GA;
  once enabled on the database (Dashboard toggle — no wrangler/API path with OAuth) every read is
  served from the nearest of 6 replica regions instead of the single ENAM primary. Our read surface
  is uniformly stale-tolerant (everything edge-cached 10-600s), so no bookmark plumbing is needed.
- **Smart Placement: considered and REJECTED** — docs state it doesn't help replicated resources;
  pinning the worker near the primary would defeat replica-local reads. Re-evaluate only if
  replication is ever turned off.
- **Multiple-round-trip anti-pattern**: asset detail ran 5 independent reads sequentially — now
  concurrent (Promise.all). Full db.batch() (1 round trip) noted as the deeper cut if profiling
  ever demands it.
- **EXPLAIN discipline addition**: also watch for `USE TEMP B-TREE` (sort lacking an index), not
  just SCAN. If full-text asset search is ever built, use FTS5, never `LIKE '%q%'` (current prefix
  `LIKE 'Q%'` is index-friendly and fine).
- Community-reported D1 latencies (200-500ms cross-region) are the no-replication, multi-round-trip
  shape; with edge cache + D1 response cache + sessions + concurrency we sidestep all four causes.
