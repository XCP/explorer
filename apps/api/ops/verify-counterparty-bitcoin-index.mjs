#!/usr/bin/env node

import { createReadStream, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { isMainnetBitcoinAddress, parseCounterpartyMultisigIdentity } from "./lib/bitcoin-address.mjs";

const POLICY_VERSION = "counterparty-bitcoin-index-v5-unified-utxo";
const TEN_GIB = 10 * 1024 ** 3;

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

function integerOption(name, fallback) {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid --${name}`);
  return value;
}

const HELP = `Usage: node apps/api/ops/verify-counterparty-bitcoin-index.mjs [options]

  --database=PATH          compact SQLite database
  --datadir=PATH           Bitcoin Core datadir (default C:\\BitcoinFastState)
  --cookie=PATH            override Core RPC cookie
  --rpc-url=URL            Core JSON-RPC URL
  --lookup-samples=N       sampled point lookups (default 100)
  --max-lookup-ms=N        allowed sampled p95 latency (default 25)
  --max-tip-lag=N          allowed blocks behind current Core after target completion (default 6)
  --minimum-height=N       authoritative source floor (default 958766)
  --max-tip-age=N          maximum Core tip age in seconds (default 86400)
  --max-bytes=N            portability ceiling (default 10 GiB)
  --proof=PATH             write the complete verification result as JSON
  --allow-incomplete       audit a partial/smoke build without requiring tip completion`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const databasePath = resolve(option("database", "D:\\Bitcoin\\counterparty-index\\counterparty-bitcoin.sqlite"));
const datadir = resolve(option("datadir", "C:\\BitcoinFastState"));
const cookiePath = resolve(option("cookie", resolve(datadir, ".cookie")));
const rpcUrl = option("rpc-url", "http://127.0.0.1:8332/");
const samples = Math.max(1, integerOption("lookup-samples", 100));
const maxLookupMs = Math.max(1, integerOption("max-lookup-ms", 25));
const maxTipLag = Math.max(0, integerOption("max-tip-lag", 6));
const minimumHeight = Math.max(0, integerOption("minimum-height", 958766));
const maxTipAge = Math.max(1, integerOption("max-tip-age", 86400));
const maxBytes = Math.max(1, integerOption("max-bytes", TEN_GIB));
const allowIncomplete = process.argv.includes("--allow-incomplete");
const proofPath = option("proof");

if (!existsSync(databasePath)) throw new Error(`Missing database ${databasePath}`);
if (!existsSync(cookiePath)) throw new Error(`Missing RPC cookie ${cookiePath}`);

class BitcoinRpc {
  constructor() {
    this.authorization = `Basic ${Buffer.from(readFileSync(cookiePath, "utf8").trim()).toString("base64")}`;
    this.nextId = 1;
  }

  async call(method, params = []) {
    const id = this.nextId++;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { Authorization: this.authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) throw new Error(`Bitcoin RPC HTTP ${response.status}`);
    const item = await response.json();
    if (item.error) throw new Error(`${item.error.code}: ${item.error.message}`);
    return item.result;
  }
}

const db = new DatabaseSync(databasePath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-65536;");
const rpc = new BitcoinRpc();
const failures = [];
const checks = {};

function check(name, condition, evidence, { skipped = false } = {}) {
  if (skipped) {
    checks[name] = { passed: null, skipped: true, evidence };
    return;
  }
  checks[name] = { passed: Boolean(condition), skipped: false, evidence };
  if (!condition) failures.push(name);
}

function scalar(sql, ...params) {
  return Number(Object.values(db.prepare(sql).get(...params))[0]);
}

function sourceFingerprint(statement, encodeRow) {
  const hash = createHash("sha256");
  let count = 0;
  for (const row of statement.iterate()) {
    hash.update(encodeRow(row));
    hash.update("\n");
    count += 1;
  }
  return { count, sha256: hash.digest("hex") };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const blockchain = await rpc.call("getblockchaininfo");
const coreTipAgeSeconds = Math.floor(Date.now() / 1000) - Number(blockchain.time);
const scan =
  db
    .prepare(
      `SELECT block_height,lower(hex(block_hash)) block_hash,policy_version,completed_at
  FROM scan_state WHERE singleton=1`,
    )
    .get() ?? null;
const scanStartHeight = Number(
  db.prepare("SELECT value FROM index_metadata WHERE key='scan_start_height'").get()?.value ?? -1,
);
check("scan_checkpoint_present", scan !== null, scan);
check(
  "core_tip_fresh",
  Number(blockchain.blocks) >= minimumHeight && coreTipAgeSeconds >= 0 && coreTipAgeSeconds <= maxTipAge,
  { blocks: blockchain.blocks, minimumHeight, blockTime: blockchain.time, tipAgeSeconds: coreTipAgeSeconds, maxTipAge },
  { skipped: allowIncomplete },
);

const databaseBytes = scalar("SELECT page_count*page_size FROM pragma_page_count(),pragma_page_size()");
check("portable_size_budget", databaseBytes < maxBytes, { databaseBytes, maxBytes });
check(
  "sqlite_integrity",
  db.prepare("PRAGMA integrity_check").get().integrity_check === "ok",
  "PRAGMA integrity_check",
);
check(
  "unresolved_failures",
  scalar("SELECT count(*) FROM scan_failure WHERE resolved_at IS NULL") === 0,
  scalar("SELECT count(*) FROM scan_failure WHERE resolved_at IS NULL"),
);

const sourceMetadata = Object.fromEntries(
  db
    .prepare(
      `SELECT key,value FROM index_metadata WHERE key IN (
  'watched_source_count','counterparty_source_count','counterparty_source_remote_addresses',
  'counterparty_utxo_source_count','counterparty_source_remote_utxos',
  'counterparty_source_remote_transactions','counterparty_source_remote_height',
  'counterparty_source_chain_height','counterparty_source_refreshed_at'
)`,
    )
    .all()
    .map((row) => [row.key, Number(row.value)]),
);
const sourceHashMetadata = Object.fromEntries(
  db
    .prepare(
      `SELECT key,value FROM index_metadata WHERE key IN (
  'watched_source_sha256','counterparty_utxo_source_sha256','counterparty_source_sha256'
)`,
    )
    .all()
    .map((row) => [row.key, row.value]),
);
const sourceCounts = {
  watched: scalar("SELECT count(*) FROM watched_address"),
  transactions: scalar("SELECT count(*) FROM counterparty_tx_watch"),
  max_height: scalar("SELECT max(expected_block_height) FROM counterparty_tx_watch"),
  utxos: scalar("SELECT count(*) FROM counterparty_utxo_watch"),
};
const sourceStructure = db
  .prepare(
    `SELECT
  count(*) AS transactions,
  sum(CASE WHEN length(tx_hash)<>32 THEN 1 ELSE 0 END) AS malformed_hashes,
  sum(CASE WHEN tx_index IS NULL OR tx_index<0 THEN 1 ELSE 0 END) AS invalid_tx_indices,
  sum(CASE WHEN expected_block_height IS NULL OR expected_block_height<0 THEN 1 ELSE 0 END) AS invalid_block_heights,
  min(tx_index) AS min_tx_index,max(tx_index) AS max_tx_index,
  min(expected_block_height) AS min_block_height,max(expected_block_height) AS max_block_height
  FROM counterparty_tx_watch`,
  )
  .get();
const duplicateTxIndices = scalar(`SELECT count(*) FROM (
  SELECT tx_index FROM counterparty_tx_watch WHERE tx_index IS NOT NULL
  GROUP BY tx_index HAVING count(*)<>1
)`);
const sourceStructureValid =
  Number(sourceStructure.transactions) > 0 &&
  Number(sourceStructure.malformed_hashes) === 0 &&
  Number(sourceStructure.invalid_tx_indices) === 0 &&
  Number(sourceStructure.invalid_block_heights) === 0 &&
  duplicateTxIndices === 0 &&
  Number(sourceStructure.min_tx_index) === 0 &&
  Number(sourceStructure.max_tx_index) === Number(sourceStructure.transactions) - 1;
check("counterparty_source_structure", sourceStructureValid, {
  ...sourceStructure,
  duplicate_tx_indices: duplicateTxIndices,
});
const utxoSourceStructure = db
  .prepare(
    `SELECT count(*) entities,
  sum(CASE WHEN length(tx_hash)<>32 OR vout<0 OR entity<>lower(hex(tx_hash))||':'||vout OR
    owner IS NULL OR owner='' THEN 1 ELSE 0 END) invalid_rows,
  count(DISTINCT tx_hash||':'||vout) distinct_outpoints
  FROM counterparty_utxo_watch`,
  )
  .get();
let invalidUtxoOwners = 0;
for (const row of db.prepare("SELECT owner FROM counterparty_utxo_watch GROUP BY owner").iterate()) {
  if (row.owner !== "unknown" && !isMainnetBitcoinAddress(row.owner) && !parseCounterpartyMultisigIdentity(row.owner)) {
    invalidUtxoOwners += 1;
  }
}
check(
  "counterparty_utxo_source_structure",
  Number(utxoSourceStructure.entities) > 0 &&
    Number(utxoSourceStructure.invalid_rows) === 0 &&
    Number(utxoSourceStructure.distinct_outpoints) === Number(utxoSourceStructure.entities) &&
    invalidUtxoOwners === 0,
  { ...utxoSourceStructure, invalid_owner_identities: invalidUtxoOwners },
);
const recomputedSourceFingerprints = {
  watched: sourceFingerprint(
    db.prepare("SELECT address_id,address FROM watched_address ORDER BY address_id"),
    (row) => `${row.address_id}\0${row.address}`,
  ),
  utxos: sourceFingerprint(
    db.prepare(
      "SELECT entity_id,entity,lower(hex(tx_hash)) tx_hash,vout,owner_address_id,owner FROM counterparty_utxo_watch ORDER BY entity_id",
    ),
    (row) =>
      `${row.entity_id}\0${row.entity}\0${row.tx_hash}\0${row.vout}\0${row.owner_address_id ?? "null"}\0${row.owner}`,
  ),
  transactions: sourceFingerprint(
    db.prepare(
      "SELECT lower(hex(tx_hash)) tx_hash,tx_index,expected_block_height FROM counterparty_tx_watch ORDER BY tx_hash",
    ),
    (row) => `${row.tx_hash}\0${row.tx_index ?? "null"}\0${row.expected_block_height ?? "null"}`,
  ),
};
check(
  "source_fingerprints",
  sourceHashMetadata.watched_source_sha256 === recomputedSourceFingerprints.watched.sha256 &&
    sourceHashMetadata.counterparty_utxo_source_sha256 === recomputedSourceFingerprints.utxos.sha256 &&
    sourceHashMetadata.counterparty_source_sha256 === recomputedSourceFingerprints.transactions.sha256 &&
    sourceMetadata.watched_source_count === recomputedSourceFingerprints.watched.count &&
    sourceMetadata.counterparty_utxo_source_count === recomputedSourceFingerprints.utxos.count &&
    sourceMetadata.counterparty_source_count === recomputedSourceFingerprints.transactions.count,
  { stored: sourceHashMetadata, recomputed: recomputedSourceFingerprints },
);
const sourceProvenanceValid =
  sourceMetadata.watched_source_count === sourceCounts.watched &&
  sourceMetadata.counterparty_source_count === sourceCounts.transactions &&
  sourceMetadata.counterparty_utxo_source_count === sourceCounts.utxos &&
  sourceMetadata.counterparty_source_remote_utxos === sourceCounts.utxos &&
  sourceMetadata.counterparty_source_remote_addresses === sourceCounts.watched &&
  sourceMetadata.counterparty_source_remote_transactions === sourceCounts.transactions &&
  sourceMetadata.counterparty_source_remote_height === sourceCounts.max_height &&
  Number.isSafeInteger(sourceMetadata.counterparty_source_chain_height) &&
  sourceMetadata.counterparty_source_chain_height >= sourceCounts.max_height &&
  sourceMetadata.counterparty_source_chain_height <= Number(blockchain.blocks) &&
  Number.isSafeInteger(sourceMetadata.counterparty_source_refreshed_at);
check(
  "authoritative_source_snapshot",
  sourceProvenanceValid,
  { metadata: sourceMetadata, actual: sourceCounts },
  { skipped: allowIncomplete },
);

if (scan) {
  check("policy_version", scan.policy_version === POLICY_VERSION, {
    actual: scan.policy_version,
    expected: POLICY_VERSION,
  });
  const canonicalCheckpoint = await rpc.call("getblockhash", [Number(scan.block_height)]);
  check("canonical_checkpoint", canonicalCheckpoint === scan.block_hash, {
    height: scan.block_height,
    stored: scan.block_hash,
    canonical: canonicalCheckpoint,
  });
  const firstMetric = db
    .prepare("SELECT min(block_height) first_height,max(block_height) last_height,count(*) rows FROM btc_block_metrics")
    .get();
  const expectedMetricRows = Number(scan.block_height) - Number(firstMetric.first_height) + 1;
  check(
    "contiguous_block_metrics",
    Number(firstMetric.rows) === expectedMetricRows && Number(firstMetric.last_height) === Number(scan.block_height),
    { ...firstMetric, expected_rows: expectedMetricRows },
  );
  const subsidyExpectations = [
    [0, 5_000_000_000],
    [209_999, 5_000_000_000],
    [210_000, 2_500_000_000],
    [420_000, 1_250_000_000],
    [630_000, 625_000_000],
    [840_000, 312_500_000],
  ].filter(([height]) => height >= Number(firstMetric.first_height) && height <= Number(firstMetric.last_height));
  const subsidySamples = subsidyExpectations.map(([height, expected]) => {
    const actual = Number(
      db.prepare("SELECT subsidy_sats FROM btc_block_metrics WHERE block_height=?").get(height)?.subsidy_sats,
    );
    return { height, expected, actual, passed: actual === expected };
  });
  check(
    "subsidy_schedule_samples",
    subsidySamples.every((item) => item.passed),
    subsidySamples,
    { skipped: subsidySamples.length === 0 },
  );
  const targetHeight = Number(
    db.prepare("SELECT value FROM index_metadata WHERE key='scan_target_height'").get()?.value ?? -1,
  );
  const targetHash = db.prepare("SELECT value FROM index_metadata WHERE key='scan_target_hash'").get()?.value ?? null;
  check("genesis_coverage", scanStartHeight === 0, { startHeight: scanStartHeight }, { skipped: allowIncomplete });
  const canonicalTargetHash =
    targetHeight >= 0 && targetHeight <= Number(blockchain.blocks)
      ? await rpc.call("getblockhash", [targetHeight])
      : null;
  check(
    "declared_target_complete",
    Number(scan.block_height) === targetHeight &&
      targetHash === canonicalTargetHash &&
      Number(blockchain.blocks) - targetHeight <= maxTipLag &&
      Number(blockchain.blocks) === Number(blockchain.headers) &&
      !blockchain.initialblockdownload,
    {
      scan_height: scan.block_height,
      target_height: targetHeight,
      target_hash: targetHash,
      canonical_target_hash: canonicalTargetHash,
      core_blocks: blockchain.blocks,
      core_headers: blockchain.headers,
      tip_lag: Number(blockchain.blocks) - targetHeight,
      max_tip_lag: maxTipLag,
      ibd: blockchain.initialblockdownload,
    },
    { skipped: allowIncomplete },
  );

  const sampleHeights = [
    ...new Set(
      [
        Number(firstMetric.first_height),
        1,
        100,
        91_842,
        91_880,
        210_000,
        278_319,
        420_000,
        630_000,
        840_000,
        Math.floor(Number(scan.block_height) / 2),
        Number(scan.block_height),
      ].filter((height) => height >= Number(firstMetric.first_height) && height <= Number(scan.block_height)),
    ),
  ];
  const canonicalSamples = [];
  for (const height of sampleHeights) {
    const stored = db
      .prepare("SELECT lower(hex(block_hash)) block_hash FROM btc_block_metrics WHERE block_height=?")
      .get(height)?.block_hash;
    const canonical = await rpc.call("getblockhash", [height]);
    canonicalSamples.push({ height, stored, canonical, passed: stored === canonical });
  }
  check(
    "canonical_block_samples",
    canonicalSamples.every((item) => item.passed),
    canonicalSamples,
  );

  const expectedFees = scalar(
    "SELECT count(*) FROM counterparty_tx_watch WHERE expected_block_height<=?",
    Number(scan.block_height),
  );
  const resolvedFees = scalar(
    "SELECT count(*) FROM counterparty_tx_fee WHERE block_height<=?",
    Number(scan.block_height),
  );
  const missingFees = scalar(
    `SELECT count(*) FROM counterparty_tx_watch watch
    LEFT JOIN counterparty_tx_fee fee ON fee.tx_hash=watch.tx_hash
    WHERE watch.expected_block_height<=? AND fee.tx_hash IS NULL`,
    Number(scan.block_height),
  );
  check(
    "counterparty_fee_coverage",
    resolvedFees === expectedFees && missingFees === 0,
    { expectedFees, resolvedFees, missingFees },
    { skipped: allowIncomplete },
  );
  const persistedFeeCoverage = db.prepare("SELECT * FROM fee_coverage WHERE singleton=1").get();
  const expectedThroughCheckpoint = scalar(
    "SELECT count(*) FROM counterparty_tx_watch WHERE expected_block_height<=?",
    scan?.block_height ?? -1,
  );
  const resolvedThroughCheckpoint = scalar(
    "SELECT count(*) FROM counterparty_tx_fee WHERE block_height<=?",
    scan?.block_height ?? -1,
  );
  const missingThroughCheckpoint = scalar(
    `SELECT count(*) FROM counterparty_tx_watch w
  LEFT JOIN counterparty_tx_fee f ON f.tx_hash=w.tx_hash
  WHERE w.expected_block_height<=? AND f.tx_hash IS NULL`,
    scan?.block_height ?? -1,
  );
  check(
    "persisted_fee_coverage",
    persistedFeeCoverage &&
      Number(persistedFeeCoverage.expected_transactions) === expectedThroughCheckpoint &&
      Number(persistedFeeCoverage.resolved_transactions) === resolvedThroughCheckpoint &&
      Number(persistedFeeCoverage.missing_transactions) === missingThroughCheckpoint &&
      Number(persistedFeeCoverage.source_height) === Number(scan?.block_height),
    {
      persisted: persistedFeeCoverage ?? null,
      derived: {
        expected_transactions: expectedThroughCheckpoint,
        resolved_transactions: resolvedThroughCheckpoint,
        missing_transactions: missingThroughCheckpoint,
        source_height: scan?.block_height ?? null,
      },
    },
    { skipped: allowIncomplete },
  );

  const counterpartyUtxoCoverage = db
    .prepare(
      `SELECT
  (SELECT count(*) FROM counterparty_utxo_watch) expected_entities,
  (SELECT count(*) FROM btc_counterparty_utxo) resolved_entities,
  (SELECT count(*) FROM counterparty_utxo_watch w LEFT JOIN btc_counterparty_utxo s USING(entity_id)
    WHERE s.entity_id IS NULL OR s.created_tx_id IS NULL OR s.value_sats IS NULL OR
      s.script_type IS NULL OR s.script_hash IS NULL OR s.resolved_owner IS NULL) missing_creations,
  (SELECT count(*) FROM counterparty_utxo_watch w JOIN btc_counterparty_utxo s USING(entity_id)
    JOIN btc_tx t ON t.tx_id=s.created_tx_id
    WHERE t.tx_hash<>w.tx_hash) creation_hash_mismatches,
  (SELECT count(*) FROM counterparty_utxo_watch w JOIN btc_counterparty_utxo s USING(entity_id)
    WHERE w.owner<>'unknown' AND w.owner<>s.resolved_owner) owner_mismatches,
  (SELECT count(*) FROM btc_counterparty_utxo
    WHERE (spent_by_tx_id IS NULL AND (spend_input_index IS NOT NULL OR spent_height IS NOT NULL)) OR
      (spent_by_tx_id IS NOT NULL AND (spend_input_index IS NULL OR spent_height IS NULL))) spend_state_mismatches
`,
    )
    .get();
  check(
    "counterparty_utxo_coverage",
    Number(counterpartyUtxoCoverage.expected_entities) > 0 &&
      Number(counterpartyUtxoCoverage.resolved_entities) === Number(counterpartyUtxoCoverage.expected_entities) &&
      Number(counterpartyUtxoCoverage.missing_creations) === 0 &&
      Number(counterpartyUtxoCoverage.creation_hash_mismatches) === 0 &&
      Number(counterpartyUtxoCoverage.owner_mismatches) === 0 &&
      Number(counterpartyUtxoCoverage.spend_state_mismatches) === 0,
    counterpartyUtxoCoverage,
    { skipped: allowIncomplete },
  );
}

const orphanChecks = {
  address_io_tx: scalar(
    "SELECT count(*) FROM btc_address_io io LEFT JOIN btc_tx tx ON tx.tx_id=io.tx_id WHERE tx.tx_id IS NULL",
  ),
  address_io_address: scalar(
    "SELECT count(*) FROM btc_address_io io LEFT JOIN watched_address a ON a.address_id=io.address_id WHERE a.address_id IS NULL",
  ),
  external_io_tx: scalar(
    "SELECT count(*) FROM btc_external_io io LEFT JOIN btc_tx tx ON tx.tx_id=io.tx_id WHERE tx.tx_id IS NULL",
  ),
  external_io_address: scalar(
    "SELECT count(*) FROM btc_external_io io LEFT JOIN btc_external_address a ON a.external_address_id=io.external_address_id WHERE a.external_address_id IS NULL",
  ),
  unknown_io_tx: scalar(
    "SELECT count(*) FROM btc_unknown_script_io io LEFT JOIN btc_tx tx ON tx.tx_id=io.tx_id WHERE tx.tx_id IS NULL",
  ),
  transaction_block: scalar(
    "SELECT count(*) FROM btc_tx tx LEFT JOIN btc_block_metrics b ON b.block_height=tx.block_height WHERE b.block_height IS NULL",
  ),
  watched_utxo_address: scalar(
    "SELECT count(*) FROM watched_utxo u LEFT JOIN watched_address a ON a.address_id=u.address_id WHERE a.address_id IS NULL",
  ),
  watched_utxo_tx: scalar(
    "SELECT count(*) FROM watched_utxo u LEFT JOIN btc_tx tx ON tx.tx_hash=u.tx_hash WHERE tx.tx_id IS NULL",
  ),
  address_stats_address: scalar(
    "SELECT count(*) FROM btc_address_stats s LEFT JOIN watched_address a ON a.address_id=s.address_id WHERE a.address_id IS NULL",
  ),
  direct_flow_tx: scalar(
    "SELECT count(*) FROM btc_direct_flow f LEFT JOIN btc_tx tx ON tx.tx_id=f.tx_id WHERE tx.tx_id IS NULL",
  ),
  direct_flow_payer: scalar(
    "SELECT count(*) FROM btc_direct_flow f LEFT JOIN watched_address a ON a.address_id=f.payer_id WHERE a.address_id IS NULL",
  ),
  direct_flow_payee: scalar(
    "SELECT count(*) FROM btc_direct_flow f LEFT JOIN watched_address a ON a.address_id=f.payee_id WHERE a.address_id IS NULL",
  ),
  recovery_parent_tx: scalar(
    "SELECT count(*) FROM btc_recovery_output r LEFT JOIN btc_tx tx ON tx.tx_hash=r.tx_hash WHERE tx.tx_id IS NULL",
  ),
  recovery_parent_not_counterparty: scalar(
    "SELECT count(*) FROM btc_recovery_output r JOIN btc_tx tx ON tx.tx_hash=r.tx_hash WHERE (tx.flags&2)=0",
  ),
  fee_parent_tx: scalar(
    "SELECT count(*) FROM counterparty_tx_fee f LEFT JOIN btc_tx tx ON tx.tx_hash=f.tx_hash WHERE tx.tx_id IS NULL",
  ),
  fee_parent_not_counterparty: scalar(
    "SELECT count(*) FROM counterparty_tx_fee f JOIN btc_tx tx ON tx.tx_hash=f.tx_hash WHERE (tx.flags&2)=0",
  ),
  counterparty_utxo_state_source: scalar(
    "SELECT count(*) FROM btc_counterparty_utxo s LEFT JOIN counterparty_utxo_watch w USING(entity_id) WHERE w.entity_id IS NULL",
  ),
  counterparty_utxo_created_tx: scalar(
    "SELECT count(*) FROM btc_counterparty_utxo s LEFT JOIN btc_tx tx ON tx.tx_id=s.created_tx_id WHERE s.created_tx_id IS NOT NULL AND tx.tx_id IS NULL",
  ),
  counterparty_utxo_spent_tx: scalar(
    "SELECT count(*) FROM btc_counterparty_utxo s LEFT JOIN btc_tx tx ON tx.tx_id=s.spent_by_tx_id WHERE s.spent_by_tx_id IS NOT NULL AND tx.tx_id IS NULL",
  ),
};
check(
  "no_orphan_rows",
  Object.values(orphanChecks).every((count) => count === 0),
  orphanChecks,
);

const ledgerInvariants = {
  invalid_block_totals: scalar(`SELECT count(*) FROM btc_block_metrics WHERE
    block_size_bytes<=0 OR block_weight<=0 OR transaction_count<=0 OR subsidy_sats<0 OR
    total_fee_sats<0 OR coinbase_output_sats<0 OR counterparty_transaction_count<0 OR
    counterparty_size_bytes<0 OR counterparty_weight<0 OR counterparty_fee_sats<0 OR
    counterparty_transaction_count>transaction_count OR counterparty_size_bytes>block_size_bytes OR
    counterparty_weight>block_weight OR counterparty_fee_sats>total_fee_sats OR
    coinbase_output_sats>subsidy_sats+total_fee_sats`),
  invalid_address_stats: scalar(`SELECT count(*) FROM btc_address_stats WHERE
    first_block>last_block OR input_txs<0 OR output_txs<0 OR sats_in<0 OR sats_out<0`),
  negative_io_values: scalar(`SELECT
    (SELECT count(*) FROM btc_address_io WHERE value_sats<0)+
    (SELECT count(*) FROM btc_external_io WHERE value_sats<0)+
    (SELECT count(*) FROM btc_unknown_script_io WHERE value_sats<0)`),
  invalid_recovery_spends: scalar(`SELECT count(*) FROM btc_recovery_output WHERE
    (classification='spent' AND (spent_by_tx_hash IS NULL OR spent_height IS NULL)) OR
    (spent_by_tx_hash IS NULL) IS NOT (spent_height IS NULL)`),
};
check(
  "ledger_value_invariants",
  Object.values(ledgerInvariants).every((count) => count === 0),
  ledgerInvariants,
);

const balanceMismatches = scalar(`WITH balances AS (
    SELECT address_id,sum(value_sats) balance_sats FROM watched_utxo GROUP BY address_id
  )
  SELECT count(*) FROM btc_address_stats stats LEFT JOIN balances USING(address_id)
  WHERE stats.sats_in-stats.sats_out IS NOT coalesce(balances.balance_sats,0)`);
check(
  "watched_balance_accounting",
  balanceMismatches === 0,
  { mismatched_addresses: balanceMismatches, scan_start_height: scanStartHeight },
  { skipped: allowIncomplete && scanStartHeight !== 0 },
);

const blockCountMismatches = scalar(`SELECT count(*) FROM btc_block_metrics block
  WHERE block.counterparty_transaction_count IS NOT coalesce((
    SELECT count(*) FROM btc_tx tx WHERE tx.block_height=block.block_height AND (tx.flags&2)<>0
  ),0)`);
const blockFeeMismatches = scalar(`SELECT count(*) FROM btc_block_metrics block
  WHERE block.counterparty_fee_sats IS NOT coalesce((
    SELECT sum(fee.fee_sats) FROM counterparty_tx_fee fee WHERE fee.block_height=block.block_height
  ),0)`);
check("counterparty_block_reconciliation", blockCountMismatches === 0 && blockFeeMismatches === 0, {
  transaction_count_mismatches: blockCountMismatches,
  fee_sum_mismatches: blockFeeMismatches,
});
const flowFlagMismatches = scalar(`WITH watched_counts AS MATERIALIZED (
    SELECT tx_id,
      count(DISTINCT CASE WHEN direction=0 THEN address_id END) payer_count,
      count(DISTINCT CASE WHEN direction=1 THEN address_id END) payee_count
    FROM btc_address_io GROUP BY tx_id
  ), external_input AS MATERIALIZED (
    SELECT tx_id FROM btc_external_io WHERE direction=0
    UNION SELECT tx_id FROM btc_unknown_script_io WHERE direction=0
  ), expected AS (
    SELECT flow.tx_id,flow.payer_id,flow.payee_id,
      (CASE WHEN counts.payer_count>1 THEN 1 ELSE 0 END) |
      (CASE WHEN counts.payee_count>1 THEN 2 ELSE 0 END) |
      (CASE WHEN flow.payer_id=flow.payee_id THEN 4 ELSE 0 END) |
      (CASE WHEN external.tx_id IS NOT NULL THEN 8 ELSE 0 END) flags
    FROM btc_direct_flow flow JOIN watched_counts counts USING(tx_id)
    LEFT JOIN external_input external USING(tx_id)
  )
  SELECT count(*) FROM expected JOIN btc_direct_flow flow USING(tx_id,payer_id,payee_id)
  WHERE expected.flags<>flow.attribution_flags`);
check("direct_flow_attribution_flags", flowFlagMismatches === 0, {
  mismatches: flowFlagMismatches,
  bits: { multi_watched_payer: 1, multi_watched_payee: 2, self: 4, external_or_unknown_input: 8 },
});

function sampleColumn(sql, column, fallback) {
  const values = db
    .prepare(sql)
    .all()
    .map((row) => row[column]);
  return values.length > 0 ? values : [fallback];
}
const sampleRows = {
  heights: sampleColumn(
    "SELECT block_height FROM btc_block_metrics ORDER BY block_height DESC LIMIT 100",
    "block_height",
    0,
  ),
  monthStarts: sampleColumn(
    `SELECT min(block_time) month_start FROM btc_block_metrics
    GROUP BY strftime('%Y-%m',block_time,'unixepoch') ORDER BY month_start DESC LIMIT 100`,
    "month_start",
    0,
  ),
  txHashes: sampleColumn("SELECT tx_hash FROM btc_tx ORDER BY tx_id DESC LIMIT 100", "tx_hash", Buffer.alloc(32)),
  feeHashes: sampleColumn(
    "SELECT tx_hash FROM counterparty_tx_fee ORDER BY block_height DESC,tx_hash LIMIT 100",
    "tx_hash",
    Buffer.alloc(32),
  ),
  addressIds: sampleColumn(
    `SELECT address_id FROM btc_address_stats
    ORDER BY input_txs+output_txs DESC,address_id LIMIT 100`,
    "address_id",
    0,
  ),
  externalAddressIds: sampleColumn(
    `SELECT external_address_id FROM btc_external_address
    ORDER BY external_address_id LIMIT 100`,
    "external_address_id",
    0,
  ),
  recoveryAddresses: sampleColumn(
    `SELECT recovery_address FROM btc_recovery_output
    WHERE recovery_address IS NOT NULL GROUP BY recovery_address
    ORDER BY max(block_height) DESC LIMIT 100`,
    "recovery_address",
    "",
  ),
  flowAddressIds: sampleColumn(
    `SELECT address_id FROM (
      SELECT payer_id AS address_id FROM btc_direct_flow
      UNION SELECT payee_id AS address_id FROM btc_direct_flow
    ) ORDER BY address_id DESC LIMIT 100`,
    "address_id",
    0,
  ),
  utxoOutpoints: (() => {
    const rows = db
      .prepare(
        `SELECT tx_hash,vout FROM counterparty_utxo_watch
      ORDER BY entity_id DESC LIMIT 100`,
      )
      .all();
    return rows.length > 0 ? rows.map((row) => [row.tx_hash, row.vout]) : [[Buffer.alloc(32), 0]];
  })(),
};
const operations = [
  {
    name: "block_by_height",
    query: db.prepare("SELECT * FROM btc_block_metrics WHERE block_height=?"),
    parameters: sampleRows.heights,
  },
  {
    name: "monthly_block_share",
    query: db.prepare(`SELECT count(*) blocks,sum(transaction_count) transactions,
      sum(counterparty_transaction_count) counterparty_transactions,sum(block_weight) weight,
      sum(counterparty_weight) counterparty_weight,sum(total_fee_sats) fees,
      sum(counterparty_fee_sats) counterparty_fees FROM btc_block_metrics
      WHERE block_time>=?1 AND block_time<?1+2678400`),
    parameters: sampleRows.monthStarts,
  },
  {
    name: "transaction_by_hash",
    query: db.prepare("SELECT * FROM btc_tx WHERE tx_hash=?"),
    parameters: sampleRows.txHashes,
  },
  {
    name: "fee_by_hash",
    query: db.prepare("SELECT * FROM counterparty_tx_fee WHERE tx_hash=?"),
    parameters: sampleRows.feeHashes,
  },
  {
    name: "active_address_history",
    query: db.prepare("SELECT * FROM btc_address_io WHERE address_id=? ORDER BY tx_id DESC LIMIT 100"),
    parameters: sampleRows.addressIds,
  },
  {
    name: "active_address_utxos",
    query: db.prepare("SELECT * FROM watched_utxo WHERE address_id=?"),
    parameters: sampleRows.addressIds,
  },
  {
    name: "external_address_history",
    query: db.prepare("SELECT * FROM btc_external_io WHERE external_address_id=? ORDER BY tx_id DESC LIMIT 100"),
    parameters: sampleRows.externalAddressIds,
  },
  {
    name: "recovery_by_address",
    query: db.prepare(
      "SELECT * FROM btc_recovery_output WHERE recovery_address=? ORDER BY classification,value_sats DESC LIMIT 100",
    ),
    parameters: sampleRows.recoveryAddresses,
  },
  {
    name: "direct_neighbors",
    query: db.prepare(`SELECT payee_id peer_id,value_sats,attribution_flags
      FROM btc_direct_flow WHERE payer_id=?1
      UNION ALL SELECT payer_id peer_id,value_sats,attribution_flags
      FROM btc_direct_flow WHERE payee_id=?1 LIMIT 100`),
    parameters: sampleRows.flowAddressIds,
  },
  {
    name: "counterparty_utxo_by_outpoint",
    query: db.prepare(`SELECT w.*,s.*
      FROM counterparty_utxo_watch w LEFT JOIN btc_counterparty_utxo s USING(entity_id)
      WHERE w.tx_hash=? AND w.vout=?`),
    parameters: sampleRows.utxoOutpoints,
  },
];
const operationLatency = {};
for (const operation of operations) {
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    const parameters = operation.parameters[index % operation.parameters.length];
    operation.query.all(...(Array.isArray(parameters) ? parameters : [parameters]));
    values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  const percentile = (fraction) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
  operationLatency[operation.name] = {
    samples: values.length,
    distinct_parameters: operation.parameters.length,
    p50_ms: Number(percentile(0.5).toFixed(3)),
    p95_ms: Number(percentile(0.95).toFixed(3)),
    max_ms: Number(values.at(-1).toFixed(3)),
  };
}
const slowestP95Ms = Math.max(...Object.values(operationLatency).map((item) => item.p95_ms));
check("point_lookup_latency", slowestP95Ms <= maxLookupMs, {
  lookup_samples_each: samples,
  slowest_p95_ms: slowestP95Ms,
  max_ms: maxLookupMs,
  operations: operationLatency,
});

db.close();
const walPath = `${databasePath}-wal`;
const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
const databaseSha256 = allowIncomplete ? null : await sha256File(databasePath);
check(
  "database_file_bound",
  walBytes === 0 && typeof databaseSha256 === "string" && databaseSha256.length === 64,
  { database_sha256: databaseSha256, database_bytes: statSync(databasePath).size, wal_bytes: walBytes },
  { skipped: allowIncomplete },
);

const result = {
  passed: failures.length === 0,
  mode: allowIncomplete ? "partial" : "production",
  database: databasePath,
  database_sha256: databaseSha256,
  database_bytes: statSync(databasePath).size,
  core: {
    blocks: blockchain.blocks,
    headers: blockchain.headers,
    best_block_hash: blockchain.bestblockhash,
    best_block_time: blockchain.time,
    tip_age_seconds: coreTipAgeSeconds,
    minimum_height: minimumHeight,
    initialblockdownload: blockchain.initialblockdownload,
  },
  scan,
  checks,
  failures,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
console.log(serialized.trimEnd());
if (proofPath && failures.length === 0) writeFileSync(resolve(proofPath), serialized, "utf8");
if (failures.length > 0) process.exitCode = 1;
