# Counterparty-targeted Bitcoin index

## Objective

Use the archival Bitcoin node for one complete historical scan, then maintain a portable SQLite
database below 10 GiB with public Bitcoin APIs. The database is evidence for Counterparty-address
history, direct BTC payments, ownership heuristics, and wash analysis. It is not a general Bitcoin
explorer and must not retain unrelated blockchain data.

## Retention boundary

Retain:

- a compact transaction header and watched I/O for Counterparty transactions, transactions touching
  multiple watched addresses, Counterparty UTXO/recovery events, and explicitly selected evidence;
- exact lifetime and calendar-month aggregates for ordinary single-watched-address Bitcoin activity;
- the current watched UTXO frontier required for exact balances and later spends;
- direct watched-address-to-watched-address payment edges;
- the current unspent watched outputs required to process later raw blocks;
- external identity and raw event detail only for explicitly selected OTC, market-integrity,
  attribution, or forensic transaction hashes;
- authoritative Bitcoin fees for every Counterparty protocol transaction hash;
- one compact measurement row per Bitcoin block, including total and Counterparty transaction
  counts, serialized bytes, weight, and fees, plus subsidy and actual coinbase output value;
- scan coverage, failures, reorg state, and schema/policy versions.

Do not retain:

- unrelated transactions;
- scripts, witnesses, signatures, or raw transaction bytes after extraction;
- every non-Counterparty input and output;
- a general address index or a duplicate copy of blocks;
- inferred owner identities as facts.

## Compact schema

All hashes are 32-byte BLOBs, satoshi amounts are INTEGERs, and Counterparty addresses reuse the
existing integer `address_id` values.

```sql
CREATE TABLE scan_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  block_height INTEGER NOT NULL,
  block_hash BLOB NOT NULL,
  policy_version TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);

CREATE TABLE btc_block_metrics (
  block_height INTEGER PRIMARY KEY,
  block_hash BLOB NOT NULL UNIQUE,
  block_time INTEGER NOT NULL,
  block_size_bytes INTEGER NOT NULL,
  block_weight INTEGER NOT NULL,
  transaction_count INTEGER NOT NULL,
  subsidy_sats INTEGER NOT NULL,
  total_fee_sats INTEGER NOT NULL,
  coinbase_output_sats INTEGER NOT NULL,
  counterparty_transaction_count INTEGER NOT NULL,
  counterparty_size_bytes INTEGER NOT NULL,
  counterparty_weight INTEGER NOT NULL,
  counterparty_fee_sats INTEGER NOT NULL
);

CREATE TABLE btc_tx (
  tx_id INTEGER PRIMARY KEY,
  tx_hash BLOB NOT NULL UNIQUE,
  block_height INTEGER NOT NULL,
  tx_position INTEGER NOT NULL,
  block_time INTEGER NOT NULL,
  fee_sats INTEGER,
  flags INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX btc_tx_block ON btc_tx(block_height,tx_position);

CREATE TABLE btc_address_io (
  address_id INTEGER NOT NULL,
  tx_id INTEGER NOT NULL,
  direction INTEGER NOT NULL CHECK(direction IN (0,1)), -- 0=input, 1=output
  io_index INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  PRIMARY KEY(address_id,tx_id,direction,io_index)
) WITHOUT ROWID;
CREATE INDEX btc_address_io_tx ON btc_address_io(tx_id,direction,io_index);

CREATE TABLE btc_direct_flow (
  tx_id INTEGER NOT NULL,
  payer_id INTEGER NOT NULL,
  payee_id INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  payer_input_count INTEGER NOT NULL,
  payee_output_count INTEGER NOT NULL,
  attribution_flags INTEGER NOT NULL,
  PRIMARY KEY(tx_id,payer_id,payee_id)
) WITHOUT ROWID;
CREATE INDEX btc_direct_flow_payee ON btc_direct_flow(payee_id,tx_id);

CREATE TABLE watched_utxo (
  tx_hash BLOB NOT NULL,
  vout INTEGER NOT NULL,
  address_id INTEGER NOT NULL,
  value_sats INTEGER NOT NULL,
  PRIMARY KEY(tx_hash,vout,address_id)
) WITHOUT ROWID;

CREATE TABLE btc_address_stats (
  address_id INTEGER PRIMARY KEY,
  first_block INTEGER,
  last_block INTEGER,
  input_txs INTEGER NOT NULL DEFAULT 0,
  output_txs INTEGER NOT NULL DEFAULT 0,
  sats_in INTEGER NOT NULL DEFAULT 0,
  sats_out INTEGER NOT NULL DEFAULT 0,
  direct_peers INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE scan_failure (
  block_height INTEGER NOT NULL,
  tx_hash BLOB,
  stage TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY(block_height,tx_hash,stage)
) WITHOUT ROWID;

CREATE TABLE counterparty_tx_fee (
  tx_hash BLOB PRIMARY KEY,
  block_height INTEGER NOT NULL,
  fee_sats INTEGER NOT NULL,
  published_at INTEGER
) WITHOUT ROWID;

CREATE TABLE fee_coverage (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  expected_transactions INTEGER NOT NULL,
  resolved_transactions INTEGER NOT NULL,
  missing_transactions INTEGER NOT NULL,
  source_height INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
```

The block table deliberately stores observations rather than percentages. Query-time ratios provide
Counterparty shares of transaction count, serialized bytes, block weight, all fees, and miner
revenue. `coinbase_output_sats` is the observable miner payout and therefore the honest total block
reward; `subsidy_sats` is the consensus schedule. They remain separate from `total_fee_sats` because
miners can claim less than the maximum allowed reward and historical anomalies should remain visible.
Weight share is the preferred block-capacity comparison after SegWit. Serialized-byte share uses the
complete block size as its denominator, including header and transaction-count overhead.

Bitcoin's two BIP30 duplicate-coinbase exceptions at heights 91,842 and 91,880 are explicit canonical
validation samples. Their duplicate transactions pay bare P2PK scripts, do not intersect the watched
address set, and predate the authoritative Counterparty transaction universe. They therefore require
two distinct block-metric rows but no duplicate row in the bounded relevant-transaction table, whose
hash uniqueness remains valid within this retention boundary.

External funding/change identity and raw event rows are opt-in through a transaction-hash evidence
watchlist. Watched-address facts and transaction structure flags remain authoritative; external
participants can be backfilled from Core or an Electrs-compatible provider when a market, OTC,
attribution, or forensic candidate is promoted. A v5 measurement at height 497,399 found that unrestricted external
event tables and their indexes consumed approximately 4.73 GB of a 7.86 GB database. The equivalent
all-address aggregate candidate was 3.74 GB but still grew too quickly in a 1,000-block continuation,
so it was rejected in favor of explicit evidence selection.

## Counterparty-adjacent Bitcoin graph

The historical scan should retain the bounded one-hop Bitcoin graph for every transaction that either
touches a watched Counterparty address or is a known Counterparty protocol transaction. This is not a
general Bitcoin address index: unrelated transactions and unrelated branches remain excluded. For a
relevant transaction retain all parseable Bitcoin input and output addresses, values, positions, and
the transaction hyperedge connecting them. Retain unknown-script type/fingerprint when no standard
address can be decoded so value does not silently disappear.

Keep three layers separate:

1. **Observed ledger facts:** transaction membership, input/output direction, value, time, current
   watched UTXOs, and exact watched-address BTC balance.
2. **Derived graph signals:** shared funders, common-input/co-spend events, fan-in/fan-out,
   consolidation, repeated round amounts, timing similarity, return flows, and transaction cycles.
3. **Identity or conduct claims:** exchange/operator clusters, common control, Sybil relationships,
   wash trades, and scam associations. These require evidence, confidence, method version, and
   provenance; they must never overwrite observed facts.

Useful outputs include:

- current and historical BTC balances for watched Counterparty addresses;
- external Bitcoin counterparties ranked by interactions and value;
- exchange deposit/hot-wallet candidates from repeated deposit fan-in, consolidation, and batched
  withdrawal behavior, with separately sourced labels where available;
- likely shared-control clusters from co-spends, while flagging CoinJoin, PayJoin, exchange batching,
  and other multi-party constructions that invalidate the naive common-input heuristic;
- Sybil candidates from common funding ancestry, synchronized activation, equal-value fan-out, and
  later consolidation;
- dispenser/OTC wash-risk signals where buyer funding traces to the seller or its cluster, proceeds
  cycle back, or nominally independent buyers share a strong funding/control fingerprint;
- graph links between known scammer addresses and other Counterparty or Bitcoin addresses;
- bridges to already-known Ethereum identities through independently evidenced cross-chain records.

Bitcoin's UTXO model does not identify a unique payer-to-payee mapping in a multi-input,
multi-output transaction. Store the transaction as a hyperedge first. A directed payment edge is an
inference and must carry ambiguity flags for multiple candidate payers, multiple candidate payees,
self/change candidates, CoinJoin-like structure, and service/exchange batching.

### Balance boundary

For a watched address, the full scan makes `sum(unspent watched outputs)` an authoritative current BTC
balance at the indexed tip. Historical balance is the running sum of observed outputs minus spends.
For a newly encountered external address, the bounded graph sees only its participation in relevant
transactions and therefore cannot claim its complete Bitcoin history or balance. Promote an external
address into the watched set and scan its complete history (locally or through Electrs) before showing
a balance as complete.

### Attribution and reputation rules

Every inferred relation should record `method`, `method_version`, `confidence`, supporting event
count/value, first/last evidence heights, contradictory flags, and label provenance. Public output
should use calibrated language such as *observed counterparty*, *likely shared funding*, or
*exchange-behavior candidate*. Never turn a single co-spend, change guess, round amount, or proximity
in time into a common-control or misconduct claim. Negative reputation should require multiple
independent signals or direct sourced evidence and remain reversible/auditable.

## Initial bulk scan

1. Snapshot the watched address set and policy version.
   Immediately before the production scan, refresh this snapshot from current `xcpio-core` and record
   its height, row counts, and fingerprints. Source growth requires the explicit
   `--accept-source-update` flag and is permitted only while no scan checkpoint exists; after scanning
   begins, any source change requires a fresh rebuild rather than silently changing coverage.
2. Fetch canonical blocks from the local archival Bitcoin Core RPC at verbosity 3. This supplies
   decoded transactions, prevouts, fees, transaction sizes/weights, and block totals locally in one
   pass. Maintain the compact watched-output set while scanning,
   so later inputs can be attributed without requesting JSON prevouts for every unrelated transaction.
3. Insert a transaction only after discovering a watched input or output.
4. Independently compare every scanned transaction hash against the compact Counterparty transaction
   hash set. Fetch prevout detail only for those matches and store the Bitcoin-authoritative fee, even
   when none of its addresses are otherwise watched.
5. Store all watched inputs/outputs for a relevant transaction, derive direct flows, update address stats,
   and maintain watched UTXOs.
6. Commit every bounded block batch and checkpoint height plus block hash.
7. On restart, verify the checkpoint hash before resuming. Roll back affected rows on reorg.
8. Record every failure; never advance the durable completeness watermark past an unresolved block.

The scanner reconstructs only the bounded watched-UTXO and unspent-recovery outpoint maps in memory
on resume. This avoids a SQLite probe for every unrelated Bitcoin input while leaving SQLite as the
durable checkpoint. Progress receipts expose both map sizes and process RSS so memory growth remains
observable during the historical pass.

Do not begin the production scan merely because raw block files exist. First require Bitcoin Core to
finish canonical validation of the recovered archive, build `txindex`, synchronize to the network tip,
and pass the historical-access proof. This keeps the completeness watermark tied to a fully verified
source rather than to the highest physically present block file.

During the active validation pass, non-final read checks confirmed both physical ends of the repaired
archive remain deserializable: the repaired block at height 59,563 returned its 216-byte one-transaction
payload, and the stored header-chain tip at height 883,091 returned 1,904 transactions and a
1,508,888-byte block. The latter correctly had negative confirmations while active chainstate was
still below it. These checks establish physical readability only; canonicality and global txindex
coverage remain reserved for the synchronized historical-access proof.

An isolated milestone scan over heights 278,319 through 280,100 may run as soon as Core validates that
range. It must reconcile all 740 authoritative Counterparty transaction hashes in the range, persist
all 1,782 contiguous block rows, and exactly reproduce the production-verified recovery output
`1c20d659…76ccce:1` (54,300 sats to `1EXoDus…6A5S4P`) at height 280,091. Structural bare-multisig
candidates do not satisfy this gate. Its proof is diagnostic
evidence for the production decoder; it does not replace full-tip readiness or authorize the production
genesis-to-tip scan.
The same receipt must report 740 expected and 740 resolved Counterparty fees, zero missing fees, and
source height 280,100 in the persisted `fee_coverage` row.
The milestone harness is interruption-safe: it validates and resumes a compatible partial checkpoint,
or proceeds directly to proof when the target checkpoint already exists. It never overwrites an
existing fixture and rejects incompatible start heights or checkpoints beyond the bounded target.
When that isolated receipt passes, its SHA-256 is embedded in the scanner-readiness receipt. The
Electrs-to-scanner monitor still requires full Core, historical-access, and Electrs proofs before it
can start the production build; the milestone approval cannot bypass any runtime completeness gate.

The historical-access proof is persisted as a machine-readable receipt. It requires synchronized
Core and `txindex`, reads the repaired block by its exact hash, resolves one transaction from that
block through global `getrawtransaction` without a block-hash hint, and reconciles sampled canonical
block hashes across the archive. Electrs may bootstrap afterward, but the compact production scanner
cannot start unless this proof and the separately reviewed scanner-readiness marker both exist.

Electrs completion is also actively proven rather than inferred solely from its log. The verifier
negotiates the Electrum protocol, reconciles its subscribed header height to synchronized Core, derives
the script hash for a known historical Counterparty-adjacent P2PKH address, requires a non-empty
confirmed history, and reconciles returned transaction heights and block hashes through Core. Its
proof requires Electrs to be no more than one block behind the Core height named by the receipt.
Handoff monitors accept that receipt only while its Core block remains a canonical ancestor no more
than six blocks behind the moving live tip. This avoids an exact-tip race when a new Bitcoin block is
mined during verification without weakening canonical-chain or bounded-freshness requirements.

The compact-build supervisor owns the complete post-Electrs lifecycle: launch and wait for the
scanner, preserve per-run stdout/stderr, stop on a durable scanner failure, compare the resulting
checkpoint with the moving Core tip, run bounded resume passes when necessary, and execute the full
database verifier. Only a successful production-mode verification writes the final compact-index
proof. A deliberately bounded `partial` mode exists for smoke tests but is explicitly marked and
cannot satisfy the production proof contract.

Production completion additionally refreshes a read-only snapshot of verified (`recoverable` or
`spent`) outputs from `xcpio-btc` and reconciles it to the unified scan. Output identity, value,
script, Counterparty layout, recovery key/address, block placement, and classifier version are strict;
missing or unexpected verified rows fail the build. A remotely spent output must have the same local
spender and height. If the archival Core pass proves that a remotely recoverable output has since
been spent, that is reported as a newly proven spend rather than treated as a contradiction.
Unverified structural bare-multisig candidates remain outside this equality test by design.

The production fee backfill currently has 3,147,702 expected Counterparty transactions, 1,163,577
resolved fees, and 1,984,125 missing fees (36.97% complete). The public-API fee runner is not active.
The combined block scan should supersede transaction-by-transaction provider calls, then publish only
the remaining fee rows in bounded idempotent batches.

Immediately before the genesis scan, freeze an `xcpio-core` source snapshot with transaction count,
maximum transaction index, maximum block, address count/maximum ID, and indexed chain height. Page
only through those captured maxima so concurrent ingestion cannot move the target. Address IDs are
append-only. For transactions, replace and reimport the most recent 10,080 blocks rather than merely
appending; this reconciles shallow reorgs and corrected tail rows while retaining the immutable deep
prefix. Exact count, maximum height, source fingerprint, and chain-height checks must pass before the
scanner starts. The isolated rehearsal replaced 15,292 old tail rows with 15,320 frozen remote rows,
yielding the exact live snapshot of 3,148,455 transactions through block 958,774.

The scanner rejects a transaction source before its first block read unless every stored hash is
exactly 32 bytes, every transaction index and expected block height is present and nonnegative, and
transaction indices are unique and contiguous from zero. The same structural test is repeated by the
final verifier. The frozen production base passed with 3,148,427 rows, transaction indices
0–3,148,426, block heights 278,319–958,766, and zero malformed, missing, negative, or duplicate
fields. Exact post-scan fee reconciliation remains the stronger hash-to-block-height proof: every
watched hash through the checkpoint must have been encountered in its declared canonical block.

### Counterparty UTXO entities and multisig identities

The UTXO model is grounded in official Counterparty Core source commit
`ca2496dd852c81ffaceb49ab70128998333a536e` (2026-07-08), rather than inferred from string shape.
Mainnet `utxo_support` activates at block 866,000. Core stores an asset-bearing output as the split
pair `(utxo_tx_hash BLOB, utxo_vout)` because its creation transaction may be an ordinary Bitcoin
transaction absent from Counterparty's transaction table. It stores `utxo_address` separately as
the Bitcoin owner resolved from that output. Spending an asset-bearing output automatically moves
all attached balances to the destination output or detaches them to an address.

The live source contains 46,138 distinct UTXO entities in 46,825 latest asset-balance rows; 1,065
outputs currently have positive balances in 1,152 rows. All 46,138 independently reconcile to
historical send/ledger references. Counterparty's transaction set contains 46,136 creation hashes;
the two ordinary-Bitcoin exceptions are `71342e070ab70f4b41ca7e4740e6bc7a7f3852410f78870949d38022cf421248:0`
and `f39cc7fa5af8abb648f7825bbbf451cdec0d115c953ae9831ef3f674946e88ff:5`.

Payment addresses, multisig identities, and UTXO entities remain distinct. Counterparty multisig
identity syntax is the canonical sorted `m_pubkeyhash..._n` form; it is not a Base58 address.
`multisig_utxo_addresses` activates at mainnet block 961,100. At and after that gate, Core converts a
bare-multisig output's public keys to P2PKH members and records the composite identity as its owner.
Before the gate, a deterministically resolvable address-less output may carry owner `unknown`; Core's
source explicitly treats that value as consensus state, so this index preserves it instead of
retrospectively guessing an owner.

The compact v5 source snapshot therefore freezes three independently fingerprinted sets: validated
mainnet payment addresses, Counterparty transaction hashes/heights, and split Counterparty UTXOs with
their source owner identity. The genesis scan retains UTXO creation and spending transactions even
when they are not otherwise Counterparty transactions, verifies ordinary output owners exactly,
derives canonical bare-multisig owners, and persists explicit creation/spend state. The final verifier
requires every frozen UTXO to have a creation row and internally consistent spend state, and includes
varied outpoint lookups in the same 25 ms p95 performance gate as address, transaction, fee, block,
month, recovery, and graph-neighbor queries. The earlier
v4 readiness receipt cannot authorize this expanded policy.

The v5 readiness receipt must bind two separately hashed receipts: the established early
Counterparty-era milestone and the post-activation UTXO milestone over blocks 866,000 through
872,100. The latter remains a candidate until its exact counts and both ordinary-Bitcoin creation
exceptions are audited. Merely finding a v5-named marker file, or passing an early synthetic
fixture, cannot start the production scan.

One exception is a 547-satoshi P2PKH output created at Bitcoin block 823,054, before UTXO support;
the other is a 97,632-satoshi P2WPKH output created at block 867,291. Rather than scanning 49,000
unrelated high-density blocks for a bounded readiness
test, the candidate runs one authoritative-source fixture at 823,054 and the contiguous semantic
milestone at 866,000–872,100. The final production verifier still requires genesis coverage for all
46,138 entities.

## Bootstrap execution sequence

During the one-time v31.1 archive recovery, the log line `Reindexing finished` marks completion of
raw `blk*.dat` discovery, not the end of `ImportBlocks()`. Bitcoin Core keeps its `ImportingNow`
guard active while `ActivateBestChains()` connects the historical chainstate to the 840,000
AssumeUTXO base. While that guard is active, `PeerManagerImpl::SendMessages()` deliberately does not
start header synchronization, so connected peers legitimately report no synchronized headers,
blocks, or inflight downloads. At height 840,000 Core force-flushes the historical UTXO database,
computes and compares its serialized hash with the hard-coded snapshot commitment, validates the
snapshot, reallocates the cache, activates the snapshot chain, and returns from `ImportBlocks()`.
Only then does ordinary peer download from the snapshot base to the network tip begin. A several-minute
pause while computing the UTXO hash is expected and is not grounds for restarting Core.

1. `monitor-core-reindex.ps1` observes the existing Core process without restarting it. Readiness
   requires a fresh mainnet tip, `blocks == headers`, IBD false, synchronized `txindex`, and a
   canonical read of the previously damaged historical block.
2. `run-v5-utxo-candidate-milestone.ps1` independently waits for block 872,100, then produces the
   bounded UTXO candidate and artifact hashes. It cannot write the production readiness marker.
3. `monitor-v5-utxo-approval.ps1` is a separate fail-closed promotion process. After the candidate
   appears, it invokes `approve-v5-utxo-milestone.ps1`, which independently checks every candidate
   assertion, the reviewed ranges/counts, both exception rows, and SHA-256 hashes of all fixture
   databases. Only then does it bind the established early-era proof and post-activation UTXO proof
   into the production readiness receipt. A missing or failing candidate is never promoted.
4. Once Core is ready, the Core monitor starts supervised Electrs. The Electrs monitor requires its
   exact-tip proof, the historical Core proof, and the dual-bound v5 approval before starting the
   compact build. On this 15.7 GiB host Electrs uses its source-defined conservative defaults of one
   RocksDB background thread and ten blocks per P2P request; larger local overrides were removed to
   avoid memory pressure alongside Core's 8 GiB configured database cache.
5. The compact supervisor performs one final authoritative source refresh before genesis scan,
   freezes all three source fingerprints, scans and catches up to the moving tip, verifies the
   database, reconciles recovery outputs, refreshes Core/Electrs proofs, and writes the final pipeline
   completion receipt.

The currently running monitors intentionally do not restart Bitcoin Core on a stall. A stall is
logged for diagnosis; all scanners resume only from durable SQLite checkpoints. The separate v5
approval monitor may write a readiness receipt only through the deterministic evidence audit above;
it cannot manufacture or relax candidate results.

After any graceful shutdown or host reboot, restart the recovered archive node with
`tools/counterparty-bitcoin-indexer/start-bitcoin-core-archive.ps1`. That launcher deliberately omits
`-reindex` and `-reindex-chainstate`, refuses to create a duplicate process for the datadir, and waits
for RPC readiness. The one-time recovery command containing `-reindex=1` must never be reused: Bitcoin
Core's installed help and v31.1 source define it as wiping and rebuilding the chainstate, block index,
and enabled optional indexes.

`tools/counterparty-bitcoin-indexer/get-pipeline-status.ps1` is the read-only operational status
surface. It reports the current stage, Core and `txindex` heights, exact supervisor process sets, free
space, compact checkpoint/source metadata, proof presence, and the latest Core/UTXO/approval monitor
events as one JSON document.

## Cheap ongoing maintenance

- Fetch each confirmed block once from a hosted verbosity-3 Bitcoin RPC and parse it locally. This is
  preferred because the response supplies decoded transactions, prevouts, fees, sizes, and weights in
  one request; an alternate provider remains available for verification and gap healing.
- Use `watched_utxo` to recognize watched-address inputs without a global transaction index.
- When a transaction creates an output to a watched address and external-input attribution is needed,
  request decoded previous-output data only for that relevant transaction.
- Add newly observed Counterparty addresses to the watch set and backfill their earlier Bitcoin
  history through an Electrs-compatible or hosted address-history API, retaining an explicit partial
  coverage state until the backfill reaches genesis.
- Periodically compare the public tip and stored block hashes; retain a small reorg rollback window.

Running Bitcoin Core occasionally remains the cheapest fallback for repairing gaps. Public APIs are
maintenance transport, not the source of truth for the initial history.

## Size controls

Measure after every 25,000 blocks:

```sql
SELECT page_count*page_size FROM pragma_page_count(),pragma_page_size();
SELECT name,SUM(pgsize) FROM dbstat GROUP BY name ORDER BY 2 DESC;
```

The final lookup gate cycles across up to 100 distinct recent blocks, relevant transactions,
Counterparty fee rows, high-activity watched addresses, external neighbors, and recovery addresses.
It does not certify latency by repeatedly reading one already-hot row. Each operation must remain at
or below the configured 25 ms p95 threshold, with its distinct-parameter count included in the proof.

Completion is established by `verify-pipeline-completion.ps1`, not by the presence of any one receipt.
It binds the live Core tip and `txindex`, canonical historical proof, Electrs proof, milestone approval
hash, production compact verifier (with no skipped checks), recovery reconciliation, current compact
checkpoint, policy version, lookup latency, and size ceiling into one final completion receipt.
Historical, Electrs, and compact proofs are refreshed after the last catch-up/reconciliation pass.
Because Bitcoin's tip can advance during the final seconds, the auditor accepts a proof tip only when
it is at or above the compact checkpoint and independently confirms its hash remains a canonical
ancestor of the live tip. It does not require multiple proofs sampled seconds apart to name the same
moving tip. Electrs is nevertheless required to be at the exact Core tip when its final proof is made.

The compact verifier also requires every address/external/unknown I/O, watched UTXO, address aggregate,
direct flow, fee, and recovery extension to retain its expected parent. Fee and recovery parents must
exist in `btc_tx` and carry the Counterparty flag; extension rows cannot pass as detached artifacts.

Every successful scan pass persists a `fee_coverage` receipt through its exact checkpoint height.
Production verification recomputes expected, resolved, and missing Counterparty fees from the raw
watch/fee tables and requires exact agreement with that receipt and its source height.

The watched balance equation is an exact invariant only for a scan beginning at genesis. A bounded
diagnostic scan may observe spends of outputs created before its range, so partial verification reports
that gate as explicitly skipped with the start height. Production verification never skips it.

Budget gates:

- 6 GiB: review row counts and indexes;
- 8 GiB: stop adding optional external event detail;
- 9 GiB: reserve the final GiB for growth, indexes, and reorg operations;
- 10 GiB: hard failure, never silent truncation.

The scanner checks this ceiling at durable commit boundaries and emits receipts at 60%, 80%, and
100% utilization. Crossing the ceiling stops the build with its last committed checkpoint intact;
the final verifier independently enforces the same limit. A ceiling stop is persisted as policy
metadata rather than a `scan_failure`, because it does not imply that the current Bitcoin block is
invalid and must not poison a later resume after an explicit retention/schema decision.

### Measured Counterparty-era milestone

An isolated mechanical fixture also scans the real block 278,319 output
`685623401c3f5e9d2eaaf0657a50454e56a270ee7630d409e98d3bc257560098:2`. It must resolve owner
`1Pcpxw6wJwXABhjCspe3CNf3gqSeh6eien`, value 340,000 satoshis, fee 10,000 satoshis, and both
Counterparty/UTXO flags. This proves the scanner branch works against Bitcoin Core, but it is not
UTXO-era semantic evidence and is never accepted as a readiness receipt.

The production-data scan of heights 278,319–280,100 processed 1,782 blocks and 566,697 Bitcoin
transactions in 265.901 seconds (6.70 blocks/second), with approximately 877 MB peak observed RSS.
It stored 9,381 relevant transactions, 12,793 watched I/O rows, 124,762 external I/O rows, 740 exact
Counterparty fees, and the first verified recovery output. The completed SQLite file was 342,212,608
bytes and passed full integrity checking.

A controlled 400-block comparison over heights 278,319-278,718 measured 6.21 blocks/second with an
RPC batch of 4, 6.51 with a batch of 8, and 5.77 with a batch of 16 while Core was concurrently
rebuilding chainstate. Production therefore uses batch 8 and reports RPC, processing, and commit
phase timings. A selective-prevout prototype was rejected: transaction-level prevout calls took
84.250 seconds for the same slice and relevant-block refetching was slower still. The complete
verbosity-3 block path remains both the proven and the faster implementation for this workload.

A separate instrumented 200-block profile during the same Core rebuild spent 33.766 seconds fetching
verbosity-3 blocks, 1.716 seconds resolving block hashes, 1.196 seconds processing and writing rows,
and 0.012 seconds committing. Block RPC occupied about 92% of elapsed time; SQLite processing plus
commit occupied about 3.3%. Deferring secondary indexes would therefore add complexity without
materially improving this workload. The production scan remains gated until Core is idle.

The varied 100-parameter lookup benchmark passed with a 0.158 ms slowest p95 against a 25 ms gate.
Individual p95 results were 0.023 ms for blocks, 0.023 ms for transactions, 0.023 ms for fees,
0.158 ms for active watched-address history, 0.141 ms for watched UTXOs, 0.024 ms for external
history, and 0.036 ms for recovery-by-address. Recovery had one distinct address in this early slice;
the other operations used 100 distinct parameters each.

The persistent lookup surface also exposes watched-to-watched BTC neighbors in both directions and
transaction-level direct-flow evidence. A later 200-block rehearsal exercised 57 distinct addresses;
the new neighbor operation measured 0.034 ms p95, while the slowest operation in the expanded suite
was 0.089 ms p95. The payer-side index is explicit rather than relying on the transaction-first
primary key.

Calendar-month lookup is indexed by block time and returns Bitcoin/Counterparty transaction count,
serialized-size, weight, fee, and miner-reward totals plus percentage shares. On the 200-block January
2014 rehearsal slice it returned in 0.225 ms; the repeated benchmark measured 0.083 ms p95. The result
always includes first/last indexed height and block count so a partial slice cannot masquerade as a
complete calendar month.

Direct-flow bit flags distinguish multiple watched payers (1), multiple watched payees (2), self-flow
(4), and any external or unknown co-input (8). “Clean” neighbor totals require flags=0; all other
amounts remain explicitly labeled candidate flows. A fresh 1,782-block milestone after this semantic
change recomputed every flag from raw I/O with zero mismatches, retained all 740 exact fees and the
verified recovery output, and passed the expanded lookup suite at 0.121 ms slowest p95. Its proof
SHA-256 `53fb3259adf0e0a87116c70d3f90b10a2b1d0638e7116cacd932b12572f207eb` is bound into the current
scanner-readiness receipt.

Of that allocation, 331,907,072 bytes belong to the frozen 441,959-address / 3,148,427-transaction
source layer and its lookup indexes. The bounded scan added approximately 10.3 MB of derived storage;
external address/I/O tables were its largest derived component. Linear scaling of this early slice
would imply roughly 5.5 GiB total through the current source height, but this is only a budget signal:
Bitcoin transaction density, Counterparty frequency, and watched-address activity are strongly
nonstationary. The production scan must continue reporting actual allocation and enforce the 10 GiB
ceiling rather than relying on this extrapolation.

Build indexes only after the bulk load where possible. Use `WITHOUT ROWID` for composite-key tables,
integer dictionary identifiers, BLOB hashes, WAL during scanning, and `VACUUM` only after the initial
load is complete.

## Interpretation controls

Common-input ownership, change detection, round trips, and repeated reciprocal flows are heuristics.
CoinJoin, exchanges, custodians, shared services, and wallet reorganizations create exceptions. Store
the observable evidence and attribution flags separately from any inferred cluster or wash label.
