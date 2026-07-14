# Compact database completion plan

## End state

`xcpio-core` is the explorer database. It contains normalized Counterparty protocol data (including unified
credit/debit provenance in `ledger_events`), explorer-owned projections, curated facts, and external enrichments.
Runtime code uses `CORE_DB` for all of those relations. Only the separately scoped Bitcoin recovery database
remains a separate product; `LEDGER_DB` is transition machinery and must be retired.

Completion means all of the following are true:

- public explorer reads use only `CORE_DB`;
- the Counterparty event consumer writes only `CORE_DB`;
- every derived relation has one runtime owner and one state cursor in `core_state`;
- no runtime branch selects a database based on readiness, version, or environment flags;
- no background job copies a relation from the old database into `CORE_DB`;
- no runtime path reads or writes `LEDGER_DB` after its rows and readiness checks are absorbed by `CORE_DB`;
- import, parity, snapshot, and cutover endpoints are absent from the deployed Worker;
- the old database binding is absent from `Env` and `wrangler.toml`;
- the old database is retained only for a time-bounded rollback checkpoint, then deleted.

Compaction changes representation, not data scope. Address and asset strings use dictionary identities, hashes
use binary storage, protocol composite identities replace synthetic strings, balances remain polymorphic across
addresses and UTXOs, and credits/debits share `ledger_events` with an explicit direction.

## Runtime ownership

| Relations | Final writer | Inputs | Current blocker |
|---|---|---|---|
| blocks, transactions, balances, balance_snapshots, sends, assets, issuances, orders, order_matches | compact event sync | Counterparty events | old mirror is still written for downstream jobs |
| dispensers, dispenses, refills, burns, destructions, dividends, sweeps, bets, RPS, pools, fairminters, fairmints, broadcasts, cancels, btcpays | compact event sync | Counterparty events | same |
| ledger_events | compact event sync | CREDIT/DEBIT events | absorb the separate ledger frontier and retire `LEDGER_DB` |
| emblem_vaults, emblem_sales, emblem_listings | corresponding Emblem crawler | validated provider responses | crawlers still store their canonical rows in the old database |
| scarce_city_sales | Scarce City crawler | validated provider response | crawler still scans/writes the old database |
| trades | unified trade builder | compact protocol rows plus compact external sales | its external inputs still live in the old database |
| prices, xcp_btc_daily | price job | Coinbase candles and compact order matches | pricing change must land after its schema and compact trade owner |
| address_signals, asset_signals, asset_feed_counts | signal builders | compact protocol, trades, vaults | builders still query the old schema |
| tags | tag owner for each source | compact signals/assets plus external directories | computed tag builder remains on the old schema; collection/issuer writers are already compact |
| exchange_top_assets | exchange leaderboard job | compact sends and address signals | complete in code |
| graph_edges, graph_node, graph_rank, graph_seed, graph_inflow | graph job | compact protocol/projections | generation 1 must publish and pass validation |
| emblem_scam_sellers, btc_signals | scam/recovery builders | compact vault and Bitcoin data | upstream vault jobs must move first |
| network_stats_snapshot, daily_metrics, emblem_stats, cache | compact maintenance jobs | compact relations | verify every refresh path uses `CORE_DB` |
| curated | admin curated writer | operator input | admin write must become one compact write |

`entity_dictionary`, `address_dictionary`, and `asset_dictionary` are identities maintained by compact writers,
not independently copied projections.

## Dependency-ordered execution

### 1. Publish and validate the compact read surface

1. Allow graph generation 1 to finish without deploying graph reads against generation 0.
2. Validate node/edge/rank counts, signal publication, graph cuts, and representative graph responses.
3. Apply pending compact migrations and deploy the already-converted public read surface.
4. Run all wire-contract checks plus first, middle, and computed-last-page checks.
5. Capture D1 query duration, rows read/written, and query plans for the hot routes.

Gate: every public explorer route succeeds from `CORE_DB`; graph generation is nonzero; no public explorer
handler references the old binding.

### 2. Move independent external inputs

Convert the Emblem and Scarce City crawlers as complete vertical slices: provider validation, dictionary
resolution, upsert/reconciliation, cursor state, admin trigger, cron trigger, and tests all move together.
Do not retain a second write or projection-copy step.

Implementation commits may prepare producers and consumers separately, but deployment is atomic across the
dependency cut: no compact-only producer deploys while a live consumer still reads its old table, and no
compact-only consumer deploys before its compact input is current. This is enforced by the deployment checklist,
not by dual writes or runtime database switches.

Order: vault enumeration/resolution -> sales/transfers/listings -> vault metadata/classification/scam attribution
-> Scarce City sales.

Gate: crawler-owned target counts and cursors advance in `CORE_DB`, replay is idempotent, and the old enrichment
tables receive no writes.

### 3. Move unified market data

1. Build `trades` directly from compact DEX, dispense, Emblem, and Scarce City relations.
2. Preserve `(venue, ref)` identity and reconcile changed classification without delete-first publication.
3. Remove the scheduled `reconcileCoreTrades` copier and its admin projection route.
4. Land the price-fidelity schema and compact-only pricing job.
5. Reconcile trade USD values so an expired derived price clears an old valuation.

Gate: venue counts, identities, totals, USD coverage, and sampled rows match the accepted source semantics; price
provenance and observation dates are populated; no market-data copier remains.

### 4. Move deterministic projections

Convert supply, signals, holder cohesion, computed tags, exchange/scam attribution, and aggregate snapshots in
dependency order. Each conversion includes its cursor/generation in `core_state`, full/scoped convergence tests,
and an indexed query-plan test for heavy SQL.

Gate: full rebuild and dirty-scoped rebuild converge; graph and reputation validation gates pass; every projection
has exactly one writer.

### 5. Make compact event sync the sole protocol writer

1. Confirm no crawler or projection reads protocol tables from the old database.
2. Move pause/lock/checkpoint/rollback state to `core_state`.
3. Remove old event statements and the old balance/supply queues.
4. Confirm compact `ledger_events` is complete/current, move its readiness checks into the core audit, and remove
   the separate ledger binding and backfill job.
5. Exercise interrupted replay, duplicate delivery, reorg rollback, and genesis recovery tests.
6. Observe at least one new block and compare Counterparty frontier, hashes, balances, and representative protocol
records.

Gate: the old protocol tables receive no writes and compact sync stays current through a real block.

### 6. Remove transition machinery

Delete, rather than disable:

- core snapshot/export and projection-reconciliation admin routes;
- compact readiness flags and parity branches used only for cutover;
- local/remote import drivers and chunk receipts after archiving the final manifest outside runtime source;
- old read modules and database-selection helpers;
- old binding declarations and migration directories no longer used by a fresh deployment;
- comments and names describing old/new, legacy, compatibility, or pre/post-compaction behavior.

Generate one clean baseline schema for a fresh `xcpio-core` database while retaining only forward operational
migrations that production still needs.

Gate: a repository search finds no runtime old-database reference, and a fresh database created from the retained
schema passes the complete test suite.

## Pricing decision

The accepted pricing direction is data provenance rather than false continuity:

- Coinbase BTC/USD and ETH/USD candles are direct observations;
- XCP/BTC uses a daily volume-weighted median of completed DEX matches;
- derived XCP/USD carries for at most seven calendar days, then becomes absent;
- `observed_day`, `source`, and `fidelity` distinguish direct and derived prices;
- a higher-fidelity imported market observation cannot be overwritten by a derived value;
- trade reconciliation clears values whose admitted price has expired.

The initial seven-day horizon is supported by the production distribution: 618 XCP/BTC trading days,
mean inter-trade-day gap 7.3 days, 520 of 617 gaps at or below seven days, and a maximum gap of 638 days.
The horizon is an explicit admission rule, not a claim that a seven-day-old print is current. Historic CMC/Zaif
imports remain a separate acquisition task and must enter through the same fidelity contract.

## Verification and rollback

Every phase records before/after counts, cursor/frontier, representative identities, query metrics, and its exact
commit/deployment. Failures repair the affected key range with convergent upserts. They never create another
database generation or restart completed imports.

The old database remains unchanged during the rollback window. Rollback may switch deployment bindings, but no
new compatibility branch is added to application code. Retirement occurs only after the compact database remains
current and healthy throughout the agreed observation window.
