# Canonical compact database

## Outcome

Build one `xcpio-core` database that has logical parity with `xcpio`: the same authoritative Counterparty
data, explorer capabilities, curated facts, and external enrichments, represented in a normalized compact
schema. Public API shapes, absolute offsets, last-page navigation, and domain names remain unchanged.

Compaction changes storage, not scope:

- repeated addresses and asset names become integer dictionary references;
- transaction and match hashes become 32-byte BLOBs;
- UTXOs become `(tx_hash, vout)` rather than repeated strings;
- protocol-native composite identities replace synthetic text ids;
- credits and debits become one direction-tagged provenance relation;
- redundant indexes and columns are removed only when no query or contract requires them.

No compact table may serve reads until the complete database passes data and API parity. Physical splitting is
not assumed. It is considered only if a measured full build cannot remain safely below D1's capacity target.

## Complete source manifest

Every live `xcpio` table belongs to exactly one class. This manifest currently accounts for all 60 tables;
schema coverage tests must fail when a future source table or SQL consumer is not represented.

### Canonical protocol data: compact and preserve

`assets`, `balance_snapshots`, `balances`, `bet_match_resolutions`, `bet_matches`, `bets`, `blocks`,
`broadcasts`, `btcpays`, `burns`, `cancels`, `credits`, `debits`, `destructions`, `dispenser_refills`,
`dispensers`, `dispenses`, `dividends`, `fairminters`, `fairmints`, `issuances`, `order_matches`, `orders`,
`pool_liquidity`, `pool_matches`, `pools`, `rps`, `rps_matches`, `sends`, `sweeps`, `transactions`.

Credits and debits are represented by one compact `ledger_events` table in the final database. Their public
direction, ordering, quantities, calling functions, transaction references, and address history remain
recoverable without compatibility tables.

### Explorer projections and durable local facts: rebuild or preserve

`address_signals`, `asset_feed_counts`, `asset_signals`, `btc_signals`, `curated`, `exchange_top_assets`,
`graph_baseline`, `graph_edges`, `graph_inflow`, `graph_node`, `graph_rank`, `graph_seed`,
`network_stats_snapshot`, `pr_edges`, `prices`, `tags`, `trades`, `xcp_btc_daily`.

Derived projections are rebuilt from compact canonical rows. Curated or independently sourced facts are copied
with exact parity. They remain co-located when API queries require SQL joins with canonical data.

### External enrichments: preserve and continue their independent crawlers

`emblem_listings`, `emblem_sales`, `emblem_scam_sellers`, `emblem_vaults`, `scarce_city_sales`.

### Operational and system data

- `indexer_state`: seed a new checkpoint at the snapshot boundary, then catch up chronologically.
- `cache`: discard and warm after cutover.
- `_cf_KV`, `d1_migrations`, `sqlite_sequence`, `sqlite_stat1`: platform or implementation state; recreate
  through migrations and analysis rather than copying.

## Relationship authority

Counterparty Core v11.2 is authoritative for identities, cardinality, current-state consolidation, and
nullability. The explorer source schema is authoritative for additional fields and durable enrichments the
explorer captures. In particular:

- sends and issuances retain their one-to-many message identities;
- matches use Counterparty's transaction-index pairs and reconstruct public ids at the boundary;
- balances remain one polymorphic address/UTXO relation;
- dispensers are current state keyed by their Counterparty consolidation identity;
- event tables retain globally unique event indexes where Counterparty supplies them;
- exact quantities remain TEXT where they can exceed JavaScript's safe integer range.

## Build procedure

1. **Coverage gate**
   - Extract every live table and column, every table written by event handlers, and every table/column read by
     API queries.
   - Map each to a final table and column or to an explicit derived/disposable rule.
   - Reject unaccounted tables, columns, identities, and SQL consumers in tests.

2. **Complete schema**
   - Define all canonical, projection, curated, and enrichment tables before loading production data.
   - Rehearse migrations locally and verify every uniqueness/nullability assumption against Counterparty source
     and live data.

3. **Local compact build**
   - Use Cloudflare's native D1 SQL export for the canonical source snapshot and stream-import it into local
     SQLite. D1 blocks other requests while producing an export, so run this only in an announced maintenance
     window; the HTTP keyset copier is a non-blocking sizing baseline, not a consistency boundary.
   - Transform locally with `INSERT ... SELECT` into the complete compact schema.
   - Load base rows before secondary indexes, then build and analyze indexes once.
   - Measure the actual complete size, per-table/index size, and projected growth before provisioning the remote
     target. Do not extrapolate from a partial first wave.

4. **Remote bulk load**
   - Apply the compact migrations to a new empty staging D1, then generate data-only SQL chunks from the
     verified local build with `npm run build:core:sql -w xcp-api`.
   - The generator caps statements at 90 KB and files at 256 MB, preserves exact TEXT/BLOB values, emits a
     SHA-256 manifest, and refuses tables without a primary/unique identity or rows that cannot fit D1's
     statement limit. Chunks use convergent upserts and are safe to retry in manifest order.
   - Historical data is loaded in bulk; it is not written through thousands of tiny Worker transactions.
   - Record the source snapshot tip and apply later events with chronological, idempotent upserts.

5. **Parity and operational gates**
   - Compare exact counts, identities, extrema, nullability, quantities, bounded checksums, and decoded samples
     for every canonical table.
   - Compare complete API responses at first, middle, and computed last pages.
   - Assert indexed base-table seeks before dictionary decoding for hot queries.
   - Rehearse retries, interrupted catch-up, reorg rollback, and derived-projection rebuilds.

6. **Shadow and cutover**
   - Shadow production reads and record structural differences without affecting responses.
   - Switch the database binding reversibly only after all gates pass.
   - Preserve `xcpio` through an observation window; retirement is a separate final operation.

## Current state

The existing `xcpio-core` load is incomplete staging evidence and does not define the final schema. Its balance
import was stopped after sustained writes caused D1 CPU resets and briefly affected production reads. No
further historical loading resumes until the complete schema and coverage gates above exist.

The completed compact provenance work remains useful: its unified event shape, codecs, indexes, and parity
checks can be incorporated into the unified build rather than redesigned. It does not require the final
database to be physically split.
