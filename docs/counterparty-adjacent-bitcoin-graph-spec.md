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
- lifetime/monthly watched-address aggregates and the live watched UTXO frontier;
- external identity and raw input/output participation only for explicitly selected evidence transactions;
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

## Exploratory checkpoint: 2026-07-23

This is a review snapshot, not a production classification. At Bitcoin block 805,303, the compact
index contained 574,881 direct flows with the narrowest attribution class (one watched payer, one
watched payee, and no external co-input ambiguity). Those flows reduced to 219,515 directed address
pairs involving 101,428 watched addresses.

The first structural result is an exclusion requirement. Raw degree rankings are dominated by known
exchange/service wallets and repeated dust campaigns. Many otherwise-unclassified one-way hubs sent
an identical 3,000 or 5,430 satoshis to hundreds or thousands of watched addresses. Other hubs sent
roughly 7,400 satoshis per recipient. These are evidence of unsolicited dust/address-poisoning exposure,
not evidence that the recipients share control or a meaningful relationship. Graph reputation and
clustering must therefore suppress dust-valued mass fan-out and mass fan-in before scoring peers.

The label inventory is also incomplete. For example, a well-known Binance hot wallet appears as an
ordinary address in the local signal snapshot and consequently ranks as a large unlabeled hub. Entity
classification must be refreshed before any hub or reciprocal-flow ranking is interpreted.

After excluding locally known exchanges, deposit addresses, burns, services, and vaults, there were 438
address pairs with clean Bitcoin flow in both directions. Only 55 had at least two payments each way,
and only four had at least three payments each way with aggregate directional values within 20%. Two of
those four pairs were active Counterparty market participants and also transferred many assets directly
between one another. One pair exchanged 23 Bitcoin payments totaling 0.02084572 BTC versus 0.01994350
BTC and directly moved XCP, BITCRYSTALS, and numerous NFTs; production trades also show four XCP
dispenses between the pair. Another exchanged 20 Bitcoin payments totaling 0.00942632 BTC versus
0.00978244 BTC and directly moved XCP, PEPECASH, and numerous Pepe/BOBO assets; one reconstructed OTC
trade exists between the pair. These are useful relationship-review candidates, but repeat commerce,
friends, or wallets under common control remain competing explanations. Reciprocity alone is not a wash
finding.

The current integrity-seed join found only six clean edges touching a locally marked scam-associated
address, five unique counterparties, and 0.0652 BTC in total. Mere payment to or from a marked address
must not transfer the mark. The evidence becomes useful only if combined with stronger facts such as
seller-funded purchases, returned sale proceeds, repeated common-control evidence, or coordinated
market events.

Recommended next analytical sequence:

1. Materialize dust-campaign families by exact amount, time range, sender, and recipient overlap; exclude
   them from trust/distrust and ownership inference while retaining the raw facts.
2. Refresh known service/exchange/burn/vault labels and rerun structural rankings. Behavioral discovery
   may create a review candidate, but never a venue name without external evidence.
3. Join every dispenser, DEX, OTC, and auction trade to prior seller-to-buyer funding and subsequent
   buyer-to-seller return flow. Rank repeated, tightly timed, economically material loops for review.
4. Build conservative shared-control candidates only where multiple independent signals agree: common
   inputs outside ambiguous transactions, repeated change behavior, reciprocal flows, and Counterparty
   asset movement. Keep each evidence edge inspectable and versioned.
5. Use the resulting evidence as a separate market-integrity panel. Do not silently alter asset quality,
   address reputation, price, volume, or ownership merely because two addresses interacted.

### Common-input family discovery

A subsequent pass used the stronger common-input heuristic: two watched addresses appear as inputs to
the same Bitcoin transaction. The initial census contained 446,639 pairs, but most were unsuitable for
ownership inference. Restricting the source transactions to 2–8 watched inputs and rejecting every
transaction carrying the scanner's `EXTERNAL_OR_UNKNOWN_INPUT` flag reduced the result to 25,729 pairs
and 104,262 pair-events. Requiring a relationship to recur at least twice produces reviewable candidate
wallet families rather than treating a one-off co-spend as identity.

Several economically meaningful families survive those restrictions:

- A 38-address family has 95 repeated common-input edges and 292 pair-events across blocks 705,378–805,341.
  Its members collectively account for 491 DEX trades, 1,486 dispenses, and 32 issuances. Multiple pairs
  co-spent 7–18 times, making this substantially stronger than a mere payment relationship.
- A 22-address family centered on `1FakeRareTDi3PkHiehotQ2QAfUdw7Kzyc` has 64 pair-events, 128 total
  issuances, and 131 dispenses. The center issued 126 assets; the family connects that issuer to several
  active market addresses.
- A three-address family led by `1JsPoV5USoFM7441KtGXtvMH5ezNwq9Uak` has ten common-input events,
  289 DEX trades, and 1,358 dispenses. The two principal addresses also have repeated direct Bitcoin flow.
- Multiple prolific issuer families appear: 11 addresses around an issuer with 1,089 issuances; six
  addresses around an issuer with 271 issuances; five addresses accounting for 329 issuances; and several
  early-era families with 25–81 issuances.
- A ten-address Bech32 family has 23 common-input events over only 2,544 blocks and 33 issuances spread
  across several addresses. This compact timing and repeated co-spend structure is consistent with an
  operator-controlled issuance wallet, subject to transaction-level review.

These are candidates for an address-family product, not legal identity claims. Before promotion, inspect
the supporting transactions for collaborative-spend protocols, verify change behavior, measure whether
family members trade with one another, and record the exact evidence and model version. Once reviewed,
family-level holdings, trading, issuance, proceeds, and market concentration can be substantially more
informative than address-level metrics.

### Temporal market-integrity evaluation

Joining the 15 most active candidate families to production trades initially found 80 internal
buyer/seller/asset/venue groups. The largest family participated in 2,142 trades and $1.764 million of
observed USD volume; 31 trades and $25,136.80 appeared internal when evaluated using the family's final
membership. Another family showed $8,433.52 of apparently internal activity.

That static result contains hindsight bias. A later common-input consolidation does not prove that two
addresses shared control at an earlier trade. Requiring the family path to exist at the trade's block
reduced the review set to 32 groups and $2,148.71. Requiring the exact buyer/seller pair to have already
co-spent reduced it further to 28 groups and $1,661.05.

Most of the direct, temporally established amount is XCP dispenser activity (approximately $1.5K). This
may represent operational wallet rebalancing or moving XCP between addresses rather than manufactured
collectible demand. The surviving non-XCP cases are individually small and include FAUXMOONGA,
BOBORPHEUS, BITCRYSTALS, SATOSHICARD, BUYMEABEER, KARMATOKEN, PEPECASH, KEKO, BITPAPER, BITSALTS,
and GIVEKUDOS. They are review candidates, not automatic volume exclusions.

Several initially dramatic results fail the temporal gate: large KANDINSKY dispenser purchases and
same-block CREMAPEPE/MOBYDICK/MAKEARTPEPE/PONZIBEAR DEX activity occurred before the relevant family
relationships were observed. They may remain historically interesting, but the current evidence cannot
call them self-dealing. All family-based market analysis must therefore be block-relative and expose
whether the relationship was direct, transitive, first observed before or after the trade, and supported
by how many independent co-spends.

### Participant and capital measurement checkpoint

The watched-address universe is not a participant census. A Counterparty asset can be sent without the
recipient's consent, so famous Bitcoin addresses, exchange wallets, theft addresses, and the Genesis
address can all acquire a Counterparty balance without ever using the protocol. Summing Bitcoin balances
for every watched address produced obviously invalid ecosystem-capital results. Participant metrics must
therefore require an authored action. The first conservative implementation uses a DEX trade or dispenser
execution and excludes known exchange, deposit, burn, Emblem vault, and service addresses.

At Bitcoin scanner height 807,103, 24,475 such market-participant addresses had begun Counterparty
activity. Of those, 19,099 had a positive Bitcoin balance in the compact index, totaling 285.907084 BTC.
The median positive balance was 0.000625 BTC. Capital was highly concentrated: the largest one percent of
positive-balance addresses held 63.36% and the largest ten percent held 90.74%. These are address-level,
point-in-time balances at the scanner watermark, not current wealth, unique-person counts, or capital
causally committed to Counterparty.

The market roles are economically distinct. DEX-only addresses numbered 14,406 and held 198.8698 BTC;
dispenser-only addresses numbered 8,271 and held 39.767249 BTC; 1,798 addresses used both systems and held
47.270035 BTC. The median positive balance was 0.00075376 BTC for DEX-only addresses, 0.00034619 BTC for
dispenser-only addresses, and 0.00099084 BTC for addresses using both. The low medians support an
operational-wallet interpretation: most addresses retain only small working balances, while a small tail
holds most observed BTC.

Conservative common-input family consolidation does not materially change broad holder counts. Across the
27 strongest active families in the exploratory snapshot, XCP fell from 17,095 address-holders to 17,088,
PEPECASH from 7,815 to 7,810, and BITCRYSTALS from 4,248 to 4,247. KEKO was the notable larger exception,
falling from 142 to 137 (3.52%). Tiny assets can move substantially in percentage terms: FLOWCASHUSD fell
from three address-holders to one and ETHERX from two to one. The defensible conclusion is that address
splitting exists and matters locally, but it does not broadly manufacture the large-asset holder counts.

Lifetime received Bitcoin must not be presented as invested capital or economic throughput. Transfers
between watched addresses are counted at every hop, exchange infrastructure may remain incompletely
labeled, and wallet consolidation can create very large repeated totals. Useful public metrics should be
limited to clearly named point-in-time balances, temporally valid family-adjusted counts, and venue- or
counterparty-specific flows whose attribution rule is inspectable.

### Participant retention and venue paths

Canonical buyer/seller identities show that the venues serve different populations. Across the full trade
ledger, dispensers have 73,366 identified participant addresses, the DEX has 15,961, reconstructed OTC has
3,943, and Tokenly Swapbot has 83. A participant means a distinct buyer or seller address, not a person.

Dispenser participation is broad and predominantly episodic: 49,299 addresses (67.2%) appear in exactly
one dispenser trade, 5,252 have at least ten trades, 10,742 span at least 30 days, and 2,970 span at least
one year. DEX participation is smaller and more persistent: 4,420 addresses (27.7%) appear once, 4,621
have at least ten trades, 6,656 span at least 30 days, and 2,444 span at least one year. Reconstructed OTC
is mostly bilateral one-off activity: 2,971 of 3,943 addresses (75.3%) appear once, while 144 have at least
ten inferred trades.

Venue overlap is concentrated among a comparatively small operator population. There are 2,708 addresses
that used both the DEX and dispensers, 604 that used DEX and OTC but not dispensers, 286 that used
dispensers and OTC but not DEX, and 478 that used all three. The 2,708 DEX-plus-dispenser addresses account
for 145,334 participant-trade appearances, showing that cross-venue users are disproportionately active.

First-use paths show 2,055 addresses using a dispenser before later appearing on the DEX, with a mean lag
of 113.6 days, versus 1,128 using the DEX before later using a dispenser, with a mean lag of 789.6 days.
This asymmetry is consistent with dispensers becoming a retail entry point followed by a smaller subset
adopting the DEX. It is not causal proof: dispensers launched years after the DEX, and address reuse differs
by wallet and era. OTC preceded later DEX use for 466 addresses (mean lag 152.2 days) and later dispenser
use for 184 (mean lag 1,004.3 days), evidence that some reconstructed bilateral counterparties later became
visible market users.

Public retention metrics should expose counts, denominators, observation windows, and venue availability.
They should never call an address a new person, describe a first observed trade as wallet creation, or treat
the direction of a venue path as proof that one product caused adoption of another.

### Pre-activity Bitcoin funding provenance

A narrow funding test looked for uniquely attributable Bitcoin payments of at least 10,000 satoshis in the
144 blocks ending at an address's first observed Counterparty activity. It found evidence for only 398 of
27,569 eligible market addresses. This 1.44% coverage is intentionally incomplete: transactions with
ambiguous inputs or outputs are rejected, and ordinary exchange withdrawals commonly fail that test.

Among the 398, the last clean payment came from an existing market address for 99 recipients (14.228965
BTC), an issuer-classified address for 132 (14.334636 BTC), an otherwise-unclassified watched address for
165 (3.703054 BTC), and a vault address for two (0.00777 BTC). These facts support inspectable provenance
edges; they do not by themselves prove common ownership, onboarding, or payment purpose.

Repeated-funder ranking also demonstrated why infrastructure labels must take precedence over token-derived
personas. Address `1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s` uniquely funded 116 later market addresses with
13.986226 BTC, but the local signal snapshot treated it as an ordinary issuer because it had received or
been associated with Counterparty assets. Independent public address labels identify it as a deprecated
Binance hot wallet. Unsolicited assets must never turn a curated exchange, burn, theft, or famous Bitcoin
address into an issuer, collector, or ecosystem participant.

The production design should retain the strict edges as high-confidence evidence and add a separate,
explicitly lower-confidence exchange-withdrawal detector for many-input/many-output infrastructure. The two
must not be merged silently: exact payer attribution and behavioral exchange attribution answer different
questions and carry different error risks.
