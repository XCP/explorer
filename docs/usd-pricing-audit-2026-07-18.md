# USD pricing and valuation audit

Date: 2026-07-18. This review reconciles production D1, current code, the former Laravel implementation, prior
research notes, and market-microstructure research. Counts are a point-in-time audit and will move as indexing
continues.

## Decision

### Primary Zaif history discovered after the initial audit

Zaif granted permission for XCP.io to use its first-party monthly XCP/BTC and XCP/JPY execution CSVs. The files begin
on 2016-08-02 and expose timestamp, executed price, XCP quantity, and side. Provenance must record `source=zaif` and
`venue=cex` as separate facts. A read-only UTC-normalized audit found 16,063 XCP/BTC executions across 1,177 UTC days
and 330,884 XCP/JPY executions across 3,325 UTC days. Their combined calendar reaches 57,174 currently unpriced XCP
trade rows. CSV timestamps are JST (UTC+9), verified against Zaif's Unix-timestamp public API.

Zaif XCP/BTC must not blindly overwrite the Counterparty DEX series: only 111 days currently overlap, the median
absolute log difference is 0.310, and thin-market tail disagreements are large. Store both observations and select
with explicit venue, volume, trade-count, FX, and disagreement evidence. XCP/JPY is the much deeper Zaif market and
must be evaluated through an official daily JPY/USD cross before production selection.

Zaif also retains first-party monthly execution archives for PEPECASH/JPY and PEPECASH/BTC. They contain 852,648
PEPECASH/JPY executions across 1,201 UTC days and 41,187 PEPECASH/BTC executions across 971 UTC days, both spanning
2017-01-13 through 2020-04-28. This is the missing attributable PEPECASH anchor: use the JPY market through ECB FX and
the BTC market through the selected BTC/USD calendar, preserving both venue observations when they overlap.

### Historically material venues

The explorer's independent on-chain exchange graph proves that Zaif was not the only material Counterparty venue.
Known Bittrex custody received Counterparty assets from 14,073 distinct addresses; the largest known Poloniex wallets
received them from 3,833 and 3,631 addresses, versus 1,118 for the largest known Zaif wallet. PEPECASH alone has 978
distinct exchange depositors. These facts establish use and help bound venue-active periods, but deposits are not
executions and contain no market price.

Poloniex's current official candle endpoint recognizes `XCP_BTC` but returns no retained candles; alternate pair
orientations and PEPECASH symbols are rejected. Bittrex no longer exposes a functioning first-party archive. Recover
their execution history only from a licensed archive that identifies the underlying exchange, pair, timestamp,
price, and volume. Store the execution venue separately from the archive provider. Until then, CMC/Yahoo aggregate
history is corroborating evidence for non-Zaif activity, not a source from which to manufacture per-venue prices.

Coin Metrics' public market catalog confirms `poloniex-xcp-btc-spot` daily coverage from 2014-02-14 through
2019-06-15 and `bittrex-xcp-btc-spot` from 2019-05-16 through 2019-06-29. The catalog is free, but historical candles
require professional access. The Poloniex series is therefore the highest-value next acquisition. The short Bittrex
interval cannot stand in for Bittrex's full history; Kaiko is the more credible acquisition candidate because it has
collected exchange executions since 2014, and published market-microstructure research specifically used Kaiko when
Bittrex's own API retained only a short window.

Bter publicly launched XCP/BTC by 2014-03-09. This establishes another historically relevant venue, but no surviving
reproducible execution archive has yet been identified. Record Bter in the venue timeline and continue archive
research; do not backfill prices from launch announcements or chart images.

Dex-Trade's official public endpoint supplies recent executions but has no cursor or time-range parameters. On
2026-07-18 it returned 16 XCP/BTC trades spanning 2026-07-05 through 2026-07-14 and one PEPECASH/BTC trade on
2026-07-09. The production spot crawler already rejects XCP/BTC unless a returned execution is at most seven days old.
Add PEPECASH/BTC to forward observation maintenance, but do not describe this sliding recent window as a historical
archive or infer that omitted trades did not occur.

### Aggregated-provider survey

The expanded source survey distinguishes execution venues from sites that repackage another provider's aggregate:

- CoinMarketCap retains 4,534 daily XCP observations from 2014-02-15 through 2026-07-17 when its historical endpoint
  is requested in bounded yearly windows. It reports nonzero aggregate volume on 4,274 days. Its documented price is
  a volume-weighted average across admitted market pairs, and its volume is the sum of admitted exchange-reported spot
  volume. Historical constituent identity is not included in the daily response.
- On all 3,341 days covered by the authorized Zaif series, CoinMarketCap and the highest-volume Zaif daily observation
  have median absolute log-price error 0.0274, p90 0.1473, and p99 0.5923. Aggregate CMC volume is $604.74m versus
  $62.04m reconstructed Zaif volume on those days. The resulting $542.77m positive arithmetic residual is evidence
  of historical non-Zaif reporting, but not automatically trustworthy volume or a recoverable other-venue price.
  Several high-residual periods have extreme price disagreement, and CMC itself documents exchange volume inflation.
- CoinGecko currently derives XCP entirely from Zaif XCP/JPY. It is a useful independent aggregation check over
  historical periods only if historical ticker membership can be established; its current series adds no venue.
- Coinbase explicitly says its non-tradable XCP data comes from CoinMarketCap and other third parties. It is not an
  independent XCP observation.
- Kraken does not list XCP and warns that the representative page may contain third-party data. Its XCP page is not
  Kraken execution evidence. Kraken remains a strong primary source only for its downloadable BTC/USD executions.
- Yahoo exposes 3,174 XCP/USD daily rows from 2017-11-09 and labels the market `CCC`; this is consistent with a
  CryptoCompare-family aggregate rather than Yahoo executions. Treat it as an overlap validator until provider and
  redistribution rights are confirmed.
- Crypto.com, DigitalCoinPrice, and Business Insider expose display series but no attributable XCP venue history in
  the reviewed pages. They should not be counted as independent markets merely because their charts differ.
- CoinMarketCap retains the inactive Counterparty Pepe Cash identity (`id=1405`), but its historical endpoint now
  returns only one zero-volume 2023 observation. CoinGecko's active `pepecash-2` is a separate Ethereum token and must
  never be joined to Counterparty PEPECASH.

The old “other venues” subtraction is safe only as a descriptive residual:
`aggregate reported USD volume - independently reconstructed named-venue USD volume`. Preserve negative results and
methodology changes as diagnostics rather than clamping them. Do not algebraically recover an “other” price unless the
provider supplies the exact constituent set, weights, exclusions, and synchronized venue observations for that day.
An aggregate VWAP and aggregate volume are insufficient when the provider filters outliers or changes constituents.

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
twice: once under the underscore-separated public order-match identity imported from the pre-compaction `trades`
projection and once under the 128-character concatenated identity emitted later by the compact-native builder. Because
`(venue,ref)` is the primary key, the changed spelling prevented the intended upsert conflict. These duplicates include
45,490 priced rows and $26.21m of counted USD. The observed GUARDIANCARD 77 XCP duplicate is one exact example.

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

1. **DEX duplicate identities:** the compact builder converges on its concatenated identity but never removes the
   imported underscore identity. This inflates row counts, USD volume, asset lifetime volume, and Rating's
   realized-value component.
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

Standardize on the underscore-separated order-match identity already used by the public API. Change the compact builder
to that identity, insert/upsert all 112,812 qualifying canonical matches, and only then delete a concatenated row whose
exact underscore counterpart exists. Add a convergence test and a production invariant requiring one trade per
qualifying source match and zero alternate-format pairs. Rebuild affected asset signals, Ratings, collection summaries,
and cached reads. Re-run this audit after repair; do not use the raw 557,603-row baseline for product claims.

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

## Detailed execution plan

### Phase 1 — canonical DEX identity repair

1. Add a fixture proving that replaying one completed order match produces exactly one trade whose `ref` equals the
   public underscore-separated order-match ID.
2. Change `coreDexTradesSql()` to emit that ID. Keep the existing upsert semantics and preserve `usd_value` during a
   structural replay.
3. Add one normal core migration that:
   - upserts every qualifying completed XCP/BTC order match into the underscore identity;
   - verifies through SQL shape that every concatenated candidate now has the counterpart;
   - deletes only paired concatenated rows, allowing the existing delete trigger to enqueue affected assets.
4. Gate Rating refresh while `asset_signal_dirty` is non-empty. The repair affects 4,949 distinct assets; at the current
   400-asset maintenance batch it should drain in about 13 serialized cycles rather than publish a partially rebuilt
   population ranking.
5. Drain the queue, force one Rating refresh, invalidate affected read caches, and verify:
   - 112,812 qualifying source matches;
   - 112,812 DEX trade identities;
   - zero duplicate source identities;
   - zero paired alternate-format rows;
   - GUARDIANCARD has one 77 XCP row;
   - canonical totals equal the independently derived baseline, adjusted only for post-audit new blocks.
6. Re-run the USD coverage and Rating-distribution audits and retain the before/after report.

Rollback is the pre-migration D1 bookmark. No delete is permitted before the canonical underscore upsert succeeds.

### Phase 2 — permanent pricing observability

1. Add a read-only operator audit that reports canonical trade counts and USD coverage by venue, currency, year,
   selected source, staleness, and derivation method.
2. Add invariants for orphan selected prices, expired XCP carries, direct-USDC parity, and trades whose calendar price
   exists but `usd_value` is absent or divergent.
3. Put compact results in the existing backfill/status surface: price-calendar frontier, pending trade reconciliation,
   missing rows by currency, and newest successful current quote.
4. Run the report in CI on fixtures and on a schedule in production; it must not scan the ledger on user requests.

Completion gate: the report reproduces direct SQL totals, costs a bounded scheduled query, and alerts on any new
identity or coverage regression.

### Phase 3 — clarify the public USD contract

1. Keep stored `usd_value` strictly execution-time historical USD.
2. Stop returning a current conversion in that same field for a recent trade with no historical calendar observation.
   Add a separate nullable current estimate plus an explicit basis such as `execution` or `current_quote`; render the
   latter with an approximation marker.
3. Keep “Last price” literal, with venue and time. Do not call it fair value or market cap.
4. Document transaction flow, attributed volume, admitted market evidence, and reference price as different measures.

Completion gate: an API consumer can determine whether every displayed USD number is observed-at-execution, directly
USD-denominated, derived from a historical path, or converted using a current quote.

### Phase 4 — normalize price selection without premature machinery

1. Extend the selected daily `prices` row with a policy version and the factual diagnostics actually used in selection:
   observation count, venue count, age, and derivation depth. Retain existing `source` and `observed_day`.
2. Do **not** add a general `price_observations` table until a second historical/current provider is actually ingested.
   When it is needed, store provider observations there and keep `prices` as the selected materialization.
3. Add overlap tests proving that higher-priority observations win without lower-priority replay overwriting them.
4. Record selection changes in a small audit log instead of duplicating source strings across every trade row.

Completion gate: a `(day,currency)` selection is reproducible from stored observations and a named policy version.

### Phase 5 — direct historical gap fill

1. Acquire a licensed, reproducible BTC/USD daily series covering 2014-02-03 through 2015-07-19.
2. Acquire historical XCP/USD or XCP/BTC observations with timestamps and preferably volume. Do not use chart scraping.
3. Save the raw snapshot outside D1, checksum it, record provider/license/fetch time, and build a deterministic importer.
4. Compare external XCP prices with on-chain XCP/BTC × BTC/USD on overlapping active days: median absolute log error,
   tail disagreement, missingness, and results by liquidity bucket.
5. Insert observations, run the versioned selection policy, reconcile affected trades, and publish before/after coverage.

Completion gate: essentially all 1,052 early BTC gaps close; XCP coverage improves by a measured amount without filling
days unsupported by an admitted observation.

### Phase 6 — payment versus unit-price evidence

1. Define independent reason flags for transaction structure, counterparty integrity, price staleness, quantity shape,
   and statistical outlier status. Do not overload `sale_class` or `is_dump` with every meaning.
2. Produce distribution reports for payment USD, normalized quantity, unit USD, implied capitalization, ownership links,
   repeat buyers, venue, and asset history. Review named legitimate fractional assets and known abuses.
3. Preserve every real payment in transaction flow. Exclude bundles from per-asset unit price. Treat a price outlier as
   a flag, not proof of fraud.
4. Add a robust reference-price research implementation using prior admitted log prices, median/MAD, sample size,
   dispersion, and age. With insufficient history, return no reference price.

Completion gate: the same transaction can truthfully count as payment flow while being excluded from asset valuation,
and every exclusion exposes a factual reason.

### Phase 7 — evaluate Rating impact

1. Freeze the repaired ledger and predeclare comparison outcomes and named review cohorts.
2. Compare structural-only, median/MAD, winsorized realized-value, and `log1p` diminishing-return challengers against the
   incumbent across historical cutoffs.
3. Report rank/tier changes, worst-cutoff regression, collection concentration, venue concentration, and false-positive
   review. Include free/paid Fairmints and current `is_dump` cases in the cohort.
4. Ship no Rating change unless a checked-in report justifies it. Increment the model version if one wins.

Completion gate: the chosen policy is supported by Counterparty data and declared outcomes, not selected because a
paper or one anecdote supplied a convenient threshold.

### Phase 8 — exotic quote graph, starting with PEPECASH

1. First inventory completed non-XCP/BTC matches and choose the asset/quote orientation without assigning USD.
2. Convert the imported first-party Zaif PEPECASH/JPY and PEPECASH/BTC observations into independently derived USD
   candidates, retaining the underlying market and FX path.
3. Implement time-respecting paths with direct anchors at depth 0, a production cap of depth 2, cycle rejection,
   staleness/liquidity floors, and stored path provenance.
4. Backtest derived prices against days/assets that also have direct USD evidence. Measure error and coverage by depth.
5. Admit only the path classes that pass the predeclared error and manipulation review; leave all others null.

Completion gate: exotic routing adds trustworthy coverage and never turns an arbitrary asset-to-asset match into a
synthetic USD fact merely because a graph path exists.

### Phase 9 — methodology and product surface

1. Publish a pricing methodology page with sources, coverage, selection policy, staleness rules, derivation depth,
   outlier treatment, and the distinction between payment and valuation.
2. Surface source/basis, age, sample size, and dispersion where a reference price appears.
3. Add a small coverage panel sourced from the scheduled audit—not a live full-ledger aggregation.
4. Re-review Rating, Radar, collection totals, and asset headers so each consumes the intended aggregate.

Completion gate: users and contributors can trace a displayed USD number to its source and understand what it claims.

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
- Poloniex, [Spot market-data API](https://api-docs.poloniex.com/spot/api/public/market-data).
- Dex-Trade, [public Trade History API](https://docs.dex-trade.com/#api-Public_API-Trade_History).
- Coin Metrics, [market-candle coverage and methodology](https://docs.coinmetrics.io/market-data-timeseries/market-candles).
- Kaiko, [exchange instrument reference data](https://docs.kaiko.com/rest-api/data-feeds/reference-data/basic-tier/exchange-trading-pair-codes-instruments).
- Counterparty Forum archive, [2014 XCP exchange inventory](https://forums.counterparty.io/t/complete-list-of-xcp-exchanges/311).
