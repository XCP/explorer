# Scoring & graph research backlog

*2026-07-07. Eleven research-informed candidate improvements to the feature-based scores and the
graph trait, filtered by one criterion: testable with machinery that already exists (the
signal-test harness `/admin/signal-test`, the trades ledger, the vaulted/grail validation gates,
the curated seeds). Discipline: every candidate enters through the harness and must beat the
existing factors on the pre-registered gates (vaulted median-gap, grail margin) or it stays here
as a note. See reputation.md for the tuning workflow and graph-reputation.md for the graph design.*

## Ranked build order

| # | Idea | Field | Cost | Confidence |
|---|------|-------|------|------------|
| 1 | HODL-age / diamond-hands ratio | on-chain analysis | low | near-certain signal |
| 2 | Gini/entropy holder concentration | information theory | low | strict upgrade of top1_pct |
| 3 | Circular-funding wash check | NFT wash-trade research | medium | closes the last wash vector |
| 4 | Repeat-sales index | art-market econometrics | medium | product jewel + wash detector |
| 5 | Provenance-premium experiment | art history / valuation | medium | most distinctive if it validates |
| 6 | Temporal (time-respecting) trust edges | temporal graph theory | high (rebuild) | kills aged-address attacks |
| 7 | Value-weighted trust edges | trust-network research | low (rebuild) | one-line edge SQL, A/B-able |
| 8 | k-core number | graph theory | medium | sybil-resistant centrality |
| 9 | Personalized Hitting Time (PHT) | the graph research's rank #2 | medium | sybil-proof second opinion |
| 10 | Community detection (descriptive) | network science | medium | product insight, not scoring |
| 11 | Hedonic pricing + burstiness bot signal | valuation / info theory | medium | anomaly surfaces |

## The candidates

### 1. HODL-age / diamond-hands ratio (asset feature)
What fraction of an asset's supply hasn't moved in >2 / >5 years. Conviction is the most robust
signal in on-chain analysis, and it's expensive to fake — you must actually lock real supply for
years. Cheap SQL over balances + sends (last-moved block per holding). Harness-test as a factor
against the vaulted/grail gates. Top candidate for the next scored feature.

### 2. Gini coefficient / Shannon entropy of holder distribution (asset feature)
`top1_pct` is one point on the distribution; Gini/entropy capture shapes it misses (five colluding
holders at 19% each reads as healthy top1). Standard in token-distribution research. One aggregation
over balances per asset. Likely replaces or augments top1_pct + holder_breadth.

### 3. Circular-funding wash check (guard, not factor)
Published NFT wash detectors go one hop deeper than buyer≠seller≠origin: **was the buyer's money
funded by the seller within k hops** on the sends graph? Run it on the top-N realized sales only
(bounded). Would harden `__realized_usd` beyond the distinct-buyer gate — PEPEMILLION's two
"distinct" buyers face exactly this test. Output: a `circular_funding` flag on trades rows.

### 4. Repeat-sales index (product + wash detector)
Case-Shiller / Mei-Moses method: track the SAME card selling twice in the trades ledger to build a
composition-controlled price index per collection/era — a Counterparty art-market index nobody else
can publish. Bonus: repeat sales at anomalous intervals or round-trip prices are the classic wash
signature. Surfaces on /collections and asset pages ("last sale vs prior sale").

### 5. Provenance-premium experiment (hypothesis → feature)
Art-market claim: a famous prior owner raises price. Testable on our data: does a card's next sale
price rise after passing through a top-tier (OG) collector's wallet, controlling for market drift
(use the repeat-sales index from #4 as the control)? If the effect is real, "was held by an OG"
becomes a scored feature with a measured coefficient — and it's inherently sybil-resistant (you
can't fake having been in a real collector's wallet; they'd have to accept your card).

### 6. Time-respecting trust edges (graph rebuild)
The current graph flattens 12 years — a 2015 edge and a 2025 edge count equally, in both
directions. Temporal-graph research: trust should flow only FORWARD in time (a vouch received in
2016 shouldn't launder a wallet sold/compromised in 2024). Kills the aged-address purchase attack
outright. Requires edge timestamps (we have them) and a per-epoch iteration scheme — the biggest
single graph upgrade, priced as a full redesign of the pass structure.

### 7. Value-weighted trust edges (graph rebuild, cheap)
Edges weigh `ln(1+count)`; Bitcoin-OTC-style trust research argues for economic cost:
`ln(1+BTC transferred)`, capped. A vouch that cost real money is a stronger vouch. One-line change
to the edge SQL; A/B with the same gauntlet + baseline snapshot method used for the bipartite
experiment.

### 8. k-core number (address feature candidate)
Degree is sybil-fakeable; your k-core number (max k such that you sit in a subgraph where everyone
has ≥k neighbors) requires your WHOLE neighborhood to be dense — sybils can't lift it. Computable
as bounded iterative SQL (repeatedly strip nodes below degree k). Harness-test as an address factor.

### 9. Personalized Hitting Time (graph second opinion)
The verified research's rank #2: expected steps for a random walk from the seeds to reach a node.
Uniquely, adding sybils yields ZERO benefit to the attacker (vs plain PPR being gameable with one
two-loop sybil). Monte Carlo multi-walk implementation as a bounded job; use as a cross-check
column against Min-k-PPR, not necessarily displayed.

### 10. Community detection (descriptive layer)
Louvain / label propagation over the money-flow graph to NAME the neighborhoods (Rare Pepe artist
cluster, stamp cluster, dispenser-commerce cluster) — a "community" chip on address pages and a
map-of-the-ecosystem page. Explicitly NOT a score input. Also yields modularity, which the verified
research says predicts where sybil detection weakens — a health metric for the graph itself.

### 11. Hedonic pricing + burstiness (anomaly surfaces)
(a) Regress realized USD on attributes (collection, supply, artist track record, breadth, age) →
shadow prices per attribute + residuals flagging assets trading far from what attributes predict —
framed as "unusual vs peers", never advice. (b) Burstiness: human activity has power-law inter-event
gaps; scripts are metronomic. Variance of per-address inter-event times = one-scan bot-likeness
signal feeding `likely_service` / low-quality classification, not the score.

## Data acquisition (not features — inputs that upgrade existing features)

### A. CEX trade history + CMC historic prices (source: XCP/app.xcp.io Laravel app, LIVE, MySQL)
Investigated 2026-07-07. The old app.xcp.io repo/database holds what our USD pipeline is missing:
- **Zaif CEX trades** (`IndexZaif`/`ProcessZaifTrade` → `trade_histories`): real exchange-traded
  XCP/JPY and XCP/BTC fills — the deepest XCP market of the 2016-2018 era.
- **CoinMarketCap historic daily CSVs** (`ImportCMCHistoricData`) for XCP (slug `counterparty`),
  PEPECASH, FLDC, BITCRYSTALS — exchange-consensus USD dailies back to ~2014.
- **`usd_fidelity_level`** column concept — provenance-graded USD values. Worth adopting: our
  `prices` table has no source/fidelity dimension.
Why it matters for OUR numbers (apps/api prices.ts): today XCP/USD = own-DEX XCP/BTC VWAP
(forward-filled, thin/stale after ~2017) × Coinbase BTC/USD (starts 2015-07-20 — everything
earlier is UNPRICED). CMC+Zaif fixes both: covers 2014+, real market prints instead of stale
forward-fill, and PEPECASH/USD would let us price DEX/dispenser trades QUOTED in PEPECASH (a real
quote currency of the 2016-2018 card market) that `applyTradeUsd` currently skips entirely.
ETL shape: one-time export (artisan/SQL dump) → rows into `prices(day,currency,usd)` + a
`source`/`fidelity` column; keep `__realized_usd` recalibration behind the usual gates.
Maintenance: none for the historic value (it's frozen history); ongoing XCP/USD stays DEX-derived.

### B. Consolidation service (source: same app.xcp.io app — see bitcoin-indexer.md "Related
systems"): the migration path is owned by the Bitcoin indexer plan, since its follow-daemon and
the consolidation service's MonitorBlockchainJob are the same per-block loop.

### C. Thin-market pricing methodology (deep-research verified, 2026-07-07; all findings 3-0
adversarially confirmed against primary sources)
1. **Kill indefinite forward-fill** (Lo-MacKinlay 1990; Getmansky-Lo-Makarov JFE 2004): last-print
   extrapolation is the textbook stale-price defect — understated volatility, spurious
   autocorrelation, and a rate that lags the BTC/USD anchor it multiplies. Even 3-period smoothing
   distorts beta -67% / Sharpe +73%. Policy: forward-fill up to a staleness horizon, then NULL.
2. **Daily volume-weighted MEDIAN, not VWAP** (CME CF Bitcoin Reference Rate pattern: partition
   window → volume-weighted median per partition → equal-weight average). A single wash print
   can't move a volume-weighted median unless it carries >50% of bucket volume. Pure SQL.
3. **Local-level Kalman filter = optional upgrade, bounded batch job** (Durbin-Koopman):
   forward-fill is exactly the q→∞ degenerate case; a fitted q buys shrinkage of lone prints,
   two-sided smoothing across gaps, and a gap-widening variance band that IS a self-calibrating
   staleness cutoff. Worth it for the admission signal; not transformative for point estimates
   once 1+2 are in.
4. **Measure edge staleness from returns alone** — lag-1 autocorrelation (≈ nontrading
   probability), GLM smoothing index, or simplest: regression beta of the pair's returns on
   LAGGED anchor returns (a fresh XCP/BTC series shouldn't be predictable from yesterday's BTC
   move). Compute on trade-date-only returns, never on the filled calendar. KEY REFINEMENT to the
   derivation-depth rule: **edge staleness dominates hop count** — a depth-2 chain through two
   fresh edges beats a depth-1 stale edge. Keep depth ≤ 2 as the structural gate; make the
   per-edge floor a staleness+liquidity test.
5. **Never publish model-corrected prices; NULL is the literature-aligned choice** (Fisher-
   Geltner-Webb bias per Cho-Kawaguchi-Shilling 2003; aggregation failure per Couts-Goncalves-
   Rossi RFS 2024; window instability per Gohs et al. 2022). And Qian (JFQA 2011): the cost of
   published stale prices isn't bias, it's EXPLOITABILITY — directly relevant to reputation
   scoring, where a stale USD value is a gameable target. Unsmoothing/Kalman machinery is for
   internal admission signals and uncertainty bands only.

## Standing constraints

- New factors: implement in BOTH `factorValue` and `rawSqlExpr` (config-driven parity), recalibrate
  anchors once per batch, validate against the gates, document in reputation.md.
- New graph variants: snapshot the incumbent into `graph_baseline` first (the A/B method), reuse the
  gauntlet (tests/graph.test.ts), respect the machines-don't-vouch exclusions, and re-run the H4
  weight experiment only per its documented re-run rule.
- Heavy computations follow the bounded-resumable-job pattern (graph.ts) with per-op D1 limits in
  mind (chunk by rowid/block windows; ~100 bound params max; throttle against read contention).

## Holders also collect — relevance spec (2026-07-07)

Replaces the current most-held cohort query behind the asset page's "Holders also collect"
section (which today surfaces XCP and airdrop spam — assets everyone holds say nothing about
what THIS asset's collectors collect). Demo: `design-lab/v12-also-collect.html`.

**Signal.** For anchor asset A and candidate B:

    lift(B | A) = P(holds B | holds A) / P(holds B)
                = (coHolders(A,B) / holders(A)) / (holders(B) / population)

computed over `balances` (quantity > 0). Minimum co-holder floor: `coHolders(A,B) >= 5` —
below that, lift is noise.

**Population hygiene (machines don't collect).**
- Exclude holder addresses curated as exchange or burn addresses from both numerator and
  denominator — a CEX hot wallet "co-holds" everything.
- Exclude candidate assets with `low_quality = 1` and graph-distrusted assets (asset_signals).
- Exclude A itself and its subassets.

**Tag boost (shared collection).** `score = lift × (1 + boost)` where boost ≈ 0.4 when A and B
share a collection/series tag (tags table); shared-tag neighbors are what a collector means by
"also collect", so ties break toward the collection.

**Sorts.** relevance (default, score desc) · same-collection (tag match first, then co-holder
share) · recently-sold (last sale recency, unified sales ledger) · most-held (holders desc —
kept as an explicit escape hatch, never the default).

**Bounded SQL sketch** — two indexed aggregates over balances plus one join; no cross product:

    -- 1. co-holder counts for holders of A (indexed scan on balances(asset), then by address)
    WITH a_holders AS (
      SELECT address FROM balances WHERE asset = :A AND quantity > 0
        AND address NOT IN (SELECT address FROM curated_addresses WHERE kind IN ('exchange','burn'))
    ),
    co AS (
      SELECT b.asset, COUNT(*) AS co_holders
      FROM balances b JOIN a_holders h ON h.address = b.address
      WHERE b.quantity > 0 AND b.asset != :A
      GROUP BY b.asset HAVING COUNT(*) >= 5
    )
    -- 2. join global holder counts + signals/tags for lift, quality filter, tag boost
    SELECT co.asset, co.co_holders, s.holder_count, s.last_sale_usd, s.last_sale_block,
           (co.co_holders * 1.0 / :holdersOfA) / (s.holder_count * 1.0 / :population) AS lift,
           (t.tag IS NOT NULL) AS same_collection
    FROM co
    JOIN asset_signals s ON s.asset = co.asset AND s.low_quality = 0 AND s.graph_distrusted = 0
    LEFT JOIN tags t ON t.asset = co.asset AND t.tag IN (SELECT tag FROM tags WHERE asset = :A)
    ORDER BY lift * (1 + 0.4 * (t.tag IS NOT NULL)) DESC
    LIMIT 24;

Cost is bounded by holders(A) × avg assets per holder for the first aggregate (fan-out only
over A's holder set, not the whole table) — cache per asset alongside the other derived
builders; rebuildable from raw per the mirror rule.
