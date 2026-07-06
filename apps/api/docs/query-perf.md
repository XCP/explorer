# Read-path query performance

How the read API stays fast on D1. Three layers, in priority order: **(1) query shape**, **(2) caching**,
**(3) payload size**. All findings below were grounded in D1's own metrics, not guessed —
`wrangler d1 insights xcpio --sort-by reads --sort-type avg` (rows-read is the cost/latency proxy in D1) and
`EXPLAIN QUERY PLAN` over live data.

## Layer 1 — query shape (fewest rows scanned)

### Firsts (`/v2/firsts`) — was the #1 offender, FIXED in code
Each "first" is `the earliest row of a kind`. The natural `ORDER BY block_index, <tx_index|event_index> LIMIT 1`
**cannot** use a single-column `block_index` index for the secondary sort key, so SQLite full-scanned the whole
table into a TEMP B-TREE — `sends` read **1.75M rows to return 1**, ~30 such queries per page load.

Fix (`src/read/firsts.ts`, `earliest()` helper): narrow to `MIN(block_index)` first (that DOES use the
`block_index` index — and for filtered firsts it stops at the first matching block), then order only the handful
of rows inside that one earliest block. EXPLAIN went `SCAN + TEMP B-TREE` → `SEARCH ... USING INDEX
(block_index=?)`; verified to return the identical row for every key. No new index required.

### Counts (`/v2/`, `/v2/stats`) — O(n), handled by Layer 2
`COUNT(*)` over `transactions` (2.9M) / `sends` (1.75M) is a covering-index scan — the best SQLite can do for an
exact count (no stored row count). Can't be indexed away; the D1 response cache (Layer 2) runs it ≤once/ttl.
Future option if needed: a maintained counter row refreshed by the cron's periodic full-rebuild pass.

### Index inventory note
Mirror tables are already well-indexed (`block_index`, `source`/`destination`/`asset` + `block_index DESC`),
and `balances` even has an **expression index** `idx_bal_asset_qty ON balances(asset, CAST(quantity AS INTEGER)
DESC)` that serves the richest-holder sorts. The DESC list feeds (`/v2/sends?…`) seek via the block index and
short-circuit on LIMIT — fine for shallow pages.

### Pending index — see `migrations/0020_read_perf_indexes.sql` (apply AFTER reindex)
- `assets(type, first_issuance_block_index)` — the only remaining firsts scan (subasset/numeric, filtered by
  `type` over 252k assets). Do not build during the reindex (write contention).

### Post-reindex checklist
1. Apply `0020`: `wrangler d1 migrations apply xcpio --remote`.
2. `ANALYZE;` (the planner's table-size stats are stale after a full rebuild — this fixes driving-table choices,
   e.g. the Emblem-vault overview should drive from the 59k `emblem_vaults` set and seek `balances(holder)`,
   not scan all balances). The cron already runs ANALYZE periodically; a manual one right after is good hygiene.
3. Re-run `wrangler d1 insights xcpio --sort-by reads --sort-type avg` and spot-check the vault/cohort queries
   with `EXPLAIN QUERY PLAN`; add covering indexes only where a real endpoint still SCANs a large table.

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
