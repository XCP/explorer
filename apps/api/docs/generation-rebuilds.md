# Generation-safe derived rebuilds

The repository does not use delete-first refreshes for published provider data. Tokenscan, pepe.wtf,
issuer collections, Emblem listings, and scam-seller rollups validate or derive the fresh set, upsert it, and
only then reconcile stale owned rows.

Three large derived models remain candidates for generation-aware storage. Their current rebuild mechanics
must not be expanded or copied without first proving that a generation switch improves correctness or availability.

## Graph model

`graph_edges` is directly readable by graph endpoints and holder-cohesion jobs; `graph_seed` stages the
teleport vectors (graph-eval reads it for the held-out split). The power iteration itself runs in Worker
memory (migration 0082 retired `graph_node`, `graph_rank`, and `graph_inflow` — the SQL passes billed
~200M D1 row writes per rebuild). Edge rebuilds are generation-isolated: a new generation populates
without touching the active one, the score pass publishes it by switching `graph_generation`, and the
next rebuild's reset op retires everything older than the active generation.

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
