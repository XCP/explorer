# Remaining work — 2026-08-21 session handoff

State when this was written: indexer synced (tip 963448, lag 0), worker deployed at main
(`079a3fa`), migrations 0086–0088 applied to production, all 378 API tests passing, working
tree clean. What follows is what was deliberately NOT done, in priority order.

## 1. xcpdex database — uncached aggregate endpoints (other repo)

D1 insights on the `xcpdex` database show five stats/landing queries that appeared in the
1-day top readers this week and were absent from the 7-day top — 18–42M rows/day each, some
at 1.3M rows per run (e.g. the XCP volume rollup at 41.8M rows/day over 52 runs). Same shape
as the collection-profile gap fixed here: heavy aggregates recomputed on every cache miss.
The fix lives in the exchange/xcpdex codebase, not this repo. Its `pool_matches` schema and
execution-context pairing were checked this session and are safe for multi-fill txs.

## 2. Replay failure breadcrumb

When a replay batch fails, nothing records WHICH event killed it — this session's 20-hour
freeze took production archaeology to diagnose. Agreed approach (logs would not be read;
`wrangler tail` drowns under crawler traffic): on batch failure in
`apps/api/src/indexer/sync.ts`, persist `last_replay_error` (event_index + error message +
timestamp) into `core_state`, surface it in `/v2/status` and `/admin/status`, clear it on a
successful run. Next poison event then names itself.

## 3. Recovery re-verify sweep (watch, don't fix yet)

`RECOVERY_REQUEST_REVERIFY_SQL` (`apps/api/src/recovery/verify.ts`) walks an address's whole
recoverable set (~500k rows for the big address) on each triggering page view when nothing is
stale — 8M rows/day average, 44M on the spike day. Left alone on purpose: it is fire-and-forget
(no user latency), and a fourth index on `recovery_outputs` costs roughly as much in
index-maintenance writes as it saves in reads (see the measurement note in
`migrations-recovery/0014`). Revisit only if read-triggered spikes become routine.

## 4. Deep-pagination on the global record feeds

The global feeds (`listOrders`, records feeds in `queries/records.ts`) still use
LIMIT/OFFSET; a crawler paging deep reads offset+limit rows per page. The per-asset orders
tab (the measured offender, 590k rows/run) was fixed this session with seek indexes
(0087) — the remaining global-feed exposure is smaller and needs keyset pagination, which
changes the wire contract (`@xcp/shared`) and the web client. Do as its own project.

## 5. Small follow-ups

- `tx_index` on `pool_matches`/`pool_liquidity` allows multiple fills/legs per tx now; the
  tx-detail view (`read/chain.ts` `pool_matches` case) still shows only the first fill —
  consider listing all fills for a multi-fill tx.
- Three files had Prettier drift committed to main (fixed in `ce22e96`); if it recurs, the
  Prettier version is probably inconsistent between machines — worth pinning.
- Counterparty v11.3 renamed/dropped fields on some events (DISPENSE lost
  `dispenser_tx_index`; handlers already derive it). A pass comparing current v11.3 event
  payloads against every handler's `p.*` reads would catch the next silent shape change
  before it ships.

## Done this session (context)

- Diagnosed and fixed the mirror freeze: multi-fill POOL_MATCH vs UNIQUE(tx_index) —
  migration 0086, regression test, drained 126-block lag.
- Pre-fixed the identical bug in `pool_liquidity` and restored the backward-asset index 0086
  dropped (0088).
- Alchemy 429/5xx backoff on both clients (`alchemy-rpc.ts`, `alchemy-nfts.ts`).
- Retired the dead Emblem getNFTSales crawl (user's WIP, committed).
- Cache fixes: per-tag collection profiles (~120M rows/day saved), venue stats TTL 1h→6h
  (~180M rows/day saved).
- Asset orders seek (0087): 394k → 302 rows per page, 1,300×.
- Removed dead `listAssetPools`/`listAssetPoolMatches` in `queries/assets.ts` (broken SQL,
  unreachable).
