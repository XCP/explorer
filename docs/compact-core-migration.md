# Compact database cutover

This runbook has one outcome: the application `DB` binding points to one normalized, compact, current D1
database with logical parity to the existing source. The recovery database remains separate because it belongs to
a separate indexing domain.

No remaining full-table operation is for sizing or rehearsal. Every copied row must seed the final compact build,
every replayed event must advance its independent cursor, and every verification must guard the production
cutover.

## Reusable seed audit

The existing local staging database is a resumable seed, not a production database. It recorded this starting
frontier before table copying began:

- block: `957878`
- event: `20241585`
- expected tables: `55`

At the audit on 2026-07-13 it contained 20,297,622 copied rows:

- 49 tables complete
- `sends` partial at cursor 3,402,527 with 1,518,036 rows copied
- `sweeps`, `transactions`, `tags`, `trades`, and `xcp_btc_daily` untouched

The source was at event 20,241,754, only 169 events beyond the seed frontier. The source table manifest in
`apps/api/src/indexer/core-manifest.ts` is closed and classifies all 55 staging tables exactly once.

### Seed treatment

- **Compact and reuse (26 complete):** assets, balance snapshots, balances, bets and matches, blocks, broadcasts,
  BTC pays, burns, cancels, destructions, dispenser relations, dividends, fairminter relations, issuances, orders
  and matches, pool relations, and RPS relations.
- **Merge and reuse (complete):** credits and debits become `ledger_events`.
- **Resume, never restart:** sends, sweeps, transactions, tags, trades, and `xcp_btc_daily`.
- **Copy and compact projections:** address/asset signals, feed counts, exchange leaders, graph relations, network
  statistics, PageRank edges, prices, tags, and trades. Their ability to be recomputed later is a repair and
  maintenance property; it is not a reason to throw away usable historical source rows during migration.
- **Preserve:** BTC signals, curated records, Emblem relations, Scarce City sales, and `xcp_btc_daily`.
- **Seed state:** source `indexer_state` supplies operational frontiers; migration-only keys do not become normal
  production state.

If a completed mutable row changed while its table was copied, chronological replay from event 20,241,586
converges it. Balance replay additionally compares each change with the row's `updated_event_index`, so an event
already represented by the copied balance cannot be applied twice.

## Execution pipeline

1. Resume only partial or required untouched inputs: sends, sweeps, transactions, tags, trades, and
   `xcp_btc_daily`.
2. Transform the staging seed into one compact local import artifact. Text hashes become binary, repeated
   addresses/assets become dictionary identities, and credits/debits merge into the ledger.
3. Record `seed_event_index=20241585` and an independent compact `last_event_index=20241585`. An inconsistent
   seed is never marked reconciled merely because its table transforms completed.
4. Apply every Counterparty event after the seed frontier through the compact-only replay path. The replay owns
   its cursor and does not depend on the already-current source indexer cursor.
5. Recompute deterministic projections and refresh preserved provider data.
6. Verify the local artifact: closed schema coverage, relation counts, transaction/event identities, balance and
   supply totals, dictionary integrity, API response parity, last-page navigation, query plans, reorg behavior,
   and allocated size.
7. Create one empty final D1 target, apply the clean schema, and import bounded hash-verified SQL chunks. Import
   receipts resume the same artifact; failure never starts a new database or repopulates completed chunks.
8. Replay the delta accumulated during remote import, then enable forward writes while reads remain on the old
   source.
9. Observe both stores through new blocks and rerun parity checks. Only a reconciled, current target may open the
   read gate.
10. Switch the application `DB` binding once. Retain the old stores for a bounded rollback window, then remove old
    bindings, partial targets, staging tooling, and migration state.

## Readiness contract

Import completion is not cutover readiness. The compact target must independently prove:

- all required seed inputs completed;
- all compact transforms completed;
- seed replay reconciled through the declared source event frontier;
- parity verification passed at that frontier;
- remote import completed from the exact verified manifest;
- forward writes are explicitly enabled and current;
- allocated database size leaves operational headroom below D1's limit.

These are convergent state transitions. Missing or failed evidence keeps reads and writes closed; it never triggers
a delete-and-repopulate cycle.

## Failure policy

- Resume the same table cursor, event cursor, or SQL chunk receipt.
- Repair only the failing table or key range with upserts.
- Never recopy a completed source table merely because another table failed.
- Never call a sizing artifact, partial import, or schema-only target a backfill.
- Report production progress separately from reusable staging progress and verification work.
