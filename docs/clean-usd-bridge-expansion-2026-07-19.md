# Clean USD bridge expansion evaluation

## Scope

This evaluation starts from 148,282 completed Counterparty DEX matches for which neither asset is currently classified
`low_quality`. Existing exact-day selected prices and retained USD observations cover 135,153 matches (91.15%), leaving
13,129 uncovered. A missing `asset_signals` row is treated as unflagged, matching the product convention; “clean” is
therefore not an affirmative quality endorsement.

The exercise is non-selecting. It asks how much exact-day coverage is available from known collection currencies
without price carry or recursive alt-to-alt derivation.

## Candidate rule

PEPECASH retains its previously frozen dual-lane rule: eligible dispenser and XCP-derived paths must both exist on the
same UTC day and disagree by no more than 10%.

For the exploratory XCP-path bridges, a day qualifies only when:

1. the bridge/XCP relationship comes from completed on-chain order matches on that UTC day;
2. the selected exact-day XCP/USD calendar is available;
3. at least two executions and two distinct address pairs are present;
4. the maximum and minimum execution-implied USD prices differ by no more than 4x;
5. no price is carried to another day; and
6. the downstream pair was previously uncovered and neither asset is classified low quality.

The 4x dispersion ceiling is a broad catastrophic-outlier screen, not a claim that 4x disagreement is high-quality
price discovery. A production rule should retain the observed range and label this path as derived, thin-market,
execution-day evidence.

## Results

| Bridge | Direct XCP matches | Direct days | Candidate days | New clean matches | Other assets |
| --- | ---: | ---: | ---: | ---: | ---: |
| WILLCOIN | 382 | 143 | 73 | 1,493 | 160 |
| MAFIACASH | 247 | 115 | 41 | 464 | 191 |
| PEPECASH | existing frozen evaluation | existing frozen evaluation | 33 incremental days | 269 | 177 |
| BITCORN | 502 | 235 | 78 | 214 | 93 |
| DANKMEMECASH | 89 | 45 | 15 | 85 | 81 |
| RUSTBITS | 685 | 167 | 102 | 32 | 9 |

One downstream match is reachable through two candidates. The deduplicated result is **2,556 newly reachable clean
matches**, raising exact-day clean coverage from **135,153 / 148,282 (91.15%)** to **137,709 / 148,282 (92.87%)**.
The remaining clean gap would be 10,573 matches.

## Price behavior and outliers

| Bridge | Execution-price median | Observed minimum | Observed maximum | Interpretation |
| --- | ---: | ---: | ---: | --- |
| BITCORN | $0.00519 | $0.000000000789 | $0.20335 | Contains a catastrophic conflicting day |
| WILLCOIN | $5.36 | $0.845 | $110.80 | $110.80 is a single-execution day and is excluded |
| MAFIACASH | $0.0000989 | $0.00000169 | $0.01143 | Wide history; qualifying days still require agreement |
| DANKMEMECASH | $0.000717 | $0.0000389 | $23.04 | $23.04 is plainly disconnected from the central history and excluded |
| RUSTBITS | $0.02899 | $0.000000108 | $0.6858 | Extreme tail exists; qualifying days require agreement |

BITCORN on 2021-09-04 proves why execution count alone is insufficient: two address pairs imply prices differing by
approximately 196 million-fold. That day fails the dispersion rule. BITCORN also loses two other multi-execution days
whose within-day ranges exceed 4x.

## Decisions

- **PEPECASH:** the 269 strict-only matches are the strongest immediate addition because they already passed the frozen
  independent-path agreement rule.
- **WILLCOIN:** highest coverage gain and internally coherent qualifying prices. It is a strong bounded derived-price
  candidate, but still only has one economic path (WILLCOIN/XCP/USD).
- **BITCORN:** useful collection bridge, but must never use a simple activity-count rule. Retain execution dispersion
  and reject the catastrophic day explicitly.
- **MAFIACASH, DANKMEMECASH, and RUSTBITS:** useful second-tier bridges. Their raw tails make robust daily gates and
  provenance especially important.
- **Other isolated pairs:** do not recursively infer prices from one another. The remaining candidate scan drops
  rapidly after these currencies; isolated networks without a USD/XCP/BTC anchor remain null.

## Production gate

Before selecting these rows, materialize the candidate days as non-selecting observations with execution count,
distinct address-pair count, bridge volume, minimum/median/maximum implied price, XCP source, and policy version. Add a
selection tier explicitly below independent aggregate or dual-path evidence. Recompute the row-level census and review
the largest implied USD payments, not merely the largest unit prices.

## Production materialization

The gate was subsequently implemented as `usd-payment-bridge-v1`. The exact-day candidates are retained as derived
Counterparty DEX observations and selected at fidelity 1. The canonical DEX projection now includes a clean alt-to-alt
match only when one payment leg has a selected exact-day price; it does not recurse through unpriced assets.

The analytical “newly reachable” table compares against all retained observations, including non-selected CMC rows.
The public `trades` table previously contained only BTC/XCP-anchored matches, so production materialization adds more
rows than the 2,556 analytical delta:

| Currency | Public DEX trades added | Historical payment USD |
| --- | ---: | ---: |
| PEPECASH | 3,397 | $2,477,740.55 |
| WILLCOIN | 1,493 | $14,299.95 |
| MAFIACASH | 469 | $1,772.86 |
| BITCORN | 213 | $22,158.51 |
| DANKMEMECASH | 85 | $7,797.41 |
| RUSTBITS | 32 | $3,396.10 |
| **Total** | **5,689** | **$2,527,165.38** |

The public DEX ledger is now 118,501 rows with $53,992,795.92 in known historical payment value and zero missing USD
values. The canonical-identity, valuation-divergence, and cursor audit passes exactly.

## Conservative CMC promotion

The reviewed aggregate-source expansion was then materialized under `usd-payment-cmc-bridge-v1`. It preserves every
existing stricter PEPECASH winner, selects exact-day CMC observations for the verified bridge identities, and excludes
25 BITCRYSTALS days whose same-day Zaif/BTC-derived price differs by more than 2x. Those exclusions leave 89
BITCRYSTALS-denominated matches null rather than resolving severe disagreement by source priority.

The promotion adds exactly **45,642** clean canonical DEX trades. The public DEX ledger is now **164,143** rows with
**$59,125,671.89** in known historical payment value and zero missing USD values. The remaining 31,190 completed
matches comprise 20,528 involving at least one low-quality asset and 10,662 clean matches without an admitted path.
The post-write canonical-identity, cursor, missing-calendar, and valuation-divergence audit passes.
