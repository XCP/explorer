# Post-scan Counterparty graph and API-sync plan

## Objective

After the Bitcoin bootstrap reaches its verified endpoint, operate two durable layers:

1. an auditable temporal intelligence graph derived from the complete history; and
2. a lightweight block-by-block Counterparty API v2 ingester that does not require a local Bitcoin or Counterparty node.

The raw ledger remains authoritative. Graph relationships, archetypes, reputation, OTC attribution, and clusters are versioned inferences and must never overwrite observed events.

## Implementation sequence

### 1. Finish and certify the historical bootstrap

Run the compact-index verifier, fee reconciliation, UTXO/recovery reconciliation, and database-size audit. Persist the checkpoint height/hash, source snapshot fingerprint, policy version, and verification receipt. Refresh the OTC census only after this receipt passes.

### 2. Add a durable raw Counterparty event log

Ingest documented API v2 block events into an append-only table containing event index, type, block/hash, transaction hash, parameters JSON, API version, payload hash, fetched time, and orphan status. This permits replay when detectors or projections change.

### 3. Build canonical projections

Materialize address activity, balances, asset supply/holders, trades, orders, dispensers, issuances, fairmints, pools, and block summaries from raw events. Keep current-state projections separate from historical event facts.

### 4. Materialize the temporal graph

Create versioned edges for direct transfers, OTC counterparties, DEX counterparties, dispenser activity, funding, likely migrations, common funding, and repeated counterparties. Each edge records direction, first/last block, counts, values, confidence, evidence, detector version, and invalidation time.

Represent Bitcoin transactions as hyperedges first. Only emit directed payment or control inferences when ambiguity flags and supporting evidence are recorded.

### 5. Add analytical jobs in increasing cost order

Per block: balances, holder changes, trade/OTC candidates, and basic edges. Hourly: affected-address reputation, concentration, and relationship scores. Daily: holder snapshots, retention, dormancy, cluster components, and asset overlap. Weekly or on detector changes: community detection, global cluster review, and historical anomaly scans.

### 6. Expose conservative product views

Asset pages should show holder concentration, active/dormant supply, related assets, accepted/corroborated OTC, and distribution history. Address pages should show balances, activity timeline, archetypes, strongest counterparties, funding evidence, migrations, and OTC/DEX/dispenser history. Network views should show participant cohorts, communities, concentration, and relationship evolution.

All inferred views must display coverage height, method version, confidence, and whether a result is observed, inferred, candidate, rejected, or invalidated.

### 7. Switch to incremental API maintenance

Maintain a cursor containing the last finalized block/hash, event index, upstream Counterparty/Bitcoin heights, and API readiness state. For each next block, verify continuity, store the raw response, normalize events, queue affected entities, update projections, run bounded OTC detection, and commit the cursor atomically.

Keep a 6–12 block reorganization window. On a mismatch, walk back to a common ancestor, mark orphaned raw and derived rows, replay replacement blocks, and rerun affected detectors.

Do not poll every address every block. Ingest the global event stream, then refresh only addresses/assets affected by events or promoted into the tracked population.

### 8. Reconcile the public provider

Daily, compare local height and selected address/asset/balance projections with the primary API. Periodically compare block hashes and selected state with a second provider. If the provider is stale or inconsistent, stop advancing the completeness watermark rather than silently accepting gaps.

## Guardrails

- A single co-spend, round amount, timing match, or shared funder is never proof of common control.
- Exchange batching, CoinJoin-like transactions, PayJoin, service wallets, and change ambiguity remain explicitly flagged.
- Lifetime received BTC is not investment or economic-throughput volume.
- Cluster-adjusted holder counts are supplementary; raw address counts remain available.
- Mempool and one-confirmation events remain provisional and cannot permanently affect balances, reputation, accepted OTC volume, or clusters.
- Every inference is reversible and auditable through evidence and detector version.

## First post-sync deliverables

1. Historical verification receipt and final OTC census.
2. Address/asset relationship tables and top-counterparty reports.
3. BTC funding, balance, and exchange-behavior candidate reports.
4. Holder concentration, retention, overlap, and community snapshots.
5. API v2 block follower with reorg-safe cursor and replayable raw events.
6. Incremental OTC and graph refresh jobs with monitoring and reconciliation metrics.

## Initial bootstrap probe (2026-07-26)

While the scanner was still writing, a read-only probe observed checkpoint **936,823**, about
6.18 million retained relevant Bitcoin transactions, and about 306,000 observed address-stat rows.
The retained transaction range began below the first Counterparty protocol block, which is expected:
the sidecar must retain earlier Bitcoin activity when it touches watched addresses or later becomes
needed for funding/UTXO provenance. These figures are provisional until the writer reaches its final
checkpoint and the integrity verifier passes.

`apps/api/ops/analyze-counterparty-bitcoin-graph.mjs` is the first reproducible analysis tool. It
opens the database read-only and emits coverage, block economics, top observed inflows, strongest
direct relationships, and yearly metrics. It must be run against a stable checkpoint or a copied
database, never while the scanner is mutating the live WAL.
