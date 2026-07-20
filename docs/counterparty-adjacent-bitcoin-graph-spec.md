# Counterparty-adjacent Bitcoin graph specification

## Purpose

Build the missing Bitcoin-side evidence layer for Counterparty without pretending to have a complete
general-purpose Bitcoin identity graph. The system should answer exact ledger questions exactly,
surface useful behavioral patterns conservatively, and make every attribution or reputation claim
auditable and reversible.

This specification separates what the blockchain proves, what the graph derives, and what an analyst
may reasonably infer. Those layers must remain distinct in storage, APIs, and presentation.

## Questions the system should answer

### Bitcoin use by Counterparty

- What share of Bitcoin blocks, transactions, serialized bytes, weight, and miner fees is attributable
  to known Counterparty protocol transactions, by block or time interval?
- What is the complete Bitcoin transaction history and current BTC balance of each watched
  Counterparty address at the indexed tip?
- How much BTC entered and left Counterparty-associated addresses over time?

### Counterparties and services

- Which Bitcoin addresses directly participate in transactions with Counterparty addresses?
- Which external nodes behave like exchange deposit, consolidation, hot-wallet, withdrawal, payment
  processor, marketplace, faucet, or other service infrastructure?
- Which candidate clusters can be named from independent evidence, and which must remain unnamed?

### Control, funding, and behavior

- Which Counterparty addresses share strong funding ancestry or later consolidation?
- Which addresses may be under common control, and what alternative explanations exist?
- Which asset purchases or dispenser fills have seller-linked funding, circular proceeds, common
  funders, or other wash-risk signals?
- Which addresses connect to already documented scammers or abusive operators?
- Which Bitcoin-side clusters connect to independently evidenced Ethereum-side identities?

## Non-goals

- Indexing every Bitcoin address or every unrelated Bitcoin transaction.
- Treating transaction co-participation as proof of payment or common control.
- Assigning a complete balance to an external address whose full history was not scanned.
- Automatically naming an exchange from behavioral similarity alone.
- Automatically declaring Sybil behavior, wash trading, fraud, or ownership from one heuristic.
- Publishing sensitive identity claims without evidence, provenance, and review.

## Scope boundary

The initial graph contains every Bitcoin transaction satisfying either condition:

1. at least one input or output belongs to the frozen watched Counterparty address set; or
2. its transaction hash occurs in the authoritative Counterparty protocol transaction set.

For every included transaction, retain all inputs and outputs, not merely the watched ones. Standard
Bitcoin addresses become graph nodes. Nonstandard or undecodable scripts are represented by a script
type and SHA-256 fingerprint. Transactions outside this relevance boundary are not retained.

This is a **one-hop event graph**, not a recursively expanded address graph. An external address does
not cause all of its unrelated transactions to enter the database. Full-history promotion is a
separate, explicit operation.

## Evidence layers

### Layer 1: observed facts

These are direct consequences of the canonical Bitcoin ledger:

- block hash, height, time, size, weight, transaction count, subsidy, fees, and coinbase outputs;
- transaction hash, position, size, weight, fee, inputs, outputs, values, and script identifiers;
- whether a transaction hash is present in the authoritative Counterparty transaction set;
- whether an address is present in the frozen Counterparty watch set;
- an output's spent/unspent state at the indexed tip;
- exact BTC balance of a watched address when coverage begins at genesis and reaches the stated tip.

Observed data must never contain inferred owners, payer/payee direction, exchange names, misconduct
labels, or confidence scores.

### Layer 2: derived signals

These are reproducible calculations over observed events:

- co-input/co-spend events;
- common direct funders and funding ancestry;
- fan-in, fan-out, consolidation, batching, and peeling-chain structure;
- repeated values, round values, timing similarity, and synchronized activation;
- return flows and bounded transaction cycles;
- graph degree, centrality, components, communities, and bridges;
- CoinJoin-like, PayJoin-like, batching, self-transfer, and change-candidate flags;
- seller-linked funding and proceeds-return signals around known market events.

Each derived signal records its method name, version, parameters, evidence event identifiers, and
coverage tip. Signals are recalculable and are not identity claims.

### Layer 3: attribution and reputation assertions

These are claims such as “likely common control,” “exchange-behavior candidate,” “attributed to
Binance,” or “wash-risk elevated.” Every assertion requires:

- assertion type and exact subject(s);
- calibrated confidence, never an unexplained score;
- supporting signals and direct evidence;
- contradictory evidence and applicable heuristic exclusions;
- method/version and analyst or source provenance;
- creation and review timestamps;
- status: candidate, reviewed, accepted, disputed, or withdrawn;
- a human-readable rationale.

Assertions never merge or overwrite ledger nodes. Withdrawal must preserve an audit trail.

## Graph model

### Nodes

- `watched_address`: an address in the frozen Counterparty-derived watch set;
- `external_address`: a standard Bitcoin address observed only within a relevant transaction;
- `unknown_script`: a nonstandard or undecodable output/input script fingerprint;
- `transaction`: the canonical event joining all input and output participants;
- optional analytical `cluster`: a versioned grouping assertion, not a replacement address identity;
- optional `entity`: a sourced real-world operator label attached to one or more nodes/clusters.

### Edges and hyperedges

The transaction is the authoritative hyperedge. Input participation means an address-controlled UTXO
was consumed; output participation means the transaction created a UTXO for a script/address. It does
not prove that every input owner paid every output owner.

Convenience payer-to-payee edges may be derived only with ambiguity metadata:

- number of candidate input controllers;
- number of candidate output recipients;
- possible change/self outputs;
- CoinJoin/PayJoin-like structure;
- service or exchange batching likelihood;
- attribution method and confidence.

Raw APIs should expose the hyperedge even when a simplified edge is available.

## Coverage and balance semantics

Every address-level result carries a coverage descriptor:

- `full_from_genesis`: complete scan from block 0 through the stated canonical tip;
- `full_from_height`: complete only after a stated promotion/start height;
- `adjacent_only`: only appearances inside Counterparty-relevant transactions are known;
- `unknown`: coverage cannot be established.

For `full_from_genesis`, current balance is the sum of unspent outputs and historical balance is the
running output-minus-spend total. For `adjacent_only`, show observed inflow/outflow but never label the
result as the address's Bitcoin balance.

Balances must state block height/hash and confirmation policy. Mempool balances are separate and
ephemeral. Reorg rollback must restore both spent state and aggregates.

## Analytical methods and safeguards

### Common-input control

Co-spending inputs is evidence compatible with common control, not proof. Suppress or sharply
downgrade the inference for CoinJoin-like equal-output patterns, PayJoin-like transactions, known
collaborative protocols, exchange batching, and other multi-party constructions. Require repetition
or independent corroboration for an ownership assertion.

### Change detection

Change is always heuristic unless the same script/address evidence makes it explicit. Candidate
signals may include address novelty, script-type continuity, value structure, and later spending
behavior. Never discard alternative candidates from the observed graph.

### Exchange/service candidates

Behavioral features include deposit fan-in, periodic consolidation, high sender/recipient diversity,
batched withdrawals, hot/cold movement, uptime, and repeated service-like transaction templates.
These justify a service/exchange-behavior candidate. Naming Coinbase, Binance, Bittrex, Poloniex, or
another operator requires independent sourced evidence, a known-address intersection, a documented
deposit test, or equivalent corroboration.

### Sybil candidates

Useful signals include common funding source/ancestry, equal-value fan-out, synchronized first use,
shared consolidation, repeated behavioral templates, and coordinated asset activity. Custodial
withdrawals, faucets, marketplaces, and airdrops are strong alternative explanations. “Shared funder”
must remain available as a neutral result even when a Sybil interpretation is rejected.

### Wash-risk around market events

Join the Bitcoin graph to known dispenser, DEX, auction, OTC, and marketplace events. Signals include
seller-to-buyer prefunding, shared control/funding clusters, proceeds returning to the buyer/funder,
repeated cycles, and nominally distinct buyers with common ancestry. Market-event identity, amount,
time window, and price evidence must be recorded. The output is a risk signal, not a definitive wash
trade label without stronger evidence.

### Scam/reputation links

Direct transfers and repeated strong cluster evidence may connect addresses to a known scam entity,
but mere receipt from or payment to a scammer does not transfer reputation. Distinguish customer,
victim, service, counterparty, and likely common-control hypotheses. Negative assertions require
manual review or multiple independent high-specificity signals.

## Proposed storage layers

### Integration with existing databases

Production should retain two domain databases, not introduce a third:

- `xcpio-core` remains the canonical Counterparty protocol database. Its `blocks` and `transactions`
  rows describe Counterparty's parsed block/event universe and remain the source for protocol
  transaction identity, source/destination, BTC amount, and Counterparty fee fields.
- `xcpio-btc` becomes the single Bitcoin sidecar database. It already owns bare-multisig recovery and
  should also own Bitcoin block metrics, followed-address coverage, balances, bounded flows, scan
  receipts/state, and Bitcoin-derived evidence.

The local `counterparty-bitcoin.sqlite` file is the full-fidelity one-time bootstrap and analytical
build artifact. It is not another production source of truth. Its validated bounded derivatives are
exported idempotently to `xcpio-btc`; the cloud database remains maintainable without the desktop.

Do not duplicate the Counterparty `blocks` and `transactions` tables wholesale into `xcpio-btc`.
Bitcoin-side rows reference the shared block height/hash and transaction hash identities. The Worker
can stitch point results from `CORE_DB` and `RECOVERY_DB` in parallel where a product response needs
both domains. Local analytical jobs may attach/export both SQLite snapshots for bulk joins.

Bare-multisig recovery is output-specific and often one-to-many per transaction. Model it as an
extension relation keyed by `(txid, vout)` rather than nullable recovery columns on every Bitcoin
transaction. This produces one Bitcoin database with normalized special-purpose tables:

- a general relevant-transaction/event layer;
- `recovery_outputs` for classifier and spent-state fields applicable only to special outputs;
- `recovery_attempts` and input relations for user recovery workflow state;
- optional R2 transaction hex objects for trust-minimized legacy signing.

This avoids two competing Bitcoin databases while also avoiding a very wide sparse transaction table.
The per-block decoder should feed both the ordinary followed-address projections and the recovery
classifier, so block acquisition, canonicality, retry, and cursor logic are shared once.

### Bootstrap and maintenance sources

The archival local Core node is a bootstrap accelerator and validation authority for the one-time full
scan. It must not be a permanent production dependency. After bootstrap:

- fetch each confirmed new block once from a hosted RPC that supplies verbosity-3 transactions with
  prevouts (the already verified Sandshrew endpoint is the primary candidate);
- process with a configurable confirmation lag and persist canonical block hash/cursor receipts;
- derive block metrics, followed-address flows/balances, Counterparty fees, and recovery outputs in one
  decoder pass;
- submit bounded idempotent batches to `xcpio-btc`;
- detect gaps and reorgs from stored height/hash checkpoints, rewind the affected bounded branch, and
  replay;
- retain alternate public/Counterparty Bitcoin APIs for gap healing and verification, not bulk history
  crawling.

At roughly 144 blocks/day, steady-state block acquisition is inexpensive. New Counterparty addresses
join the followed set from `xcpio-core`; their historical backfill is a separate bounded job using a
hosted address-history API or Electrs-compatible provider, with explicit coverage status until complete.

### Durable raw tables

- block totals and Counterparty block totals;
- relevant transaction headers;
- watched address input/output participation;
- external address dictionary and input/output participation;
- unknown script fingerprints and participation;
- watched UTXO set and address aggregates;
- authoritative Counterparty transaction fees;
- scan checkpoint, canonical block hash, failures, policy version, and coverage metadata.

### Rebuildable analytical tables

- transaction structure flags;
- address-pair/co-participation aggregates;
- funding ancestry and cycle candidates;
- versioned cluster memberships;
- market-event risk signals;
- entity attribution assertions and provenance.

Raw tables are the evidence base. Analytical tables may be dropped and rebuilt when methodology
changes.

## API and presentation contract

Every public result should expose:

- whether it is observed, derived, or asserted;
- canonical coverage height/hash and completeness class;
- raw supporting transactions or a route to inspect them;
- method/version for derived results;
- confidence and provenance for assertions;
- ambiguity and exclusion flags;
- explicit language distinguishing exact balance, observed partial flow, candidate cluster, and named
  entity attribution.

Suggested product views:

- block/month/year Counterparty share dashboard;
- address Bitcoin activity and exact-balance panel;
- transaction participant diagram retaining multi-input/multi-output structure;
- external counterparty ranking with neutral behavioral summaries;
- funding/control evidence graph;
- exchange/service candidate review queue;
- market-event wash-risk evidence panel;
- reputation assertion history with dispute/withdrawal state.

## Validation gates

Before production use:

1. Reconcile every scanned block hash with canonical Core at the checkpoint.
2. Require zero unresolved block or transaction parse failures below the completeness watermark.
3. Reconcile watched balances against Core/Electrs for a stratified address sample, including zero,
   high-activity, legacy, SegWit, Taproot, multisig, and spent-to-zero cases.
4. Reconcile Counterparty transaction fee coverage to the authoritative transaction-hash set.
5. Verify block aggregates against direct Core responses across eras and consensus transitions.
6. Measure graph row counts, database size, scan throughput, and lookup latency against the 10 GiB
   portability budget.
7. Test known CoinJoin, PayJoin, exchange batching, self-transfer, and change cases before enabling
   control inference.
8. Validate any exchange attribution method on known positive and negative address sets.
9. Keep attribution and reputation features private/review-only until false-positive behavior is
   measured and presentation language is approved.

## Implementation sequence

1. Complete and verify Core, txindex, and Electrs recovery.
2. Freeze and fingerprint the watched-address and Counterparty-transaction source sets.
3. Populate only Layer 1 raw observations and coverage metadata.
4. Measure size and performance; adjust raw retention only with documented evidence.
5. Validate balances, fees, block shares, scripts, and reorg behavior.
6. Implement neutral Layer 2 structural signals and known heuristic exclusions.
7. Join the graph to dispenser/DEX/auction/OTC/scam/entity evidence.
8. Evaluate precision on reviewed examples before producing Layer 3 assertions.
9. Add public UI only for claims whose evidence and uncertainty can be communicated honestly.

## Open decisions requiring measured evidence

- Whether one-hop external I/O remains comfortably below the 10 GiB target.
- Whether to promote selected high-value external nodes automatically or only through review.
- How much funding ancestry depth is useful before cost and false linkage dominate.
- Which external attribution sources are legally and methodologically suitable for publication.
- Confidence thresholds and language for service, shared-control, Sybil, and wash-risk outputs.
- Retention and publication policy for potentially sensitive reputation claims.
