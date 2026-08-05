# The $21,937 D1 invoice — incident report and defense posture

**Date:** 2026-08-05 · **Invoice:** IN-72106105 (Jun 19 – Jul 18, 2026) · **Status:** root-caused,
fixed, verified in prod; billing ticket filed 2026-08-05 (owner), decision pending.

## What happened

Cloudflare invoice IN-72106105 billed **$21,937.25**, of which **$21,760.00 was one line: D1 "Rows
Written" — 21,759,673,047 rows** at $1/M (first 50M free). Everything else on the invoice was noise
(rows read $164.95, storage $1.50, subscriptions $10).

### Attribution (from Cloudflare's own per-database and per-query analytics)

- **97.5% (21.21B rows) came from the legacy `xcpio` database** (`0aa317ef…`) — the first-iteration
  indexer, predating `xcpio-core`. Its daily write curve flatlined at **~2.0B rows/day from Jun 28
  through Jul 8**: a pegged loop, not organic indexing.
- Per-query analytics named the code: the legacy worker's cron ran **full derived-table rebuilds
  every 2-minute tick** — `DELETE FROM tags WHERE source='computed'` + full re-INSERT (~550
  executions per sampled 3-day window) and full-table PageRank UPDATE/DELETE iteration passes.
- That worker and database were retired ~Jul 13 when `xcpio-core` took over. The legacy database
  has written **zero rows since Jul 19**. The bug cannot recur; the code no longer exists.
- The current period (Jul 19 – Aug 18) was still pacing **~$1,300** before the Aug 5 fixes, from
  inherited milder cases of the same pattern (below).

### The billing mechanic that made it possible

D1 bills **every row a statement touches**: a no-op `ON CONFLICT DO UPDATE SET x=x` bills a write
per conflicting row; `DELETE` bills per deleted row; every index multiplies each insert. Rows
*read* are ~1000× cheaper ($0.001/M) but not free. No billing alerts existed on the account, so
the runaway ran silently until the invoice.

## What we fixed (all deployed + verified 2026-08-05)

### Writes (was ~45M/day this period; now ~0.5M/day pace)

| Fix | Was | Now | Where |
|---|---|---|---|
| Graph trust/distrust rebuild moved to Worker memory; quantized delta write-back; edges rebuild 8-weekly; scratch tables dropped (migration 0082) | ~220M rows/run, weekly ($950/mo) | **408k first run, verified**; far less on later runs | `61f712e` |
| Computed-tags reconcile: no-op upsert → `DO NOTHING` | ~2M rows/day | new tags only | `dd3e975` |
| WHERE-guards on population sweeps (vaults, asset signals, emergence, Emblem sales); tip-relative columns frozen (reads derive them live) | ~23M rows/mo | changed rows only | `43194a5` |
| xcpdex: deal_scores full wipe+rebuild every tick → daily; pair/dispenser stat sweeps → half-hourly (block-driven updates stay incremental) | ~4.2M rows/day | **723 writes/hr verified** | exchange `17e4e41` |

### Reads (was pacing ~$150/period; every hotspot closed)

| Fix | Was | Now | Where |
|---|---|---|---|
| Recovery reclassify sweep: forced-index emptiness probe (migration 0013-recovery) | 813k rows/tick | **1 row, verified** | probe commit |
| `/price` supply carry-forward: correlated scan over unindexed CTE temp → ordered-merge in Worker | ~21M rows/call | ~1M (the ledger aggregate itself) | same |
| Asset-page market summary: asset filter pushed inside the CTEs | ~73k rows/req | asset's own rows | same |
| xcpdex asset-activity: missing `orders` asset indexes (exchange migration 0028) | ~560k rows/req | **2.6k, verified** | exchange |
| Asset dirty-queue probe: `CROSS JOIN` pins join order (planner scanned the 533k-row dictionary to join an empty queue, every tick) | 533k rows/tick | **1 row, verified** | `3eafdc3` |
| Subasset feed triggers: per-row `LIKE` scan → indexed parent seek (migration 0083; names never contain dots, so only the pre-first-dot parent can match — trigger test proves equivalence) | 533k rows per subasset issuance | index seek, **plan verified** | `3eafdc3` |

Accepted standing cost: the recovery verification backstop (~500k reads/tick ≈ $10/mo) is a
by-design rolling re-verification queue; restructuring it wasn't worth the correctness risk.

### Defenses added

1. **Cloudflare budget alerts** — `billing_budget_alert` policies at **$25** and **$100** of
   period usage → me@dananderson.org (destination verified `ready`). This is the tripwire that did
   not exist in June.
2. **Hard rule 9 in CLAUDE.md** — "builders write deltas, never sweeps," with the billing
   mechanics and a **<15M rows written/month** account budget. Loaded by every future session.
3. **Hourly monitoring loop** (session-bound) — gates every database against post-fix baselines,
   investigates per-query on regression.
4. **Full account audit** — all 16 workers and all 11 databases mapped to their bindings; no other
   cron-driven writers exist. `launchpad` (assets+R2) and the old `xcpdex` worker (assets) are
   inert; `xcp-cdn`'s 2-min cron rides inside xcpio-core's watched numbers.

## What to expect

- **This period's invoice (Jul 19 – Aug 18):** already absorbed ~$770 of pre-fix usage (three old
  graph runs + old dailies) plus ~$5 in one-time fix costs (migration copy, index builds, first
  score pass). Expect a bill in the **low hundreds**, then—
- **Next period onward:** all usage inside free tiers. Expected steady state **~$10/month**
  (Workers Paid $5 + Images $5) + ~$8/mo storage until cleanup (below) + a few $ of Workers CPU.
- **The ticket:** Cloudflare has a track record of forgiving first-time accidental runaways;
  the account's own analytics corroborate every claim (runaway db flatlined at 2B/day, zero writes
  since Jul 19, 96%+ reduction visible in-period). Decision timeline is theirs.
- **The weekly graph score pass** (~every Sunday) should register as a small delta write burst
  (tens of thousands of rows), not a spike. The 8-weekly edge rebuild (~Oct) costs ~7M writes.

## Follow-ups

| Item | Owner | When |
|---|---|---|
| Watch Aug 6 — first fully clean day — against gates (total writes <500k/day, reads <1.5B/day) | Claude (loop) | Aug 6–7 |
| Cloudflare ticket resolution; then **delete legacy `xcpio` db** (7.76GB, evidence until then; ~$5.80/mo) | owner | on resolution |
| Decide fate of `xcpio-ledger` (1.23GB, idle since Jul 12, **no worker binds it**; may hold OTC import history) | owner | anytime |
| Verify **Hetzner** billing dashboard once (flagged in the Jul 15 cost audit; no API token remains) | owner | soon |
| Verify **Google Cloud** usage-based remainder is ~$0; consider budget alerts there too | owner | soon |
| Click nothing re: alert emails — destination already verified; expect a test/alert only if period spend crosses $25 | owner | n/a |

## Addendum 2026-08-05 (evening) — post-fix meters, first clean hours

The monitoring loop's reading after every fix was live (22:00Z hour):

| Meter | Before fixes | After (22:00Z pace) |
|---|---|---|
| xcpio-core writes | 32–86k/hour | **~340/hour** |
| xcpio-core reads | 76–276M/hour | **~1–3M/hour** |
| xcpdex writes | ~180k/hour | **~10/hour** (sweep hours add ~10–30k) |
| xcpdex reads | 100–140M/hour | **~6–17M/hour** |
| xcpio-btc reads | 39.4M/hour flat | **~0–15M/hour** (verification backstop only) |

Account-wide that is roughly a **99% write and ~97% read reduction** against the pre-fix baseline,
with zero behavioral change in the served product (verified: /price payload identical, graph reads
healthy, deal scores still incremental per block, subasset feed crediting proven equivalent).

## Where the evidence lives

- Analytics queries: GraphQL `d1AnalyticsAdaptiveGroups` (per-database daily/hourly rows written/
  read) and `d1QueriesAdaptiveGroups` (per-normalized-query — this is what named every culprit).
  Token: `infra-audit/.env` `CF_KE`, account `bbeb864fc7ab0be8d9d02143de8cfb12`.
- Narrative with the full attribution chain: `infra-audit/CHANGELOG.md`, 2026-08-05 entry.
- Commits: explorer `61f712e`, `dd3e975`, `43194a5`, `c2aa5be` (CLAUDE.md rule), `3eafdc3` +
  read-scan fixes; exchange `17e4e41`, `cac03ee` (0028 indexes). All pushed.
