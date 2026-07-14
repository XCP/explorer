# API data architecture

The production API has two databases with independent domain ownership:

- `CORE_DB` (`xcpio-core`) is the canonical normalized Counterparty mirror and every explorer-owned
  projection derived from it.
- `RECOVERY_DB` (`xcpio-btc`) stores Bitcoin bare-multisig recovery data. It remains separate because its
  source, lifecycle, and public workflow are independent of the Counterparty mirror.

There is no source-mirror fallback, read adapter, dual writer, or versioned database path.

## Canonical Counterparty store

`CORE_DB` interns repeated assets and addresses in `asset_dictionary` and `address_dictionary`. Transaction
hashes are stored as 32-byte values. Public query modules resolve an external name to its integer identity,
filter and paginate indexed base tables, then decode hashes and names at the response boundary.

Balances remain polymorphic in one table. Address balances use `address_id`; UTXO balances use
`utxo_tx_hash` and `utxo_vout`. This preserves Counterparty's relationship model while allowing aggregate
supply to remain one sum over one relation.

`ledger_events` contains credit and debit provenance with a direction flag. It lives in `CORE_DB`, is written
by the same replay transaction flow, and serves address ledger history through an address-first index.

## Event replay

`indexer/sync.ts` walks Counterparty's global event stream chronologically. Each event is dispatched once;
only normalized canonical statements are committed. The replay cursor advances after every required write succeeds.
All event writes are idempotent, so an interrupted page is safe to repeat.

A D1 lock serializes cron and manual replay. Near the chain tip, the worker compares its checkpoint block hash
with Counterparty. A mismatch removes the orphan branch, restores affected balances from retained snapshots,
rewinds the event cursor, and replays the replacement branch.

## Derived projections

Explorer features live beside the canonical mirror and are rebuildable from it:

- `asset_signals` and `address_signals` are maintained by convergent upserts. Event-touched
  identities refresh immediately; bounded cursor passes repair the whole population.
- `tags` is a polymorphic categorical projection over canonical entity identities. Protocol and issuer facts
  are written during ingest; computed behavior receives a periodic full self-heal.
- `trades`, graph relations, collection metadata, prices, Emblem data, BTC summaries, and feed counts each
  have one owning builder and one normalized storage shape.

Scoring remains a pure read-time policy over signal rows. Weight changes do not rewrite stored history.

## Read and extension APIs

Public `/v2` handlers use domain query modules and `CORE_DB` exclusively. D1 read sessions may select a nearby
replica; the API's existing cache headers tolerate bounded replication staleness.

The wallet extension's stable `/api/v1` URLs are implemented in `extension-api.ts`. Asset responses are read
from the same normalized store. Consolidation requests retain their public contract and proxy to the dedicated
Bitcoin consolidation service; swap data comes from XCPDEX.

## Schema changes and verification

All canonical schema changes are numbered migrations in `migrations-core/`; recovery changes use
`migrations-recovery/`. Migration-backed SQLite tests exercise normalized queries, event replay, rollback,
signals, and extension contracts. Deployment runs live wire-contract checks against production after Wrangler
publishes the Worker.
