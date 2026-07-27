#!/usr/bin/env node

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RECOVERY_CLASSIFIER_VERSION,
  classifyRecovery,
  p2pkhAddress,
  parseBareMultisig,
  verifyCounterpartyLayout,
} from "../src/recovery/classifier.ts";
import { isMainnetBitcoinAddress, parseCounterpartyUtxoEntity } from "./lib/bitcoin-address.mjs";

const POLICY_VERSION = "counterparty-bitcoin-index-v6-compact-external";
const SATOSHIS = 100_000_000;
const TX_FLAG_WATCHED = 1;
const TX_FLAG_COUNTERPARTY = 2;
const TX_FLAG_COUNTERPARTY_UTXO = 4;
const TX_FLAG_EXTERNAL_OR_UNKNOWN_INPUT = 8;
const FLOW_MULTI_PAYER = 1;
const FLOW_MULTI_PAYEE = 2;
const FLOW_SELF = 4;
const FLOW_EXTERNAL_INPUT = 8;

const HELP = `Usage: node apps/api/ops/build-counterparty-bitcoin-index.mjs [options]

  --database=PATH          compact SQLite output
  --datadir=PATH           Bitcoin Core datadir (default C:\\BitcoinFastState)
  --cookie=PATH            override Core RPC cookie
  --rpc-url=URL            Core JSON-RPC URL
  --address-database=PATH  import watched address_dictionary rows
  --tx-database=PATH       import Counterparty transaction hashes
  --replace-tx-from-height=N  replace the authoritative transaction tail before import
  --start-height=N         first block for a new build
  --end-height=N           final block, default current validated Core height
  --block-verbosity=3      required full prevout/fee response
  --batch-size=N           RPC block batch size
  --commit-blocks=N        durable checkpoint interval
  --max-bytes=N            stop at a durable checkpoint above this size (default 10 GiB)
  --initialize-only        migrate/import/fingerprint without scanning
  --accept-source-update   permit source growth only before the first scan checkpoint
  --benchmark              persist batch size/throughput measurements
  --help                   print this text without opening a database or RPC`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function integerOption(name, fallback) {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid --${name}`);
  return value;
}

const datadir = resolve(option("datadir", "C:\\BitcoinFastState"));
const rpcUrl = option("rpc-url", "http://127.0.0.1:8332/");
const cookiePath = resolve(option("cookie", resolve(datadir, ".cookie")));
const databasePath = resolve(option("database", "D:\\Bitcoin\\counterparty-index\\counterparty-bitcoin.sqlite"));
const schemaPath = resolve(
  option("schema", new URL("./sql/counterparty-bitcoin-index.sql", import.meta.url).pathname.slice(1)),
);
const addressDatabase = option("address-database", "");
const txDatabase = option("tx-database", "");
const replaceTxFromHeight = integerOption("replace-tx-from-height", -1);
const requestedStartHeight = integerOption("start-height", 0);
const requestedEndHeight = integerOption("end-height", -1);
const batchSize = Math.max(1, integerOption("batch-size", 8));
const commitBlocks = Math.max(1, integerOption("commit-blocks", 100));
const blockVerbosity = integerOption("block-verbosity", 3);
const maximumBytes = integerOption("max-bytes", 10 * 1024 * 1024 * 1024);
if (maximumBytes < 1) throw new Error("Invalid --max-bytes");
const benchmark = process.argv.includes("--benchmark");
const initializeOnly = process.argv.includes("--initialize-only");
const acceptSourceUpdate = process.argv.includes("--accept-source-update");

function hashBlob(hex) {
  return Buffer.from(hex, "hex");
}

function btcToSats(value) {
  return Math.round(Number(value) * SATOSHIS);
}

function blockSubsidySats(height) {
  const halvings = Math.floor(height / 210_000);
  return halvings >= 64 ? 0 : Math.floor((50 * SATOSHIS) / 2 ** halvings);
}

function scriptAddress(scriptPubKey) {
  if (typeof scriptPubKey?.address === "string") return scriptPubKey.address;
  if (Array.isArray(scriptPubKey?.addresses) && scriptPubKey.addresses.length === 1) {
    return scriptPubKey.addresses[0];
  }
  return null;
}

function scriptFingerprint(scriptPubKey) {
  const scriptHex = typeof scriptPubKey?.hex === "string" ? scriptPubKey.hex : "";
  return createHash("sha256").update(Buffer.from(scriptHex, "hex")).digest();
}

function resolvedScriptOwner(scriptPubKey) {
  const address = scriptAddress(scriptPubKey);
  if (address) return address;
  if (typeof scriptPubKey?.hex !== "string") return "unknown";
  const parsed = parseBareMultisig(scriptPubKey.hex);
  if (!parsed) return "unknown";
  try {
    const members = parsed.keyDataHex.map((publicKey) => p2pkhAddress(publicKey)).sort();
    return `${parsed.requiredSignatures}_${members.join("_")}_${parsed.publicKeyCount}`;
  } catch {
    return "unknown";
  }
}

function databaseBytes(db) {
  const pageCount = Number(db.prepare("PRAGMA page_count").get().page_count);
  const pageSize = Number(db.prepare("PRAGMA page_size").get().page_size);
  return pageCount * pageSize;
}

class BitcoinRpc {
  constructor(cookiePath, url) {
    this.authorization = `Basic ${Buffer.from(readFileSync(cookiePath, "utf8").trim()).toString("base64")}`;
    this.url = url;
    this.nextId = 1;
  }

  async batch(calls) {
    const requests = calls.map(({ method, params = [] }) => ({
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    }));
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { Authorization: this.authorization, "Content-Type": "application/json" },
          body: JSON.stringify(requests),
        });
        if (!response.ok) throw new Error(`Bitcoin RPC HTTP ${response.status}`);
        const payload = await response.json();
        const byId = new Map(payload.map((item) => [item.id, item]));
        return requests.map(({ id }) => {
          const item = byId.get(id);
          if (!item) throw new Error(`Bitcoin RPC omitted response ${id}`);
          if (item.error) throw new Error(`${item.error.code}: ${item.error.message}`);
          return item.result;
        });
      } catch (error) {
        lastError = error;
        if (attempt === 7) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 500 * 2 ** attempt)));
      }
    }
    throw lastError;
  }

  async call(method, params = []) {
    return (await this.batch([{ method, params }]))[0];
  }
}

mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-524288;");
db.exec(readFileSync(schemaPath, "utf8"));

function ensureColumn(table, column, definition) {
  const columns = new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((item) => item.name),
  );
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("scan_benchmark", "external_address_rows", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("scan_benchmark", "external_io_rows", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("scan_benchmark", "unknown_script_io_rows", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("scan_benchmark", "recovery_output_rows", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("scan_benchmark", "recovery_spend_rows", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("counterparty_utxo_watch", "owner_address_id", "INTEGER");
ensureColumn("counterparty_utxo_watch", "owner", "TEXT");
ensureColumn("btc_counterparty_utxo", "resolved_owner", "TEXT");

const metadata = db.prepare(
  "INSERT INTO index_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
);
metadata.run("policy_version", POLICY_VERSION);
metadata.run("created_by", "apps/api/ops/build-counterparty-bitcoin-index.mjs");

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

function assertOrStoreSourceFingerprint(prefix, fingerprint) {
  const storedHash = db.prepare("SELECT value FROM index_metadata WHERE key=?").get(`${prefix}_sha256`)?.value;
  const storedCount = db.prepare("SELECT value FROM index_metadata WHERE key=?").get(`${prefix}_count`)?.value;
  if (storedHash && storedHash !== fingerprint.sha256 && !acceptSourceUpdate) {
    throw new Error(`${prefix} changed: stored ${storedHash}, current ${fingerprint.sha256}`);
  }
  if (storedCount && Number(storedCount) !== fingerprint.count && !acceptSourceUpdate) {
    throw new Error(`${prefix} count changed: stored ${storedCount}, current ${fingerprint.count}`);
  }
  metadata.run(`${prefix}_sha256`, fingerprint.sha256);
  metadata.run(`${prefix}_count`, String(fingerprint.count));
}

function importAddresses(sourcePath) {
  const escaped = resolve(sourcePath).replaceAll("'", "''");
  db.exec(`ATTACH DATABASE '${escaped}' AS source_addresses`);
  try {
    const before = Number(db.prepare("SELECT count(*) AS n FROM watched_address").get().n);
    const utxosBefore = Number(db.prepare("SELECT count(*) AS n FROM counterparty_utxo_watch").get().n);
    db.function("is_mainnet_bitcoin_address", (address) => (isMainnetBitcoinAddress(address) ? 1 : 0));
    db.exec(`
      INSERT OR IGNORE INTO watched_address(address_id,address)
      SELECT address_id,address
      FROM source_addresses.address_dictionary
      WHERE (address GLOB '1*' OR address GLOB '3*' OR address GLOB 'bc1*')
        AND is_mainnet_bitcoin_address(address)=1
    `);
    const removed = db.prepare("DELETE FROM watched_address WHERE is_mainnet_bitcoin_address(address)=0").run();
    const hasUtxoEntities =
      db
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM source_addresses.sqlite_master
      WHERE type='table' AND name='utxo_entities') present`,
        )
        .get().present === 1;
    if (hasUtxoEntities) {
      const insertUtxo = db.prepare(`INSERT OR REPLACE INTO counterparty_utxo_watch(
        entity_id,entity,tx_hash,vout,owner_address_id,owner) VALUES(?,?,?,?,?,?)`);
      for (const row of db
        .prepare(
          `SELECT entity_id,entity,tx_hash,vout,owner_address_id,owner
        FROM source_addresses.utxo_entities ORDER BY entity_id`,
        )
        .iterate()) {
        const parsed = parseCounterpartyUtxoEntity(row.entity);
        if (!parsed || parsed.txid !== String(row.tx_hash).toLowerCase() || parsed.vout !== Number(row.vout)) {
          throw new Error(`Malformed split Counterparty UTXO source row ${JSON.stringify(row)}`);
        }
        insertUtxo.run(
          row.entity_id,
          row.entity,
          Buffer.from(parsed.txid, "hex"),
          parsed.vout,
          row.owner_address_id,
          row.owner,
        );
      }
    }
    const after = Number(db.prepare("SELECT count(*) AS n FROM watched_address").get().n);
    const utxosAfter = Number(db.prepare("SELECT count(*) AS n FROM counterparty_utxo_watch").get().n);
    console.log(
      JSON.stringify({
        event: "address_import",
        before,
        after,
        added: after - before + Number(removed.changes),
        removedNonAddresses: Number(removed.changes),
        counterpartyUtxosBefore: utxosBefore,
        counterpartyUtxosAfter: utxosAfter,
        counterpartyUtxosAdded: utxosAfter - utxosBefore,
      }),
    );
  } finally {
    db.exec("DETACH DATABASE source_addresses");
  }
}

function importTransactionHashes(sourcePath) {
  const escaped = resolve(sourcePath).replaceAll("'", "''");
  db.exec(`ATTACH DATABASE '${escaped}' AS source_transactions`);
  try {
    const columns = db.prepare("PRAGMA source_transactions.table_info(transactions)").all();
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("tx_hash")) throw new Error("transactions table has no tx_hash column");
    const txIndex = names.has("tx_index") ? "tx_index" : "NULL";
    const blockHeight = names.has("block_index") ? "block_index" : "NULL";
    db.exec(`
      INSERT OR IGNORE INTO counterparty_tx_watch(tx_hash,tx_index,expected_block_height)
      SELECT unhex(tx_hash),${txIndex},${blockHeight}
      FROM source_transactions.transactions
      WHERE length(tx_hash)=64
    `);
    const count = Number(db.prepare("SELECT count(*) AS n FROM counterparty_tx_watch").get().n);
    console.log(JSON.stringify({ event: "transaction_hash_import", count }));
  } finally {
    db.exec("DETACH DATABASE source_transactions");
  }
}

function validateCounterpartySource() {
  const structural = db
    .prepare(
      `SELECT
    count(*) AS transactions,
    sum(CASE WHEN length(tx_hash)<>32 THEN 1 ELSE 0 END) AS malformed_hashes,
    sum(CASE WHEN tx_index IS NULL OR tx_index<0 THEN 1 ELSE 0 END) AS invalid_tx_indices,
    sum(CASE WHEN expected_block_height IS NULL OR expected_block_height<0 THEN 1 ELSE 0 END) AS invalid_block_heights,
    min(tx_index) AS min_tx_index,
    max(tx_index) AS max_tx_index,
    min(expected_block_height) AS min_block_height,
    max(expected_block_height) AS max_block_height
    FROM counterparty_tx_watch`,
    )
    .get();
  const duplicateTxIndices = Number(
    db
      .prepare(
        `SELECT count(*) AS n FROM (
    SELECT tx_index FROM counterparty_tx_watch
    WHERE tx_index IS NOT NULL
    GROUP BY tx_index HAVING count(*)<>1
  )`,
      )
      .get().n,
  );
  const result = {
    transactions: Number(structural.transactions),
    malformedHashes: Number(structural.malformed_hashes),
    invalidTxIndices: Number(structural.invalid_tx_indices),
    invalidBlockHeights: Number(structural.invalid_block_heights),
    duplicateTxIndices,
    txIndexRange:
      structural.min_tx_index == null ? null : [Number(structural.min_tx_index), Number(structural.max_tx_index)],
    blockHeightRange:
      structural.min_block_height == null
        ? null
        : [Number(structural.min_block_height), Number(structural.max_block_height)],
  };
  if (
    result.transactions === 0 ||
    result.malformedHashes !== 0 ||
    result.invalidTxIndices !== 0 ||
    result.invalidBlockHeights !== 0 ||
    result.duplicateTxIndices !== 0
  ) {
    throw new Error(`Invalid Counterparty transaction source: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ event: "counterparty_source_validated", ...result }));
  return result;
}

const hasStoredSourceFingerprint =
  db
    .prepare(
      `SELECT EXISTS(
  SELECT 1 FROM index_metadata WHERE key IN ('watched_source_sha256','counterparty_source_sha256')
) present`,
    )
    .get().present === 1;
const hasScanCheckpoint = db.prepare("SELECT EXISTS(SELECT 1 FROM scan_state) present").get().present === 1;
if ((addressDatabase || txDatabase) && hasStoredSourceFingerprint && !acceptSourceUpdate) {
  throw new Error("Refusing to mutate fingerprinted sources without --accept-source-update");
}
if (acceptSourceUpdate && hasScanCheckpoint) {
  throw new Error("Refusing source update after a scan checkpoint exists; rebuild from a fresh database");
}
if (replaceTxFromHeight >= 0) {
  if (!acceptSourceUpdate || !txDatabase) {
    throw new Error("--replace-tx-from-height requires --accept-source-update and --tx-database");
  }
  const removed = db
    .prepare("DELETE FROM counterparty_tx_watch WHERE expected_block_height>=?")
    .run(replaceTxFromHeight);
  console.log(
    JSON.stringify({
      event: "transaction_tail_reset",
      fromHeight: replaceTxFromHeight,
      removed: Number(removed.changes),
    }),
  );
}
if (addressDatabase) importAddresses(addressDatabase);
if (txDatabase) importTransactionHashes(txDatabase);
validateCounterpartySource();

const watchedSource = sourceFingerprint(
  db.prepare("SELECT address_id,address FROM watched_address ORDER BY address_id"),
  (row) => `${row.address_id}\0${row.address}`,
);
const counterpartyUtxoSource = sourceFingerprint(
  db.prepare(
    "SELECT entity_id,entity,lower(hex(tx_hash)) tx_hash,vout,owner_address_id,owner FROM counterparty_utxo_watch ORDER BY entity_id",
  ),
  (row) =>
    `${row.entity_id}\0${row.entity}\0${row.tx_hash}\0${row.vout}\0${row.owner_address_id ?? "null"}\0${row.owner}`,
);
const counterpartySource = sourceFingerprint(
  db.prepare(
    "SELECT lower(hex(tx_hash)) AS tx_hash,tx_index,expected_block_height FROM counterparty_tx_watch ORDER BY tx_hash",
  ),
  (row) => `${row.tx_hash}\0${row.tx_index ?? "null"}\0${row.expected_block_height ?? "null"}`,
);
assertOrStoreSourceFingerprint("watched_source", watchedSource);
assertOrStoreSourceFingerprint("counterparty_utxo_source", counterpartyUtxoSource);
assertOrStoreSourceFingerprint("counterparty_source", counterpartySource);

const watchedRows = db.prepare("SELECT address_id,address FROM watched_address").all();
const watched = new Map(watchedRows.map((row) => [row.address, Number(row.address_id)]));
const counterpartyCount = Number(db.prepare("SELECT count(*) AS n FROM counterparty_tx_watch").get().n);
const findCounterpartyBatch = db.prepare(`
  SELECT lower(hex(tx_hash)) AS tx_hash
  FROM counterparty_tx_watch
  WHERE expected_block_height BETWEEN ? AND ?
`);
let currentCounterpartyHashes = new Set();

function isCounterpartyHash(txid) {
  return currentCounterpartyHashes.has(txid);
}

function counterpartySourceHash(tx) {
  if (currentCounterpartyHashes.has(tx.txid)) return tx.txid;
  if (typeof tx.hash === "string" && currentCounterpartyHashes.has(tx.hash)) return tx.hash;
  return null;
}

console.log(
  JSON.stringify({
    event: "initialized",
    databasePath,
    watchedAddresses: watched.size,
    watchedSourceSha256: watchedSource.sha256,
    counterpartyUtxos: counterpartyUtxoSource.count,
    counterpartyUtxoSourceSha256: counterpartyUtxoSource.sha256,
    counterpartyTransactions: counterpartyCount,
    counterpartySourceSha256: counterpartySource.sha256,
    databaseBytes: databaseBytes(db),
  }),
);

if (initializeOnly) {
  db.close();
  process.exit(0);
}

if (!existsSync(cookiePath)) throw new Error(`Missing RPC cookie ${cookiePath}`);
const rpc = new BitcoinRpc(cookiePath, rpcUrl);
const blockchain = await rpc.call("getblockchaininfo");
if (blockVerbosity < 3) {
  throw new Error("--block-verbosity=3 is required for complete input prevouts and address attribution");
}
const savedScan = db
  .prepare(
    `
  SELECT block_height,lower(hex(block_hash)) AS block_hash,policy_version
  FROM scan_state WHERE singleton=1
`,
  )
  .get();
if (savedScan && savedScan.policy_version !== POLICY_VERSION) {
  throw new Error(`Refusing to resume ${savedScan.policy_version} checkpoint under ${POLICY_VERSION}`);
}
if (savedScan) {
  const canonicalCheckpointHash = await rpc.call("getblockhash", [Number(savedScan.block_height)]);
  if (canonicalCheckpointHash !== savedScan.block_hash) {
    throw new Error(
      `Checkpoint reorg at ${savedScan.block_height}: stored ${savedScan.block_hash}, canonical ${canonicalCheckpointHash}`,
    );
  }
}
const startHeight = Math.max(requestedStartHeight, savedScan ? Number(savedScan.block_height) + 1 : 0);
const endHeight =
  requestedEndHeight < 0 ? Number(blockchain.blocks) : Math.min(requestedEndHeight, Number(blockchain.blocks));
if (endHeight < startHeight) throw new Error(`End height ${endHeight} precedes start height ${startHeight}`);
if (!savedScan) metadata.run("scan_start_height", String(startHeight));
const targetHash =
  endHeight === Number(blockchain.blocks) ? blockchain.bestblockhash : await rpc.call("getblockhash", [endHeight]);
metadata.run("scan_target_height", String(endHeight));
metadata.run("scan_target_hash", targetHash);

const insertTx = db.prepare(`
  INSERT INTO btc_tx(tx_hash,block_height,tx_position,block_time,fee_sats,flags)
  VALUES(?,?,?,?,?,?)
  ON CONFLICT(tx_hash) DO UPDATE SET
    block_height=excluded.block_height, tx_position=excluded.tx_position,
    block_time=excluded.block_time, fee_sats=excluded.fee_sats,
    flags=(btc_tx.flags | excluded.flags)
  RETURNING tx_id
`);
const insertIo = db.prepare(
  "INSERT OR REPLACE INTO btc_address_io(address_id,tx_id,direction,io_index,value_sats) VALUES(?,?,?,?,?)",
);
const insertExternalAddress = db.prepare("INSERT OR IGNORE INTO btc_external_address(address) VALUES(?)");
const findExternalAddress = db.prepare("SELECT external_address_id FROM btc_external_address WHERE address=?");
const insertExternalIo = db.prepare(
  "INSERT OR REPLACE INTO btc_external_io(external_address_id,tx_id,direction,io_index,value_sats) VALUES(?,?,?,?,?)",
);
const upsertExternalSummary = db.prepare(`
  INSERT INTO btc_external_summary(
    address,transaction_count,input_rows,output_rows,input_sats,output_sats,first_tx_id,last_tx_id
  ) VALUES(?,1,?,?,?,?,?,?)
  ON CONFLICT(address) DO UPDATE SET
    transaction_count=btc_external_summary.transaction_count+1,
    input_rows=btc_external_summary.input_rows+excluded.input_rows,
    output_rows=btc_external_summary.output_rows+excluded.output_rows,
    input_sats=btc_external_summary.input_sats+excluded.input_sats,
    output_sats=btc_external_summary.output_sats+excluded.output_sats,
    first_tx_id=min(btc_external_summary.first_tx_id,excluded.first_tx_id),
    last_tx_id=max(btc_external_summary.last_tx_id,excluded.last_tx_id)
`);
const isExternalEventWatched = db.prepare("SELECT 1 FROM btc_external_event_watch WHERE tx_hash=?");
const insertUnknownIo = db.prepare(
  "INSERT OR REPLACE INTO btc_unknown_script_io(tx_id,direction,io_index,script_type,script_hash,value_sats) VALUES(?,?,?,?,?,?)",
);
const insertRecoveryOutput = db.prepare(`
  INSERT INTO btc_recovery_output(
    tx_hash,vout,value_sats,script_pubkey_hex,layout,recovery_key_hex,
    recovery_key_position,recovery_address,classification,reason,block_height,
    block_time,spent_by_tx_hash,spent_height,classifier_version
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)
  ON CONFLICT(tx_hash,vout) DO UPDATE SET
    value_sats=excluded.value_sats,script_pubkey_hex=excluded.script_pubkey_hex,
    layout=excluded.layout,recovery_key_hex=excluded.recovery_key_hex,
    recovery_key_position=excluded.recovery_key_position,recovery_address=excluded.recovery_address,
    classification=CASE WHEN btc_recovery_output.spent_by_tx_hash IS NOT NULL AND excluded.classification='recoverable' THEN 'spent' ELSE excluded.classification END,
    reason=CASE WHEN btc_recovery_output.spent_by_tx_hash IS NOT NULL AND excluded.classification='recoverable' THEN 'verified-output-already-spent' ELSE excluded.reason END,
    block_height=excluded.block_height,block_time=excluded.block_time,
    classifier_version=excluded.classifier_version
`);
const markRecoverySpent = db.prepare(`
  UPDATE btc_recovery_output SET
    spent_by_tx_hash=?,spent_height=?,
    classification=CASE WHEN classification IN ('recoverable','spent') THEN 'spent' ELSE classification END,
    reason=CASE WHEN classification IN ('recoverable','spent') THEN 'verified-output-already-spent' ELSE reason END
  WHERE tx_hash=? AND vout=?
`);
const insertFlow = db.prepare(
  "INSERT OR REPLACE INTO btc_direct_flow(tx_id,payer_id,payee_id,value_sats,payer_input_count,payee_output_count,attribution_flags) VALUES(?,?,?,?,?,?,?)",
);
const insertWatchedUtxo = db.prepare(
  "INSERT OR IGNORE INTO watched_utxo(tx_hash,vout,address_id,value_sats) VALUES(?,?,?,?)",
);
const deleteWatchedUtxo = db.prepare("DELETE FROM watched_utxo WHERE tx_hash=? AND vout=? AND address_id=?");
const insertFee = db.prepare(
  "INSERT OR REPLACE INTO counterparty_tx_fee(tx_hash,block_height,fee_sats,published_at) VALUES(?,?,?,NULL)",
);
const insertCounterpartyUtxoCreation = db.prepare(`INSERT INTO btc_counterparty_utxo(
  entity_id,created_tx_id,value_sats,script_type,script_hash,resolved_owner
) VALUES(?,?,?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET
  created_tx_id=excluded.created_tx_id,value_sats=excluded.value_sats,
  script_type=excluded.script_type,script_hash=excluded.script_hash,resolved_owner=excluded.resolved_owner`);
const markCounterpartyUtxoSpent = db.prepare(`INSERT INTO btc_counterparty_utxo(
  entity_id,spent_by_tx_id,spend_input_index,spent_height
) VALUES(?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET
  spent_by_tx_id=excluded.spent_by_tx_id,spend_input_index=excluded.spend_input_index,
  spent_height=excluded.spent_height`);
const upsertStats = db.prepare(`
  INSERT INTO btc_address_stats(address_id,first_block,last_block,input_txs,output_txs,sats_in,sats_out)
  VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(address_id) DO UPDATE SET
    first_block=min(first_block,excluded.first_block), last_block=max(last_block,excluded.last_block),
    input_txs=input_txs+excluded.input_txs, output_txs=output_txs+excluded.output_txs,
    sats_in=sats_in+excluded.sats_in, sats_out=sats_out+excluded.sats_out
`);
const upsertMonthlyStats = db.prepare(`
  INSERT INTO btc_address_monthly_stats(
    address_id,month_start,input_txs,output_txs,sats_in,sats_out
  ) VALUES(?,?,?,?,?,?)
  ON CONFLICT(address_id,month_start) DO UPDATE SET
    input_txs=input_txs+excluded.input_txs,
    output_txs=output_txs+excluded.output_txs,
    sats_in=sats_in+excluded.sats_in,
    sats_out=sats_out+excluded.sats_out
`);
const checkpoint = db.prepare(`
  INSERT INTO scan_state(singleton,block_height,block_hash,policy_version,completed_at)
  VALUES(1,?,?,?,?)
  ON CONFLICT(singleton) DO UPDATE SET block_height=excluded.block_height,
    block_hash=excluded.block_hash, policy_version=excluded.policy_version, completed_at=excluded.completed_at
`);
const insertBlockMetrics = db.prepare(`
  INSERT INTO btc_block_metrics(
    block_height,block_hash,block_time,block_size_bytes,block_weight,
    transaction_count,subsidy_sats,total_fee_sats,coinbase_output_sats,
    counterparty_transaction_count,counterparty_size_bytes,
    counterparty_weight,counterparty_fee_sats
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(block_height) DO UPDATE SET
    block_hash=excluded.block_hash, block_time=excluded.block_time,
    block_size_bytes=excluded.block_size_bytes, block_weight=excluded.block_weight,
    transaction_count=excluded.transaction_count, subsidy_sats=excluded.subsidy_sats,
    total_fee_sats=excluded.total_fee_sats, coinbase_output_sats=excluded.coinbase_output_sats,
    counterparty_transaction_count=excluded.counterparty_transaction_count,
    counterparty_size_bytes=excluded.counterparty_size_bytes,
    counterparty_weight=excluded.counterparty_weight,
    counterparty_fee_sats=excluded.counterparty_fee_sats
`);
const recordFailure = db.prepare(`
  INSERT INTO scan_failure(block_height,tx_hash,stage,error,attempts,resolved_at)
  VALUES(?,?,?,?,1,NULL)
  ON CONFLICT(block_height,tx_hash,stage) DO UPDATE SET
    error=excluded.error,attempts=scan_failure.attempts+1,resolved_at=NULL
`);
const resolveBlockFailures = db.prepare(`
  UPDATE scan_failure SET resolved_at=?
  WHERE block_height=? AND resolved_at IS NULL
`);
const writeFeeCoverage = db.prepare(`
  INSERT INTO fee_coverage(singleton,expected_transactions,resolved_transactions,
    missing_transactions,source_height,checked_at)
  VALUES(1,?,?,?,?,?)
  ON CONFLICT(singleton) DO UPDATE SET
    expected_transactions=excluded.expected_transactions,
    resolved_transactions=excluded.resolved_transactions,
    missing_transactions=excluded.missing_transactions,
    source_height=excluded.source_height,checked_at=excluded.checked_at
`);

function outpointKey(txid, vout) {
  return `${txid}:${vout}`;
}

// Avoid one SQLite lookup for every ordinary Bitcoin input. These maps contain only the bounded
// watched/recovery UTXO sets and are reconstructed from durable tables on every resume.
const watchedUtxoByOutpoint = new Map();
for (const row of db
  .prepare(`SELECT lower(hex(tx_hash)) txid,vout,address_id,value_sats FROM watched_utxo`)
  .iterate()) {
  const key = outpointKey(row.txid, row.vout);
  const entries = watchedUtxoByOutpoint.get(key) ?? [];
  entries.push({ address_id: Number(row.address_id), value_sats: Number(row.value_sats) });
  watchedUtxoByOutpoint.set(key, entries);
}
const unspentRecoveryOutpoints = new Set();
for (const row of db
  .prepare(`SELECT lower(hex(tx_hash)) txid,vout FROM btc_recovery_output WHERE spent_by_tx_hash IS NULL`)
  .iterate()) {
  unspentRecoveryOutpoints.add(outpointKey(row.txid, row.vout));
}
const counterpartyUtxoByOutpoint = new Map();
const counterpartyUtxosByTxid = new Map();
for (const row of db
  .prepare(`SELECT entity_id,lower(hex(tx_hash)) txid,vout,owner FROM counterparty_utxo_watch`)
  .iterate()) {
  const item = { entityId: Number(row.entity_id), txid: row.txid, vout: Number(row.vout), owner: row.owner };
  counterpartyUtxoByOutpoint.set(outpointKey(item.txid, item.vout), item);
  const outputs = counterpartyUtxosByTxid.get(item.txid) ?? [];
  outputs.push(item);
  counterpartyUtxosByTxid.set(item.txid, outputs);
}
console.log(
  JSON.stringify({
    event: "resume_state",
    watchedUtxoOutpoints: watchedUtxoByOutpoint.size,
    unspentRecoveryOutpoints: unspentRecoveryOutpoints.size,
    counterpartyUtxoEntities: counterpartyUtxoByOutpoint.size,
    rssBytes: process.memoryUsage().rss,
  }),
);

const totals = {
  blocks: 0,
  transactions: 0,
  relevantTransactions: 0,
  detailedTransactions: 0,
  aggregatedOnlyTransactions: 0,
  addressIoRows: 0,
  feeMatches: 0,
  externalAddressRows: 0,
  externalIoRows: 0,
  externalSummaryRows: 0,
  selectedExternalTransactions: 0,
  unknownScriptIoRows: 0,
  recoveryOutputs: 0,
  recoverySpends: 0,
  counterpartyUtxoCreates: 0,
  counterpartyUtxoSpends: 0,
};
const phaseMs = { counterpartyLookup: 0, blockHashesRpc: 0, blocksRpc: 0, processing: 0, commit: 0 };
const startedAt = Date.now();
let sizeWarningLevel = 0;
let transactionOpen = false;
let activeHeight = startHeight;
let activeTxHash = null;
let activeStage = "rpc_batch";
const externalAddressCache = new Map();
const EXTERNAL_CACHE_LIMIT = 200_000;

function externalAddressId(address) {
  const cached = externalAddressCache.get(address);
  if (cached !== undefined) return cached;
  const inserted = insertExternalAddress.run(address);
  if (Number(inserted.changes) > 0) totals.externalAddressRows += 1;
  const id = Number(findExternalAddress.get(address).external_address_id);
  externalAddressCache.set(address, id);
  if (externalAddressCache.size > EXTERNAL_CACHE_LIMIT) {
    externalAddressCache.delete(externalAddressCache.keys().next().value);
  }
  return id;
}

function begin() {
  if (!transactionOpen) {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
  }
}

function commit() {
  if (transactionOpen) {
    db.exec("COMMIT");
    transactionOpen = false;
  }
}

function processBlock(block) {
  activeHeight = Number(block.height);
  activeTxHash = null;
  activeStage = "process_block";
  totals.blocks += 1;
  let totalFeeSats = 0;
  let counterpartyTransactionCount = 0;
  let counterpartySizeBytes = 0;
  let counterpartyWeight = 0;
  let counterpartyFeeSats = 0;
  for (let position = 0; position < block.tx.length; position += 1) {
    const tx = block.tx[position];
    activeTxHash = tx.txid;
    activeStage = "process_transaction";
    totals.transactions += 1;
    const txFeeSats = tx.fee === undefined ? 0 : btcToSats(tx.fee);
    totalFeeSats += txFeeSats;
    for (const input of tx.vin) {
      if (typeof input.txid !== "string" || !Number.isInteger(input.vout)) continue;
      const key = outpointKey(input.txid, input.vout);
      if (unspentRecoveryOutpoints.has(key)) {
        const spent = markRecoverySpent.run(hashBlob(tx.txid), block.height, hashBlob(input.txid), input.vout);
        totals.recoverySpends += Number(spent.changes);
        if (Number(spent.changes) > 0) unspentRecoveryOutpoints.delete(key);
      }
    }
    const allInputs = [];
    const allOutputs = [];
    const unknownInputs = [];
    const unknownOutputs = [];
    const counterpartyUtxoInputs = [];
    for (let index = 0; index < tx.vin.length; index += 1) {
      const input = tx.vin[index];
      if (typeof input.txid === "string" && Number.isInteger(input.vout)) {
        const entity = counterpartyUtxoByOutpoint.get(outpointKey(input.txid, input.vout));
        if (entity) counterpartyUtxoInputs.push({ ...entity, inputIndex: index });
      }
      const prevout = input.prevout;
      const address = scriptAddress(prevout?.scriptPubKey);
      if (address && prevout?.value !== undefined) {
        allInputs.push({ address, addressId: watched.get(address), index, value: btcToSats(prevout.value) });
      } else if (prevout?.scriptPubKey && prevout?.value !== undefined) {
        unknownInputs.push({ index, scriptPubKey: prevout.scriptPubKey, value: btcToSats(prevout.value) });
      }
      if (
        (!address || watched.get(address) === undefined) &&
        typeof input.txid === "string" &&
        Number.isInteger(input.vout)
      ) {
        for (const row of watchedUtxoByOutpoint.get(outpointKey(input.txid, input.vout)) ?? []) {
          allInputs.push({ address: null, addressId: Number(row.address_id), index, value: Number(row.value_sats) });
        }
      }
    }
    for (let index = 0; index < tx.vout.length; index += 1) {
      const output = tx.vout[index];
      const address = scriptAddress(output.scriptPubKey);
      if (address) {
        allOutputs.push({ address, addressId: watched.get(address), index, value: btcToSats(output.value) });
      } else {
        unknownOutputs.push({ index, scriptPubKey: output.scriptPubKey, value: btcToSats(output.value) });
      }
    }
    const inputs = allInputs.filter((item) => item.addressId !== undefined);
    const outputs = allOutputs.filter((item) => item.addressId !== undefined);
    const counterpartyUtxoOutputs = (counterpartyUtxosByTxid.get(tx.txid) ?? []).filter(
      (item) => item.vout < tx.vout.length,
    );
    const counterpartyHash = counterpartySourceHash(tx);
    const isCounterparty = counterpartyHash !== null;
    if (isCounterparty) {
      counterpartyTransactionCount += 1;
      counterpartySizeBytes += Number(tx.size);
      counterpartyWeight += Number(tx.weight);
      counterpartyFeeSats += txFeeSats;
      const firstInputTxid = tx.vin.find((input) => typeof input.txid === "string")?.txid;
      for (let vout = 0; vout < tx.vout.length; vout += 1) {
        const output = tx.vout[vout];
        const scriptPubkeyHex = output.scriptPubKey?.hex;
        if (typeof scriptPubkeyHex !== "string") continue;
        const parsed = parseBareMultisig(scriptPubkeyHex);
        if (!parsed || parsed.requiredSignatures !== 1 || (parsed.publicKeyCount !== 2 && parsed.publicKeyCount !== 3))
          continue;
        const structuralLayout = parsed.publicKeyCount === 2 ? "historical-1-of-2" : "current-1-of-3";
        const verifiedLayout = verifyCounterpartyLayout(parsed, firstInputTxid);
        const recoveryKeyPosition = verifiedLayout ? (verifiedLayout === "historical-1-of-2" ? 0 : 2) : null;
        const recoveryKeyHex = recoveryKeyPosition === null ? null : parsed.keyDataHex[recoveryKeyPosition];
        const recoveryAddress = recoveryKeyHex ? p2pkhAddress(recoveryKeyHex) : null;
        const decision = recoveryAddress
          ? classifyRecovery({ scriptPubkeyHex, firstInputTxid, expectedAddress: recoveryAddress })
          : { classification: "unverified", reason: "counterparty-provenance-not-verified" };
        insertRecoveryOutput.run(
          hashBlob(tx.txid),
          vout,
          btcToSats(output.value),
          scriptPubkeyHex,
          structuralLayout,
          recoveryKeyHex,
          recoveryKeyPosition,
          recoveryAddress,
          decision.classification,
          decision.reason,
          block.height,
          block.time,
          RECOVERY_CLASSIFIER_VERSION,
        );
        unspentRecoveryOutpoints.add(outpointKey(tx.txid, vout));
        totals.recoveryOutputs += 1;
      }
    }
    if (
      inputs.length === 0 &&
      outputs.length === 0 &&
      !isCounterparty &&
      counterpartyUtxoInputs.length === 0 &&
      counterpartyUtxoOutputs.length === 0
    )
      continue;
    const feeSats = tx.fee === undefined ? null : btcToSats(tx.fee);
    const distinctWatchedAddresses = new Set([
      ...inputs.map((item) => item.addressId),
      ...outputs.map((item) => item.addressId),
    ]);
    const preserveExternalEvents = Boolean(isExternalEventWatched.get(hashBlob(tx.txid)));
    const retainDetailedEvent =
      isCounterparty ||
      counterpartyUtxoInputs.length > 0 ||
      counterpartyUtxoOutputs.length > 0 ||
      distinctWatchedAddresses.size > 1 ||
      preserveExternalEvents;
    const hasExternalInput = allInputs.some((item) => item.addressId === undefined) || unknownInputs.length > 0;
    const flags =
      (inputs.length || outputs.length ? TX_FLAG_WATCHED : 0) |
      (isCounterparty ? TX_FLAG_COUNTERPARTY : 0) |
      (counterpartyUtxoInputs.length || counterpartyUtxoOutputs.length ? TX_FLAG_COUNTERPARTY_UTXO : 0) |
      (hasExternalInput ? TX_FLAG_EXTERNAL_OR_UNKNOWN_INPUT : 0);
    totals.relevantTransactions += 1;
    if (retainDetailedEvent) totals.detailedTransactions += 1;
    else totals.aggregatedOnlyTransactions += 1;
    const txId = retainDetailedEvent
      ? Number(insertTx.get(hashBlob(tx.txid), block.height, position, block.time, feeSats, flags).tx_id)
      : null;
    for (const item of counterpartyUtxoOutputs) {
      const output = tx.vout[item.vout];
      const resolvedOwner = resolvedScriptOwner(output.scriptPubKey);
      if (item.owner !== "unknown" && resolvedOwner !== item.owner) {
        throw new Error(
          `Counterparty UTXO owner mismatch for ${tx.txid}:${item.vout}: source=${item.owner} bitcoin=${resolvedOwner}`,
        );
      }
      insertCounterpartyUtxoCreation.run(
        item.entityId,
        txId,
        btcToSats(output.value),
        output.scriptPubKey?.type ?? "unknown",
        scriptFingerprint(output.scriptPubKey ?? {}),
        resolvedOwner,
      );
      totals.counterpartyUtxoCreates += 1;
    }
    for (const item of counterpartyUtxoInputs) {
      markCounterpartyUtxoSpent.run(item.entityId, txId, item.inputIndex, block.height);
      totals.counterpartyUtxoSpends += 1;
    }
    if (preserveExternalEvents) {
      const externalByAddress = new Map();
      for (const item of allInputs) {
        if (!item.address || item.addressId !== undefined) continue;
        const aggregate = externalByAddress.get(item.address) ?? {
          inputRows: 0,
          outputRows: 0,
          inputSats: 0,
          outputSats: 0,
        };
        aggregate.inputRows += 1;
        aggregate.inputSats += item.value;
        externalByAddress.set(item.address, aggregate);
      }
      for (const item of allOutputs) {
        if (!item.address || item.addressId !== undefined) continue;
        const aggregate = externalByAddress.get(item.address) ?? {
          inputRows: 0,
          outputRows: 0,
          inputSats: 0,
          outputSats: 0,
        };
        aggregate.outputRows += 1;
        aggregate.outputSats += item.value;
        externalByAddress.set(item.address, aggregate);
      }
      for (const [address, aggregate] of externalByAddress) {
        upsertExternalSummary.run(
          address,
          aggregate.inputRows,
          aggregate.outputRows,
          aggregate.inputSats,
          aggregate.outputSats,
          txId,
          txId,
        );
        totals.externalSummaryRows += 1;
      }
    }
    if (preserveExternalEvents) {
      totals.selectedExternalTransactions += 1;
      for (const item of allInputs) {
        if (!item.address || item.addressId !== undefined) continue;
        insertExternalIo.run(externalAddressId(item.address), txId, 0, item.index, item.value);
        totals.externalIoRows += 1;
      }
      for (const item of allOutputs) {
        if (!item.address || item.addressId !== undefined) continue;
        insertExternalIo.run(externalAddressId(item.address), txId, 1, item.index, item.value);
        totals.externalIoRows += 1;
      }
    }
    if (retainDetailedEvent) {
      for (const item of [
        ...unknownInputs.map((value) => ({ ...value, direction: 0 })),
        ...unknownOutputs.map((value) => ({ ...value, direction: 1 })),
      ]) {
        insertUnknownIo.run(
          txId,
          item.direction,
          item.index,
          item.scriptPubKey.type ?? "unknown",
          scriptFingerprint(item.scriptPubKey),
          item.value,
        );
        totals.unknownScriptIoRows += 1;
      }
    }
    const perAddress = new Map();
    for (const item of inputs) {
      if (retainDetailedEvent) {
        insertIo.run(item.addressId, txId, 0, item.index, item.value);
        totals.addressIoRows += 1;
      }
      const stats = perAddress.get(item.addressId) ?? { inputTxb: 0, outputTxb: 0, satsIn: 0, satsOut: 0 };
      stats.inputTxb = 1;
      stats.satsOut += item.value;
      perAddress.set(item.addressId, stats);
      const input = tx.vin[item.index];
      if (typeof input.txid === "string" && Number.isInteger(input.vout)) {
        deleteWatchedUtxo.run(hashBlob(input.txid), input.vout, item.addressId);
        watchedUtxoByOutpoint.delete(outpointKey(input.txid, input.vout));
      }
    }
    for (const item of outputs) {
      if (retainDetailedEvent) {
        insertIo.run(item.addressId, txId, 1, item.index, item.value);
        totals.addressIoRows += 1;
      }
      const stats = perAddress.get(item.addressId) ?? { inputTxb: 0, outputTxb: 0, satsIn: 0, satsOut: 0 };
      stats.outputTxb = 1;
      stats.satsIn += item.value;
      perAddress.set(item.addressId, stats);
      insertWatchedUtxo.run(hashBlob(tx.txid), item.index, item.addressId, item.value);
      const key = outpointKey(tx.txid, item.index);
      const entries = watchedUtxoByOutpoint.get(key) ?? [];
      if (!entries.some((entry) => entry.address_id === item.addressId)) {
        entries.push({ address_id: item.addressId, value_sats: item.value });
        watchedUtxoByOutpoint.set(key, entries);
      }
    }
    for (const [addressId, stats] of perAddress) {
      upsertStats.run(
        addressId,
        block.height,
        block.height,
        stats.inputTxb,
        stats.outputTxb,
        stats.satsIn,
        stats.satsOut,
      );
      const date = new Date(Number(block.time) * 1000);
      const monthStart = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
      upsertMonthlyStats.run(addressId, monthStart, stats.inputTxb, stats.outputTxb, stats.satsIn, stats.satsOut);
    }
    const payerIds = [...new Set(inputs.map((item) => item.addressId))];
    const payeeTotals = new Map();
    for (const output of outputs)
      payeeTotals.set(output.addressId, (payeeTotals.get(output.addressId) ?? 0) + output.value);
    for (const payerId of retainDetailedEvent ? payerIds : []) {
      for (const [payeeId, value] of payeeTotals) {
        const attributionFlags =
          (payerIds.length > 1 ? FLOW_MULTI_PAYER : 0) |
          (payeeTotals.size > 1 ? FLOW_MULTI_PAYEE : 0) |
          (payerId === payeeId ? FLOW_SELF : 0) |
          (hasExternalInput ? FLOW_EXTERNAL_INPUT : 0);
        insertFlow.run(txId, payerId, payeeId, value, payerIds.length, payeeTotals.size, attributionFlags);
      }
    }
    if (isCounterparty && feeSats !== null) {
      insertFee.run(hashBlob(counterpartyHash), block.height, feeSats);
      totals.feeMatches += 1;
    }
  }
  const coinbaseOutputSats = block.tx[0].vout.reduce((sum, output) => sum + btcToSats(output.value), 0);
  activeTxHash = null;
  activeStage = "process_block_metrics";
  insertBlockMetrics.run(
    block.height,
    hashBlob(block.hash),
    block.time,
    block.size,
    block.weight,
    block.nTx ?? block.tx.length,
    blockSubsidySats(block.height),
    totalFeeSats,
    coinbaseOutputSats,
    counterpartyTransactionCount,
    counterpartySizeBytes,
    counterpartyWeight,
    counterpartyFeeSats,
  );
  checkpoint.run(block.height, hashBlob(block.hash), POLICY_VERSION, Math.floor(Date.now() / 1000));
  resolveBlockFailures.run(Math.floor(Date.now() / 1000), block.height);
  activeTxHash = null;
  activeStage = "process_block";
}

let fatalFailure = null;
try {
  for (let height = startHeight; height <= endHeight; height += batchSize) {
    activeHeight = height;
    activeTxHash = null;
    activeStage = "rpc_block_hashes";
    const heights = Array.from({ length: Math.min(batchSize, endHeight - height + 1) }, (_, index) => height + index);
    let phaseStartedAt = performance.now();
    currentCounterpartyHashes = new Set(
      findCounterpartyBatch.all(heights[0], heights.at(-1)).map((row) => row.tx_hash),
    );
    phaseMs.counterpartyLookup += performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    const hashes = await rpc.batch(heights.map((value) => ({ method: "getblockhash", params: [value] })));
    phaseMs.blockHashesRpc += performance.now() - phaseStartedAt;
    activeStage = "rpc_blocks";
    phaseStartedAt = performance.now();
    const blocks = await rpc.batch(hashes.map((hash) => ({ method: "getblock", params: [hash, blockVerbosity] })));
    phaseMs.blocksRpc += performance.now() - phaseStartedAt;
    begin();
    phaseStartedAt = performance.now();
    for (const block of blocks) processBlock(block);
    phaseMs.processing += performance.now() - phaseStartedAt;
    if (totals.blocks % commitBlocks < blocks.length || height + blocks.length > endHeight) {
      phaseStartedAt = performance.now();
      commit();
      phaseMs.commit += performance.now() - phaseStartedAt;
      const currentBytes = databaseBytes(db);
      const nextWarningLevel =
        currentBytes >= maximumBytes
          ? 3
          : currentBytes >= maximumBytes * 0.8
            ? 2
            : currentBytes >= maximumBytes * 0.6
              ? 1
              : 0;
      if (nextWarningLevel > sizeWarningLevel) {
        sizeWarningLevel = nextWarningLevel;
        console.log(
          JSON.stringify({
            event: "size_budget",
            height: heights.at(-1),
            databaseBytes: currentBytes,
            maximumBytes,
            utilization: currentBytes / maximumBytes,
          }),
        );
      }
      if (currentBytes > maximumBytes) {
        activeStage = "size_budget";
        throw new Error(`Compact index size ${currentBytes} exceeds maximum ${maximumBytes}`);
      }
    }
    if (totals.blocks % 1000 < blocks.length || height + blocks.length > endHeight) {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      console.log(
        JSON.stringify({
          event: "progress",
          height: heights.at(-1),
          ...totals,
          watchedUtxoOutpoints: watchedUtxoByOutpoint.size,
          unspentRecoveryOutpoints: unspentRecoveryOutpoints.size,
          rssBytes: process.memoryUsage().rss,
          blocksPerSecond: totals.blocks / elapsedSeconds,
          databaseBytes: databaseBytes(db),
          maximumBytes,
          batchSize,
          phaseMs,
        }),
      );
    }
  }
  commit();
} catch (error) {
  if (transactionOpen) db.exec("ROLLBACK");
  const message = String(error?.stack ?? error).slice(0, 4000);
  if (activeStage === "size_budget") {
    metadata.run("size_budget_exceeded_at_height", String(activeHeight));
    metadata.run("size_budget_maximum_bytes", String(maximumBytes));
    metadata.run("size_budget_observed_bytes", String(databaseBytes(db)));
  } else {
    const txHash = /^[0-9a-f]{64}$/i.test(activeTxHash ?? "") ? hashBlob(activeTxHash) : Buffer.alloc(0);
    recordFailure.run(activeHeight, txHash, activeStage, message);
  }
  fatalFailure = { event: "failed", height: activeHeight, txHash: activeTxHash, stage: activeStage, error: message };
}

const elapsedMs = Date.now() - startedAt;
if (!fatalFailure) {
  const coverage = db
    .prepare(
      `SELECT
    (SELECT count(*) FROM counterparty_tx_watch WHERE expected_block_height<=?1) expected,
    (SELECT count(*) FROM counterparty_tx_fee WHERE block_height<=?1) resolved,
    (SELECT count(*) FROM counterparty_tx_watch w LEFT JOIN counterparty_tx_fee f ON f.tx_hash=w.tx_hash
      WHERE w.expected_block_height<=?1 AND f.tx_hash IS NULL) missing`,
    )
    .get(endHeight);
  writeFeeCoverage.run(
    Number(coverage.expected),
    Number(coverage.resolved),
    Number(coverage.missing),
    endHeight,
    Math.floor(Date.now() / 1000),
  );
}
if (!fatalFailure && benchmark) {
  db.prepare(
    `INSERT OR REPLACE INTO scan_benchmark(
    started_at,start_height,end_height,elapsed_ms,blocks,transactions,
    relevant_transactions,address_io_rows,fee_matches,external_address_rows,
    external_io_rows,unknown_script_io_rows,recovery_output_rows,recovery_spend_rows,database_bytes
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    Math.floor(startedAt / 1000),
    startHeight,
    endHeight,
    elapsedMs,
    totals.blocks,
    totals.transactions,
    totals.relevantTransactions,
    totals.addressIoRows,
    totals.feeMatches,
    totals.externalAddressRows,
    totals.externalIoRows,
    totals.unknownScriptIoRows,
    totals.recoveryOutputs,
    totals.recoverySpends,
    databaseBytes(db),
  );
}
if (fatalFailure) {
  console.error(JSON.stringify(fatalFailure));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      event: "complete",
      startHeight,
      endHeight,
      elapsedMs,
      ...totals,
      watchedUtxoOutpoints: watchedUtxoByOutpoint.size,
      unspentRecoveryOutpoints: unspentRecoveryOutpoints.size,
      rssBytes: process.memoryUsage().rss,
      blocksPerSecond: totals.blocks / (elapsedMs / 1000),
      databaseBytes: databaseBytes(db),
      maximumBytes,
      batchSize,
      phaseMs,
    }),
  );
}
db.close();
