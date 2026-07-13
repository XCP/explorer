# Canonical core finalization

## Outcome

Build `xcpio-core` as the compact canonical Counterparty mirror, prove it equivalent to `xcpio`, move the
co-located derived projections that require mirror joins, cut over reversibly, and retire superseded storage
only after an observation window. Public API shapes, absolute offsets, last-page navigation, and domain names
remain unchanged.

The current `xcpio-ledger` deployment solved credit/debit provenance only. It did not replace the broader
mirror. As of 2026-07-13, `xcpio` is 7,727,796,224 bytes with 20,241,344 events indexed. The first compact-core
wave covers 8,094,052 rows across transactions, sends, balances, orders, order matches, and issuances, plus
blocks, assets, and balance snapshots required for a functioning and rollback-safe mirror.

## Source findings and decisions

- Counterparty Core remains the relationship authority. Its compact storage work interns addresses/assets,
  stores hashes as BLOBs, splits UTXOs into hash/vout, and keeps balances polymorphic. Our schema follows those
  semantics while preserving fields our API actually captures.
- Sends and issuances are one-to-many per transaction. Their canonical identities are `(tx_index,msg_index)`;
  `event_index` remains the replay idempotency key.
- Order matches use `(tx0_index,tx1_index)` internally and reconstruct the public hash-pair id at the boundary.
- Balances and balance snapshots represent exactly one of an address or UTXO holder. Quantities remain TEXT to
  preserve integer precision beyond JavaScript's safe range.
- Dictionary resolution precedes filtering. Decoding joins happen only after a limited page is selected.
- The current indexer always stores transaction `data` as null, so the canonical table does not spend storage
  on that column; the wire boundary can continue returning null where the contract requires it.
- Derived tables cannot be separated casually: current signals SQL joins raw balances, sends, transactions,
  orders, issuances, dispensers, and order matches in-process. Compact mirror and those derived projections must
  end up in the same D1, or a persisted projection must replace each cross-database join before cutover.

## Execution plan

1. **Canonical schema and capacity proof**
   - Apply `migrations-core/0001_core.sql` to an isolated `xcpio-core` database.
   - Load representative and then full first-wave data with bounded, resumable upserts.
   - Measure total bytes, bytes per row, dictionary cardinality, index sizes, and query plans.
   - Gate: estimated steady-state size plus two years of growth stays below the 8.5 GB provisioning threshold.

2. **Deterministic importer**
   - Maintain per-table high-water cursors in `core_state`; advance a cursor only after its batch commits.
   - Seed dictionaries before dependent rows. Normalize legacy null issuance message indexes to zero only after
     collision checks, and reject malformed hashes/UTXOs rather than silently coercing them.
   - Use `INSERT ... ON CONFLICT DO UPDATE`; never delete-and-replace. Re-running a page must be a no-op.
   - Backfill immutable history independently; rebuild current-state assets/balances chronologically or from an
     audited snapshot followed by event catch-up.

3. **Forward synchronization and reorg safety**
   - Dual-write new events to both databases using the same parsed event context.
   - Roll back every physical database to the same block before replay. Add crash tests between primary and core
     writes; cursors make retries converge even though D1 cannot transact across bindings.
   - Gate: both stores remain at the same block/event tips through forced retry and reorg rehearsals.

4. **Parity system**
   - Compare counts, PK extrema, nullability, bounded checksums, and domain invariants per table.
   - Compare decoded API results at first, middle, and computed last pages for quiet and high-volume entities.
   - Assert every hot route uses an indexed compact-base seek before dictionary decoding.
   - Record failures durably; audit endpoints are read-only and cannot enable cutover.

5. **Derived projection relocation**
   - Inventory every same-D1 mirror/derived join and port the needed derived tables/builders into `xcpio-core`.
   - Rebuild and compare signals, tags, trades, prices, feed counts, and network snapshots by domain.
   - Keep external independently rebuildable domains (recovery and raw external-chain data) outside core.

6. **Shadow, cutover, and retirement**
   - Enable sampled shadow reads and log structural mismatches without affecting responses.
   - After clean shadow operation, switch the Worker binding/read gate reversibly; preserve the old database and
     dual writes through the observation window.
   - Stop old writes only after rollback drills. Dropping old tables is a final, separately approved operation.

## Immediate work queue

1. Apply and rehearse the canonical migration on local SQLite and remote `xcpio-core`.
2. Build typed codecs for hashes, UTXO holders, dictionary ids, and decoded DTO boundaries.
3. Implement the importer for dictionaries, blocks, and immutable transactions first.
4. Add per-table readiness reports and response parity fixtures.
5. Extend import in dependency order: assets/issuances, sends, orders/matches, balances/snapshots.
6. Complete the mirror-to-derived join inventory before selecting the production cutover unit.

For an operator-driven transaction catch-up, run one remote Worker process and one importer process from
`apps/api`. The importer reads `ADMIN_TOKEN` from the gitignored `.dev.vars`, logs only progress, and retries
transient failures without advancing the destination cursor:

```sh
wrangler dev --remote --port 8790
node ops/run-core-backfill.mjs
```
