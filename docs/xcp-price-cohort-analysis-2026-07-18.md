# XCP price-disagreement cohort analysis

Date: 2026-07-18

This is a non-selecting evaluation of 5,108 daily candidate-versus-CoinMarketCap comparisons generated from the
immutable [`B1 diagnostic`](./data/xcp-price-disagreement-2026-07-18.json). Full metrics and ten worst named dates for
every cohort are in [`xcp-price-cohorts-2026-07-18.json`](./data/xcp-price-cohorts-2026-07-18.json).

The metric is natural-log absolute error. Cohorts were fixed in code before the report was generated: 1, 2–9, and 10+
executions; under 100, 100–999, and 1,000+ XCP; exact versus carried conversion; CMC two-decimal archive versus precise
API; Counterparty DEX active versus inactive; explicit path; and UTC year.

## Result

Path identity is more informative than any universal volume cutoff:

| Candidate versus CMC | Observations | Median | P90 | P99 | Within 10% | Within 25% |
|---|---:|---:|---:|---:|---:|---:|
| Zaif XCP/JPY → USD | 3,326 | 0.0319 | 0.1477 | 0.5826 | 80.9% | 95.1% |
| Zaif XCP/BTC → USD | 1,177 | 0.0779 | 0.2966 | 0.7380 | 56.9% | 83.3% |
| Counterparty XCP/BTC → USD | 604 | 0.1127 | 0.4080 | 1.3723 | 43.2% | 74.0% |

The deeper Zaif JPY market is the strongest attributable corroboration path. Zaif BTC is useful independent evidence
but not an equal substitute. Counterparty DEX remains valuable direct on-chain evidence, while its thin daily prices
are unsuitable as an automatic broad-market override.

Execution count has useful tail information. Single-execution candidates have median error 0.0646, P90 0.3175, and
only 82.1% within 25%. Candidates with at least ten executions improve to median 0.0445, P90 0.1779, and 92.7% within
25%. The 2–9 bucket has a slightly lower median than 10+, but a worse tail. This supports retaining execution count as
a factual diagnostic and treating one-print days cautiously; it does not establish ten as a universal admission
threshold.

Raw XCP-volume buckets are not monotonic. All three medians are between 0.0433 and 0.0480, while P99 is actually highest
in the 1,000+ bucket. Path, era, volatility, and potential reported-volume quality confound the raw totals. A single
global XCP-volume floor would reject useful observations without reliably removing the largest disagreements.

CMC API-era comparisons are materially tighter than the old two-decimal download: median 0.0236 versus 0.0535, P90
0.1052 versus 0.2591, and 98.6% versus 87.7% within 25%. Precision and market era are confounded, so this does not prove
that rounding causes the difference. It does justify retaining `possible_quantization` and source era as explicit
diagnostics.

DEX-active days are more discordant than DEX-inactive days. This is partly mechanical because an active day adds the
noisier Counterparty candidate to the comparison set. It should not be interpreted as the DEX causing CMC or Zaif to
be wrong. It shows why direct attribution and broad price discovery are different dimensions.

Carried ECB observations appear tighter than exact-day conversions, but the result is not causal: carried observations
are almost entirely weekends/holidays on the deeper Zaif JPY path, whereas the exact-day cohort includes the noisier
BTC and Counterparty paths. The four-day ECB bound remains a transparent calendar accommodation, not a quality bonus.

## Tail review

Most extreme dates are thin Counterparty DEX observations, often with one to seven executions. That supports keeping
the DEX as corroboration and bounded fallback rather than allowing one on-chain print to outrank the aggregate.

Thinness does not explain every tail. Zaif XCP/JPY on 2019-05-23 differs sharply from CMC despite 16 executions and
415.3 XCP. Source disagreement therefore cannot be reduced to a minimum-trade rule. Named tail dates should remain
available for later market-era and residual-volume review.

## Decision

Do not change the selected XCP calendar from this report alone. Retain CMC as the broad daily selection, Zaif XCP/JPY
as the preferred attributable corroboration path, Zaif XCP/BTC as secondary corroboration, and Counterparty DEX as
direct but thin evidence and bounded fallback.

The future selection policy should store path, execution count, precision era, age, and disagreement class. It should
not use one scalar quality score or one global XCP-volume threshold. The next task is the descriptive unattributed
reported-volume residual; it may help explain market eras but cannot identify missing venue prices.
