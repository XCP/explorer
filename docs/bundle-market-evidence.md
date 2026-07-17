# Bundle market evidence

## Contract

A bundle sale is a real economic event, but it is not an observed price for each asset inside it. The ledger stores
the payment once in `trades` and stores constituent assets in `trade_legs`. Aggregations must conserve value: one
bundle payment may contribute its full value once, never once per leg.

## Safe evidence by scope

- Network, venue, buyer, and seller: count the complete payment and transaction once.
- Asset: count participation, distinct independent bundle buyers, active months, and venues through its legs.
- Collection: count member participation. Attribute complete value only when every leg has the same canonical
  collection; otherwise retain the event as mixed-collection bundle value.
- Per-asset Rating: direct single-asset realized value remains separate. Bundle participation is a challenger input,
  not a synthetic price.

Equal splits, quantity-weighted splits, and duplicating the full payment across legs are rejected. Asset quantities
are not comparable across unrelated assets; equal splits invent prices; full duplication violates value
conservation. A prior-price-weighted allocation could be studied later, but it is circular for thinly traded assets
and should remain an offline sensitivity analysis.

## Venue state

- Dispensers: bundle payments and legs are canonical. Production currently has 7,040 bundle payments worth about
  $2.42 million and 206,932 total dispenser legs across single and bundled payments.
- Emblem: 2,786 bundle sales worth about $27.70 million are canonical at the sale level. Their Counterparty asset
  legs are not yet materialized.

## Emblem normalization

Materialize the set of Counterparty assets funded into each multi-asset vault. A bundle sale is eligible for asset
participation only when it predates the vault's first outbound send or sweep (`cracked_at`). Sales after that point
remain historical marketplace events but do not assert that the originally funded bundle was still present.

The backfill must verify:

1. every eligible Emblem bundle sale has at least two distinct asset legs;
2. no cracked/post-crack bundle contributes asset participation;
3. sum of bundle-level USD remains unchanged before and after leg materialization;
4. joining legs never multiplies value in network, collection, or asset aggregates;
5. replaying the same source data produces identical legs.
