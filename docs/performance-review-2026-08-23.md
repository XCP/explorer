# Performance review — 2026-08-23

Follows `performance-review-2026-07-27.md`. That one was explorer-only; this one covers every
Cloudflare project on the account, because a cost question that stops at one repo misses the ones
sharing the database.

## First: a correction to the July review

The July review states "fee coverage is 100%" and recommends retiring the `fee IS NULL` poller on
that basis. **It was 66%.** 1,080,033 of 3,174,740 transactions had `fee IS NULL`, and the poller
was not merely redundant — it was burning its entire budget every two minutes and resolving zero
rows. Whatever produced that 100% figure should be treated as unreliable.

## The account, measured

`wrangler d1 info` on every database, 24h window:

| DB | Repo | Size | Reads/24h | Writes/24h |
|---|---|---|---|---|
| `xcpio-core` | explorer (and **img-cdn** writes here) | 4.24 GB | 507,716,037 | 1,482,803 |
| `xcpdex` | exchange | 1.23 GB | 309,489,761 | 77,083 |
| `xcpio-btc` | explorer recovery | 1.16 GB | 15,530,682 | 57,232 |
| `launchpad-db` | launchpad | 1.16 MB | 2,026,567 | 2,303 |
| `rssmixer-production` | rssmixer | 3.27 MB | 196,612 | 5,801 |
| `groupbot` / `digirare` / `rssmixer-staging` | — | <200 kB | ~0 | ~0 |

Cost lives in two databases. launchpad, rssmixer and img-cdn were audited and are clean —
**img-cdn is the best-behaved writer in the fleet**, every statement `ON CONFLICT … DO NOTHING`,
batched through `json_each`. `marketplace-db` is still a placeholder and does not exist; findings
for it were left in that repo as `D1-COST-REVIEW.md` because it had 25 uncommitted files.

## The cost model that decided every call below

D1 bills **rows written at $1/M and rows read at $0.001/M** — writes are a thousand times dearer.
An index is not free: it is a permanent write multiplier in exchange for a one-off read saving.
So the test for "should this be indexed" is not "is the scan big" but:

> extra index writes/day × 1000 vs rows read/day saved

That single ratio rejected three otherwise attractive fixes in this review.

## Shipped

### Narrowed holder invalidation (#9)

`stageHeldAssetSignals` ran off the address UPSERT's change guard, which spans all thirty projected
columns. The asset holder projection reads **four**: `is_burn`, `assets_held`, `survived_assets`,
`dex_trades`. So filling `transactions.fee` moved `btc_fees`, marked the address changed, and
dirtied every asset that wallet holds — ~19 per address, each a ~3,687-row re-derivation that could
not reach a different answer. One day showed 57,790 rebuilds and 225M rows read.

The four columns now ride along on the identity lookup the rebuild already does, so the comparison
costs no extra round trip.

**Honest status:** proven by test in both directions, not yet visible in production. The address
repair cycle completed at block 963,506 and the next starts 1,008 blocks later, so the fan-out this
prevents will not recur until then. Flat dirty queues right now are the completed cycle, not the
fix — a distinction worth keeping, because the queues would look identical either way.

### Leaderboard index gaps (#10)

`/stats` fires its boards in one `Promise.all`, so all boards run equally often. Most already had a
partial index in the shape `(col DESC, address_id) WHERE col > 0`. Exactly two did not, and they
were exactly the two still visible in insights:

| Board | Before | After |
|---|---|---|
| `ORDER BY clean_dispense_btc DESC` | 468,539 rows | **24** |
| `ORDER BY assets_hits DESC` | 444,333 rows | **24** |

~19,500× each, same twelve rows. `/v2/stats` end-to-end went **2.55s → 0.35s**.

These needed no `INDEXED BY`: filter column and sort column are the same, so the descending walk
satisfies the ordering and stops at the first row failing the predicate.

### Bitcoin fee backfill unblocked

932 pre-block-662000 transactions carried a witness hash as their Counterparty `tx_hash`
(`correct_segwit_txids` is a consensus-gated, forward-only upstream fix, so history can never be
rewritten). They sat at the top of the missing-fee index and consumed the whole budget every tick.
Resolved from raw block bytes and published; the backfill has been draining ever since.

### Tag threshold predicates reaching their indexes (#12)

Seven tag rules filtered with `col >= N` against partial indexes written `WHERE col > 0`. SQLite
only uses a partial index when it can prove the query's WHERE implies the index's, and that prover is
syntactic — it does not deduce `col >= 20` from `col > 0`. All seven planned as a full SCAN of
442,493 rows with the index unused. Restating the index predicate alongside the threshold fixes it.

| rule column | before | after | note |
|---|---|---|---|
| `survived_assets` | 444,727 | 4,468 | ~100x, identical 2,234 rows |
| `stamps_collected` | 442,493 | 15,826 | ~28x |
| `assets_held` | 442,493 | 262,968 | ~1.7x — `assets_held > 0` matches 262,968 rows, so the index is barely selective here |

**The only fix in this review with no write side at all** — a predicate, not an index. That is why it
shipped without the cost arithmetic every other candidate had to survive. The gain tracks the
selectivity of `col > 0`, which is why the assets_held rules barely move; a `WHERE assets_held >= 100`
index would fix that properly and was skipped as marginal.

A sweep of the remaining `>= N` predicates against every `> 0` partial index found no other
instances.

## Measured and deliberately rejected

Each of these looks like an obvious win until the write side is priced.

**The stamp holders board** — 66,590,700 rows/7d, the largest remaining read. Needs
`asset_signals(holders DESC) WHERE holders > 0`, which is **173,755 entries — 63% of the table** —
on a table rewritten by the repair sweep. Roughly break-even against ~9.5M rows/day saved. The
existing `idx_asset_signals_clean_holders` cannot serve it because that board omits the
`low_quality = 0` filter its siblings apply. Whether that omission is intentional is a product
question, not a performance one, and is the cheaper thing to settle first — if the filter belongs
there, the index already exists and this costs nothing.

**`holder_breadth` and `pct_creator_holders`** — 44M rows/7d combined, and beautifully selective
(7,396 of 275,900). Rejected anyway: the filter and sort columns differ, so SQLite declines the
partial index and both would need `INDEXED BY` in `queries/stats.ts` — verified against a local
reproduction of the schema, index set and row distribution. That is permanent coupling between two
of seventeen boards and a specific index name, for about **$0.17/month**.

**`dispense_btc` board** — 6.7M rows/7d against ~900 extra writes/day. Break-even. Skipped.

**The `asset_signals` repair sweep** — 225M rows/day and the largest single line in insights, but it
is the periodic full-population repair, gated to every 4,032 blocks (~28 days) and currently
mid-cycle at asset 136,566 of 276,240. Bounded and by design; amortised ~36M rows/day. Not a defect.

## The same review in `exchange`

Recorded fully in `exchange/apps/api/docs/d1-read-costs.md`. Summary: the `/markets` default read
**12,268 rows to return 9**, 3,450×/day — 13.7% of that database's entire read volume. Fixed with a
partial index plus `INDEXED BY` (needed there, unlike #10, because filter and sort differ) for a
**~1,363× reduction**, verified in production.

Its 61M-rows/day dispenser summary was left alone after three fixes were measured and rejected —
the anti-join rewrite reads *more*, deriving from `dispenser_stats` reproduces only one of four
aggregates and would silently change published numbers, and materialising on the indexer's cadence
costs 158M/day against the query's own 61M.

## Method notes

`wrangler d1 insights <db> --time-period 7d --sort-by reads|writes --limit 100 --json`.

Three traps, all of which produced a wrong answer at some point today:

1. `--timePeriod` is silently ignored; the flag is `--time-period`. `--limit` defaults to **5**.
2. `totalRowsWritten` counts **index entries**. Average rows-per-run ≈ 1 + the table's index count
   (`fairmints` has 7 indexes and averages exactly 8.0). Read as logical rows this looks like a
   100× write amplification that is not there.
3. `EXPLAIN QUERY PLAN` is not sufficient proof. Read `rows_read` from `--json` meta on the real
   statement — and reproduce the planner's choice locally before assuming an index will be adopted,
   because twice today it was not.
