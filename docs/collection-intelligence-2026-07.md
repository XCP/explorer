# Collection intelligence

Date: 2026-07-17

Collection profiles are descriptive rollups over canonical collection membership. They deliberately do not produce a
collection score, grade, recommendation, or inferred floor price. The collection page keeps the following independent
axes visible so a user can decide which evidence matters.

## Membership and Rating coverage

- Members are the distinct canonical assets supported by the accepted collection evidence sources.
- Rated members count assets present in the materialized Asset Rating population.
- Rated percentage is rated members divided by all members. It is coverage, not collection quality.
- Median Rating is computed only over rated members.
- The Rating distribution uses the same public ranges as `/ratings`: 9–10, 7–8.9, 4–6.9, and 0–3.9.
- Distribution counts must sum exactly to rated members.

## Market evidence

- Active months sum each member's eligible direct-sale months.
- Paid buyers sum each member's known independent buyers.
- Realized USD sums eligible lifetime direct-sale consideration at trade time.

These fields use the same clean market projection as Asset Rating. The former collection endpoint instead summed each
asset's largest observed sale and labeled that result “realized value”; that was not lifetime realized value and has
been removed.

## Holders and concentration

- Unique holders count distinct current addresses with a positive balance in at least one member.
- Member–holder relationships count positive `(asset, address)` balances across the collection.
- Holder overlap is the share of those relationships beyond each unique holder's first member holding:
  `(relationships - unique holders) / relationships`.
- Top member value share is the largest member's share of the collection's eligible realized USD.
- Issuer count remains visible as a separate provenance/concentration clue.

Holder overlap measures repeat collecting inside the collection. It does not prove common ownership, quality, or
organic demand. Top member value share exposes market concentration rather than penalizing it inside a hidden score.

## Integrity

Assets carrying the reviewed `low_quality` classification are counted explicitly, excluded from numeric Rating, and
surface an integrity warning on the collection profile. Integrity is not averaged away and does not silently alter a
collection score because no collection score exists.

## Verification

The API contract checks that Rating buckets reconcile, rated members never exceed membership, and unique holders never
exceed member–holder relationships. The SQLite query test fixes the definitions for clean realized value, median
Rating, distribution, overlap, concentration, and integrity. The all-collection projection is cached daily; individual
profiles use the same query and cache independently.
