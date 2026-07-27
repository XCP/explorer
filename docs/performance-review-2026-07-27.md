# Performance review — D1, Workers, and edge cache (2026-07-27)

Window: 2026-07-24 through 2026-07-27 (3 days), Cloudflare GraphQL analytics plus live probes.
Context that skews some numbers: this window contains the Bitcoin index bootstrap upload, the OTC
census imports, and the bundle import — write volume on `xcpio-btc` and parts of `xcpio-core`
read volume are one-off, not steady state.

## D1

| database | reads | writes | rows read | rows written | batch ms p50/p90/p99 |
| --- | --- | --- | --- | --- | --- |
| xcpio-core | 5.89M | 1.29M | **8.03B** | 8.34M | 0.27 / 1.9 / 23 |
| xcpdex | 399k | 1.60M | 5.10B | 12.6M | 0.65 / 4.6 / 242 |
| xcpio-btc | 11.8k | 37.2k | 818M | 2.33M | 0.54 / 10 / **8,154** |
| rssmixer-production | 11.9k | 5.3k | 1.6M | 7.3k | 0.25 / 0.6 / 1.9 |

Rows read is the D1 billing dimension: ~2.7B/day on `xcpio-core` alone. The p99 on `xcpio-btc`
is the bootstrap's bulk upserts (one-off). `xcpdex` is its own product but reads 1.7B rows/day
and deserves its own pass.

### Where xcpio-core's 8B rows go (top queries, 3 days)

1. **The combined CEX daily series CTE: 4.06B rows read (50.5% of everything)** — 55k executions
   at ~73k rows each, 22ms p50. It backs `/v2/exchanges` and, since the valuation change, every
   asset detail render calls `combinedMarketAsset` with the same full CTE. One day's data changes
   per day; the whole history is recomputed per call. **Fix: materialize into a
   `combined_market_daily` table maintained by canonical maintenance, and read that.** This
   halves core row reads.
2. Network daily aggregate rebuild: 1.6B rows over 2,871 executions, p99 1.5s.
3. `asset_signal_dirty` join sweep: 535M over 1,029 executions.
4. `supply_by_day` MATERIALIZED CTE: 452M rows over **13 executions at 12.3s each** (price page
   lineage). Candidate for the same materialization treatment.
5. Yearly transaction scans: 378M over 60 executions at 6.7–8.2s (year pages).
6. `UPDATE trades SET usd_value=…` price applier: 166M rows over 312 executions (cron every few
   minutes rescans for unpriced trades). **Fix: partial index on `trades(usd_value) WHERE
   usd_value IS NULL`** (or a block_time floor) so the applier stops scanning priced history.
7. `SELECT … FROM transactions WHERE fee IS NULL`: 222M rows over 10.9k executions — the fee
   backfill's polling query; retire or partial-index it now that fee coverage is 100%.
8. `/v2/bitcoin/status` COUNT/MIN/MAX over 681k `btc_block_metrics` rows per cache miss. **Fix:
   maintain the counts in `btc_index_state` at import time** and read four rows instead.

## Workers (3 days)

| script | requests | errors | cpu p50/p99 (µs) | wall p50/p99 (µs) |
| --- | --- | --- | --- | --- |
| xcp-web | 453k | 0 | 12,009 / 221,260 | 95k / 1.21M |
| xcp-api | 425k | 1 | 2,223 / 26,090 | 104k / **4.96M** |
| xcp-cdn | 114k | 0 | 1,358 / 7,886 | 262k / 3.49M |
| xcpdex-api | 103k | **2,173** | 1,267 / 202,430 | 40k / 17.4M |

xcp-api and xcp-web are healthy on errors and CPU. xcp-api's wall p99 of ~5s is D1/upstream wait,
and it matters because of the revalidation finding below. `xcpdex-api`'s 2,173 errors are outside
this repo but worth a look.

## Edge and cache

Requests by host (3 days): api.xcp.io 932k, xcp.io 483k, cdn.xcp.io 291k, app.xcp.io 34k.

- **The "44% 504" scare is Cloudflare-internal, not users.** api.xcp.io shows 407k 504s and 450k
  204s, concentrated on the polling endpoints (`/v2/mempool`, `/v2/status`, `/v2/price/ticker`).
  Every one of the 504s carries an empty user agent and originates from Cloudflare's own ASN
  across dozens of countries; live probes of those endpoints return 200 in 70–145ms. These are
  edge-internal background requests — the stale-while-revalidate refresh population is the
  leading explanation, with xcp-api's ~5s wall p99 hitting the revalidation budget. Real clients
  closing early (499) number just 510. Follow-ups: pin down the exact producer (Worker
  observability logs on a sampled window), consider longer `max-age` on the three polling
  endpoints to cut revalidation churn, and treat the 504 count as billing/observability noise
  until proven otherwise — each one is still a billed Worker invocation.
- **api.xcp.io CDN cache barely hits**: 353k miss / 54k stale / 6.7k hit. The Worker-side Cache
  API (x-cache HIT) is invisible to zone analytics, so effective caching is better than this
  looks, but the CDN cache rule itself mostly misses because API URL cardinality is high
  (per-asset, per-tag, per-tx paths). The tag pages alone account for thousands of misses (each
  collection slug is its own cold URL). Either scope the CDN rule to the hot list endpoints or
  accept the Worker cache as the real layer and stop double-caching.
- **cdn.xcp.io: 16% hit, plus 74k 504s on `/img/icon/A…` numeric assets** — media resolution for
  dead hosts still stalls the request instead of failing fast; the bounded missing-art negative
  caching shipped 2026-07-24 should be verified against these paths and its TTL raised if these
  are repeat offenders.
- app.xcp.io is 56% 404s (19k) — legacy deep links; a redirect map to xcp.io equivalents would
  recover that traffic. www.xcp.io is pure 308 redirects to the apex, as designed.

## Priority actions

1. Materialize the combined CEX daily series (halves core D1 reads; also makes asset detail
   cheaper — the valuation feature made this CTE per-asset-page hot).
2. Store Bitcoin index coverage counts in `btc_index_state` at import time.
3. Partial index for the trades price applier; retire the fee-backfill poller.
4. Identify the Cloudflare-internal 504 producer on the polling endpoints; lengthen their
   max-age if it is revalidation churn.
5. Verify negative caching on cdn.xcp.io `A…` icon paths; raise the miss TTL.
6. Materialize `supply_by_day` and the yearly scans if their pages are rebuilt more than daily.
