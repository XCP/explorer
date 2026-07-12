# Storage compaction and D1 growth plan

The production `xcpio` database reached 7.66 GB in July 2026. D1 databases have a hard 10 GB
per-database ceiling, so storage work must both reduce repeated values and establish clean horizontal
boundaries. This plan incorporates Counterparty Core's storage-compaction work while preserving this
API's offset/last-page behavior and D1 query characteristics.

## Invariants

- Public hashes, addresses, assets, UTXOs, ordering, counts, and offsets do not change.
- Resolve a string to its integer identity first; filter and paginate an indexed base table next; decode
  only the returned page. Never filter a decoded view.
- Backfills are bounded, resumable, and idempotent. A cursor advances only after every required database
  write succeeds.
- A new store cannot serve reads until exact counts and completed-range aggregates match the old store.
- Old data is retained through a post-cutover observation window. Destructive cleanup is a separate step.
- Reorg rollback covers every physical database before event replay begins.

## Phase 1: compact provenance ledger — deployed and backfilling

Database: `xcpio-ledger`, Worker binding `LEDGER_DB`.

- `credits` and `debits` become one `ledger_events` table with a one-byte direction value.
- Addresses/UTXOs and asset names are interned as integer ids.
- 64-character transaction hashes are stored as 32-byte BLOBs and decoded with `LOWER(HEX(...))`.
- `(address_id, block_index DESC, tx_hash, event_index)` preserves legacy page ordering and makes
  address history an indexed base-table lookup.
- During backfill, forward events dual-write to legacy and compact stores.
- `backfill_active=0` means copying finished; it does not enable reads. `read_cutover=1` is set only after
  exact total-count parity.

Completion gates:

1. Credit and debit cursors both reach the beginning of history.
2. Legacy and compact total counts match.
3. Counts and sums of event/block indexes match on sampled completed ranges.
4. Decoded first, middle, and last offset pages match for busy and ordinary addresses.
5. `EXPLAIN QUERY PLAN` continues to use `idx_ledger_address_page`.
6. Observe compact reads for at least one day with legacy data and dual-write still available.
7. Disable legacy writes, observe again, then remove legacy tables in a separate migration.
8. Verify D1 reports reclaimed storage. If dropped pages are not physically reclaimed by the platform,
   use the Phase 2 blue-green rebuild rather than relying on an in-place file compaction.

## Phase 2: blue-green compact primary

Do not rewrite the 7.66 GB primary in place. Create `xcpio-core-v2`, apply a compact schema, replay the
Counterparty event stream, build derived state, and compare it with `xcpio` while production remains on
the old binding.

First-wave tables, in expected value order:

1. `transactions` (~3.15M): hash TEXT to BLOB; source/destination to address ids.
2. `sends` (~1.77M): use existing `tx_index` instead of duplicated `tx_hash` when the transaction is
   guaranteed to exist; source/destination and asset become ids.
3. `balances` (~1.83M): holder identity and asset become ids; keep exact quantities as TEXT because they
   can exceed JavaScript's safe integer range.
4. `orders` and `issuances` (~560k each): compact hashes, addresses, and asset columns.
5. `order_matches`: replace the 129-character composite id with `(tx0_index, tx1_index)` while rebuilding
   the public id at the boundary.

Values that may point outside the mirrored transaction set remain raw BLOB hashes rather than forced
foreign keys. Small tables are normalized only when their indexes or repeated columns produce measurable
savings.

## Phase 2 query and cutover gates

- Every converted filter has a plan test proving it searches an index on the compact base table.
- Joins/decoding happen after `LIMIT/OFFSET`, except aggregate queries intentionally operating on full sets.
- Legacy and v2 responses are compared at offset 0, middle offsets, and the computed last page.
- Per-table counts, minimum/maximum indexes, aggregate checksums, and selected decoded rows match.
- Reorg, replay, partial-batch retry, and rollback tests cover both database bindings.
- Deploy with old-primary read-through, then shadow comparisons, then a reversible binding switch.

## Phase 3: long-term horizontal boundaries

Keep highly connected analytical tables together; D1 cannot perform cross-database SQL joins. Split only
where request boundaries are already clean:

- provenance history: `xcpio-ledger`;
- compact Counterparty mirror plus derived signals: compact primary;
- large external-chain/raw payload domains: their own D1/R2-backed services;
- immutable cold history, if it eventually outgrows a compact D1: time shards with a directory of shard
  row counts. Cumulative counts preserve absolute offsets and last-page navigation across shards.

The next database is created before the current one reaches 85% of its ceiling. Capacity alerts should
track bytes, bytes per mirrored event, and projected days to the threshold rather than only current size.
