# USD pricing and valuation audit

Date: 2026-07-18. This review reconciles production D1, current code, the former Laravel implementation, prior
research notes, and market-microstructure research. Counts are a point-in-time audit and will move as indexing
continues.

## Decision

Build one auditable execution-time USD ledger, but do not pretend that every real payment is an admissible unit-price
observation. Preserve these as separate facts:

1. **Payment value:** the USD value of the consideration actually transferred at execution time.
2. **Unit-price evidence:** payment value divided by correctly normalized asset quantity.
3. **Valuation admissibility:** whether that unit price may inform last price, a reference price, Rating, or any future
   market-cap display.

Missing execution-time USD stays `NULL`. A current quote may provide a clearly bounded current conversion in a live
view, but must never be backdated into the historical calendar. No model-corrected or indefinitely carried price is
published as an observed historical price.

## Production baseline

Raw `trades` currently contains 557,603 rows:

| Currency | Rows | Stored USD | Missing USD | Stored coverage |
| --- | ---: | ---: | ---: | ---: |
| BTC | 184,985 | 182,881 | 2,104 | 98.86% |
| XCP | 222,404 | 89,883 | 132,521 | 40.41% |
| ETH | 150,136 | 150,136 | 0 | 100% |
| USDC | 78 | 78 | 0 | 100% |
| **All** | **557,603** | **422,978** | **134,625** | **75.86%** |

That raw baseline is contaminated by a deterministic identity duplication. There are 112,798 DEX matches stored
twice: once under the old concatenated 128-character order-match reference and once under the canonical
underscore-separated reference. These duplicates include 45,490 priced rows and $26.21m of counted USD. The observed
GUARDIANCARD 77 XCP duplicate is one exact example.

After excluding only those provably paired legacy identities, the truthful baseline is:

| Currency | Canonical rows | Missing USD | Coverage |
| --- | ---: | ---: | ---: |
| BTC | 183,382 | 1,052 | 99.43% |
| XCP | 111,209 | 66,265 | 40.41% |
| ETH | 150,136 | 0 | 100% |
| USDC | 78 | 0 | 100% |
| **All** | **444,805** | **67,317** | **84.87%** |

The canonical known-USD sum is $899.82m, but that is transaction flow—not attributable Counterparty-asset market
evidence. It contains bundle payments, foreign/non-Counterparty Emblem sales, and excluded scam classes. Global volume,
attributed asset volume, clean Rating evidence, and price-index observations therefore require separate aggregates.

### Missing-price shape

- All 1,052 canonical missing BTC rows are early DEX trades. The raw history begins 2014-02-03, while Coinbase's
  calendar begins 2015-07-20. BTC-priced dispenser, Scarce City, ETH, and USDC coverage is otherwise complete.
- The 66,265 canonical missing XCP rows are the main gap. Production has 4,054 XCP trade days, 2,331 of which contain
  at least one unpriced row before deduplication.
- XCP coverage is particularly sparse in 2016-2019 and becomes sparse again when no fresh XCP/BTC edge exists. The
  current seven-day maximum carry is behaving as designed: it refuses to manufacture a price through an inactive
  market.
- No currently materialized DEX trade uses PEPECASH or another exotic quote. `coreDexTradesSql()` deliberately admits
  only matches with XCP or BTC on one side. The old note that PEPECASH/USD alone would fill current `trades` is therefore
  incomplete: broader exotic-pair support first requires a graph-safe definition of which leg is the asset, which leg
  is the quote, and how multi-hop value is admitted.

## Current implementation

### What is sound

- Coinbase daily BTC/USD and ETH/USD closes are stored with source and fidelity.
- Legacy CMC-era XCP/USD already fills 544 days from 2014-01-05 through 2015-07-19. The old research note saying the
  schema lacks provenance and that the import remains wholly undone is stale.
- On-chain XCP/BTC is materialized once per day as a completed-trade volume-weighted median, then multiplied by that
  day's BTC/USD.
- A derived XCP edge may carry at most seven days; expired derived XCP prices are removed and affected trades return to
  `NULL`.
- Current BTC/USD comes from Coinbase. Current XCP/USD uses Dex-Trade XCP/BTC only while its trade feed proves that the
  market is no more than seven days stale.
- USDC is valued directly at execution. Emblem ETH trades use the daily ETH calendar.
- Bundle payments are conserved once and are not copied onto their asset legs.

### What needs correction

1. **DEX duplicate identities:** the builder converges on the new identity but never removes the old identity. This
   inflates row counts, USD volume, asset lifetime volume, and Rating's realized-value component.
2. **Trade provenance is lossy:** `trades.usd_value` does not record the selected price row/method. Auditing a trade
   requires reconstructing it from date and currency, and later calendar correction silently changes the meaning.
3. **A scalar `fidelity` is underspecified:** source priority, staleness, liquidity, derivation depth, and observation
   status are different dimensions. One ordinal cannot explain why a price won.
4. **Payment and valuation evidence are conflated:** `clean_sales` excludes self trades and non-single/scam Emblems,
   but every remaining USD payment contributes fully to Rating even when its unit-price implication is pathological.
5. **Latest price is a single print:** the asset header uses the newest admissible-by-shape sale, not a robust reference
   price. It is properly called “Last price,” but should not become market cap or fair value without stronger admission.
6. **Maintenance observability is incomplete:** there is no compact coverage report by currency/source/method, no
   price-selection audit, and no count of trades awaiting a calendar row.

## The outlier problem

The current Emblem `is_dump` rule marks a sold single-asset vault as a dump when it contains at most one normalized unit
of an asset whose supply is at least 1,000,000. Those sales remain transaction facts but become
`sale_class='scam_dump'` with no asset attribution. Production contains 89,279 such Emblem sales totaling $2.85m.

That rule catches one known abuse shape, but it is not a general unit-price method. Across attributed priced trades:

- 22,446 use a quantity below one normalized unit;
- 2,332 imply at least $100,000 per normalized unit;
- 1,195 imply at least $1,000,000 per normalized unit.

Some are valid sales of a satoshi-sized fraction; some encode collectible ownership conventions; some are deliberate
market-cap theater; and some may be data-normalization defects. A global price ceiling would destroy legitimate data.

Recommended treatment:

- preserve the payment and its USD value;
- keep `sale_class` for transaction/vault structure;
- add separate, composable price-evidence reason flags (self trade, curated integrity exclusion, bundle, invalid
  quantity, stale quote, extreme fraction, rolling-price outlier, insufficient history);
- do not label a statistical outlier a scam without ownership/funding evidence;
- compute a robust reference only when an asset has enough independent observations;
- never infer liquid market capitalization from one fractional print. If market cap is added, require an admitted
  reference price plus disclosed liquidity/breadth thresholds and show it as an estimate.

A reasonable first robust rule is log unit-price median plus median absolute deviation over prior admitted sales,
computed within asset and a bounded historical window. It should flag—not delete—outliers. With too few prior sales,
the result is “insufficient evidence,” not automatic acceptance or rejection. Repeat-sale and collection-level models
belong in offline evaluation before they affect production.

## Research synthesis

- Lo and MacKinlay model nonsynchronous trading and show that non-trading changes variance, autocorrelation, and
  cross-autocorrelation. A stale last print is therefore not a neutral observation.
- Getmansky, Lo, and Makarov show how illiquid/smoothed prices induce serial correlation. This supports a finite
  staleness horizon and explicit uncertainty, not indefinite fill.
- The CME CF reference-rate methodology partitions trades, computes a volume-weighted median in each partition, then
  averages partitions. It is a strong manipulation-resistant pattern, although our extremely thin XCP market often
  lacks enough intraday partitions to reproduce the full benchmark.
- Makarov and Schoar find that cryptocurrency price discovery varies across exchanges and time, and segmented venues
  with large arbitrage spreads contribute less. “One exchange exists” is not the same as “one exchange is authoritative.”
- Dimpfl and Peter explicitly separate information leadership from microstructure noise across crypto exchanges. Source
  count, liquidity, and disagreement should remain visible instead of collapsing into an unexplained grade.
- NFT wash-trading research finds that transaction graphs and ownership/funding links are more probative than price
  magnitude alone; indirect filters have materially different error rates. This supports preserving outliers as facts
  while gating their valuation influence.
- Art/thin-market research distinguishes hedonic and repeat-sales methods and documents selection bias in repeat-sales
  indices. These are useful evaluation models, not permission to publish a synthetic price as an observed sale.

## Recommended architecture

### 1. Repair canonical identity first

Delete only an old-format DEX row for which the exact underscore-format counterpart exists. Add a convergence test and
a production invariant requiring zero such pairs. Rebuild affected asset signals, Ratings, collection summaries, and
cached reads. Re-run this audit after repair; do not use the raw 557,603-row baseline for product claims.

### 2. Make provenance relational, not ordinal

Retain multiple observations instead of overwriting them into one unexplained winner:

- `price_observations`: asset/pair, day/time, provider, venue, price, volume, source timestamp, ingestion timestamp.
- `daily_usd_prices`: selected USD price, method, observation count, venue count, latest observation age, derivation
  depth, and selection-policy version.
- `trades`: execution USD plus selected price identity/method and policy version.

Keep a small quality enum for API ergonomics only if every value maps to explicit facts. Do not encode source trust,
staleness, and hop depth into one magic integer.

### 3. Fill direct historical anchors

- Import a licensed/reproducible daily BTC/USD series for 2014-02-03 through 2015-07-19. This can close essentially all
  1,052 canonical BTC gaps.
- Acquire a reproducible historical XCP market series (prefer trade/candle data with timestamp and volume, not a chart
  scrape). The deleted Zaif rows are not recoverable from current backups; the old local report confirms this.
- Compare external XCP/USD against our on-chain XCP/BTC × BTC/USD on overlapping trade days. Store both observations;
  select by a documented liquidity/recency policy rather than overwriting one source wholesale.
- A paid historical-data export is preferable to an undocumented free endpoint. CoinGecko's historical endpoint now
  requires credentials and CoinPaprika's historical endpoint is paid; provider licensing and snapshot checksum belong
  in the import manifest.

### 4. Add exotic-pair valuation conservatively

First materialize all completed non-BTC/XCP order matches without pretending every pair has a USD value. Then derive
USD over a time-respecting currency graph:

- direct USD/stablecoin anchors are depth 0;
- one fresh liquid edge to an anchor is depth 1;
- cap production derivation at depth 2;
- reject cycles, stale edges, insufficient economic volume, and paths whose independent quotes materially disagree;
- choose the best path by freshness/liquidity, not shortest hop alone;
- preserve the path and every observation used.

PEPECASH is the first useful evaluation case because it historically served as a real quote currency. Do not roll this
out to arbitrary asset-to-asset pairs until overlap tests show acceptable coverage, error, and manipulation resistance.

### 5. Separate product aggregates

Publish and compute distinct measures:

- `transaction_usd`: all known payment flow, including bundles and classified records;
- `attributed_usd`: payment attributable to one Counterparty asset;
- `market_evidence_usd`: attributed, independent, admitted sale evidence used by Rating;
- `reference_unit_usd`: robust price estimate with method, sample size, age, and dispersion;
- `last_sale_usd`: literal latest admitted sale, still shown with date and venue.

Rating should use `market_evidence_usd`, not raw transaction flow. A single large outlier should remain visible in sale
history while its Rating influence is capped or excluded by a predeclared, evaluated evidence policy.

### 6. Validate before changing Rating

Freeze the repaired production ledger and compare the incumbent against challengers:

1. no price-outlier gate;
2. structural exclusions only;
3. rolling log-median/MAD flag;
4. winsorized contribution to realized-value evidence;
5. per-asset diminishing returns such as `log1p(admitted_usd)` before population ranking.

Report named assets, rank/tier changes, false-positive review, duplicate sensitivity, venue concentration, and worst
historical-cutoff regression. The literature supports robustness; it does not choose our threshold. Production weights
must come from our distribution and declared outcomes.

## Implementation order

1. Canonical DEX duplicate cleanup, invariant, and derived-projection rebuild.
2. A read-only USD coverage/audit job with canonical counts by currency, venue, year, source, staleness, and derivation.
3. Price observation/selection provenance schema and backfill of existing calendar rows.
4. Reproducible historical BTC and XCP source import with manifests and overlap diagnostics.
5. Payment-versus-price-evidence flags and named outlier review, including current `is_dump` cases.
6. Offline robust-price/Rating challenger evaluation.
7. Only after those gates: exotic-pair graph, beginning with PEPECASH.
8. Surface methodology, coverage, sample size, source age, and uncertainty on a public pricing page.

This sequence maximizes truthful coverage without turning sparse prices into fabricated precision.

## Research references

- Andrew W. Lo and A. Craig MacKinlay, *An Econometric Analysis of Nonsynchronous Trading*, Journal of
  Econometrics 45 (1990), [NBER working-paper record](https://www.nber.org/papers/w2960).
- Mila Getmansky, Andrew W. Lo, and Igor Makarov, *An Econometric Model of Serial Correlation and Illiquidity in
  Hedge-Fund Returns*, Journal of Financial Economics 74 (2004),
  [MIT author page](https://web.mit.edu/Alo/www/Papers/serialhf.html).
- CF Benchmarks, *CME CF Cryptocurrency Reference Rates Methodology*,
  [official methodology](https://docs.cfbenchmarks.com/CME%20CF%20Reference%20Rates%20Methodology.pdf).
- Igor Makarov and Antoinette Schoar, *Price Discovery in Cryptocurrency Markets*, AEA Papers and Proceedings 109
  (2019), [LSE repository](https://eprints.lse.ac.uk/100410/).
- Thomas Dimpfl and Franziska J. Peter, *Nothing but Noise? Price Discovery Across Cryptocurrency Exchanges*,
  Journal of Financial Markets 54 (2021), [publisher record](https://www.sciencedirect.com/science/article/pii/S1386418120300537).
- Brett Hemenway Falk, Gerry Tsoukalas, and Niuniu Zhang, *NFT Wash Trading: Direct vs. Indirect Estimation*,
  [paper](https://arxiv.org/abs/2311.18717).
- Victor von Wachter, Johannes Rude Jensen, Ferdinand Regner, and Omri Ross, *NFT Wash Trading: Quantifying
  Suspicious Behaviour in NFT Markets*, [paper](https://arxiv.org/abs/2202.03866).
- Marilena Vecco, Simeng Chang, and Roberto Zanola, *The More You Know, the Better: A Heckman Repeat-Sales Price
  Index*, Quarterly Review of Economics and Finance 85 (2022),
  [publisher record](https://www.sciencedirect.com/science/article/pii/S1062976921000053).
