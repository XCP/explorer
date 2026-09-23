# Shared dispenser payment audit

Counterparty repeats a Bitcoin output's full payment on every asset dispensed by
that output. It is raw protocol evidence, not each asset's sale value. The
September 16, 2026 Pokémon transaction released 151 assets for 0.02 BTC; summing
its repeated rows incorrectly produces 3.02 BTC.

## Allocation

Allocate across the complete transaction before filtering by asset or address.
Core emits outputs in order and asset names lexically within an output. An asset
order restart or changed seller, buyer, or payment starts the next output.
Repeated identical outputs remain separate. Weight each asset by its dispensed
quantity times the dispenser rate divided by its vend quantity, and cap the
group total at the actual payment. Excess overpayment is excluded. Missing or
oracle-priced metadata uses the payment as a fallback weight. These are estimated
asset allocations; fractional satoshis do not represent additional chain payments.

## Audited applications

- **Explorer:** migration 0099 repairs every stored dispense, asset monetary
  signal and address monetary signal. Live ingestion reallocates full transactions
  across event-page boundaries. Receipts, asset/address feeds, dispenser totals,
  price observations and candles consume allocations. The main bundle trade ledger
  already counted the Pokémon payment once; its totals now also exclude overpayment
  and correctly handle repeated-output fallback records. Historical USD values and
  dependent ratings are rebuilt using the operational repair below.
- **Exchange:** PR 25 and migration 0052 already repaired allocations, historical
  volume, candles, stats and the DefiLlama feed. The September 16 feed is
  0.08659777 BTC rather than 3.11351725 BTC. Documentation now references
  `quote_volume` rather than raw `btc_amount`.
- **Marketplace:** checkout, acceptance, authorization and settlement paths store
  each listing/offer's own `price_sats` in `fills`. Collection volume sums those
  per-item fills; `(txid,ref_id)` prevents replay duplicates. Multiple legitimate
  fills in a transaction remain separate. No dispenser-payment history is imported
  into these totals; no historical rewrite is needed.
- **Launchpad:** trading history and volume come from individual book/pool matches
  and their daily XCP candles. Match/event identity preserves legitimate multiple
  fills without summing per-address buy/sell projections. Dispensers are offer
  quotes and purchase routes, not inputs to historical trading-volume totals.
  No corresponding historical rewrite is needed.

## Historical repair

From `apps/api`, inspect pending migrations, then apply migration 0099 before
deploying the updated Worker. Compile the operational imports with `npm test`.
Run `node ops/repair-dispense-accounting.mjs` to inspect the plan, then append
`--apply` to rebuild historical payment trades, legs, XCP/BTC observations,
XCP/USD prices, trade USD values, monetary signals and rankings. It reuses the
existing BTC/USD calendar and shipping SQL; raw chain records remain unchanged.
The script is repeatable, takes the canonical maintenance lease, retries transient
D1 overloads, expires response caches for background refresh, and verifies no unallocated
rows, overallocated payments or stale priced trade values remain. Maintenance
also recovers rows written by the previous Worker during the deployment gap.

Regression coverage includes 151-asset bundles, repeated identical outputs,
overpayment, missing metadata, event-page boundaries, migration repair and a
browser receipt test. Marketplace collection-volume/fill/checkout and Launchpad
trade-history/dispenser-quote tests cover the audited adjacent paths.
