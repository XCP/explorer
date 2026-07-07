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

## Standing constraints

- New factors: implement in BOTH `factorValue` and `rawSqlExpr` (config-driven parity), recalibrate
  anchors once per batch, validate against the gates, document in reputation.md.
- New graph variants: snapshot the incumbent into `graph_baseline` first (the A/B method), reuse the
  gauntlet (tests/graph.test.ts), respect the machines-don't-vouch exclusions, and re-run the H4
  weight experiment only per its documented re-run rule.
- Heavy computations follow the bounded-resumable-job pattern (graph.ts) with per-op D1 limits in
  mind (chunk by rowid/block windows; ~100 bound params max; throttle against read contention).
