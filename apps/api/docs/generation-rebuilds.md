# Generation-safe derived rebuilds

The repository does not use delete-first refreshes for published provider data. Tokenscan, pepe.wtf,
issuer collections, Emblem listings, and scam-seller rollups validate or derive the fresh set, upsert it, and
only then reconcile stale owned rows.

Three large derived models remain candidates for generation-aware storage. Their current rebuild mechanics
must not be expanded or copied without first proving that a generation switch improves correctness or availability.

## Graph model

`graph_edges` is directly readable by graph endpoints and holder-cohesion jobs, while `graph_node`,
`graph_rank`, `graph_seed`, and `graph_inflow` support its calculation. Add a build generation to the graph
tables, populate a new generation without touching the active one, validate node/edge/rank invariants, then
switch one active-generation state value. Retire the old generation in bounded cleanup batches afterward.

## Computed tags

Global computed-tag rebuilds currently replace one tag rule at a time in a D1 batch. Although the batch is
transactional, the desired shape is generation-safe: write the next computed generation, validate counts per
rule, switch the active computed generation, then prune the old rows. Curated, protocol, manual, issuer, and
provider-owned tags remain non-generational and use ownership-scoped reconciliation.

## Daily XCP/BTC projection

Build the next `xcp_btc_daily` dataset in a staging table or generation, validate day coverage and finite positive
rates, then switch it into service. This avoids both an empty interval and a second full scan of order matches.

## Cutover rules

Each cutover must preserve the existing public table names, avoid version suffixes, include rollback to the
prior generation, and prove parity before old-generation cleanup begins.
