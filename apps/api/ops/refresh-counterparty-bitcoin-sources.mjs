#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isMainnetBitcoinAddress } from "./lib/bitcoin-address.mjs";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const HELP = `Usage: node apps/api/ops/refresh-counterparty-bitcoin-sources.mjs [options]

  --database=PATH       unscanned compact Bitcoin SQLite database
  --staging=PATH        reusable delta staging SQLite database
  --page-size=N         remote D1 rows per page (default 5000)
  --reorg-window=N      recent blocks replaced exactly (default 10080)

This command is read-only against remote xcpio-core. It refuses to update a compact database after
the first scan checkpoint and delegates fingerprint changes to the builder's explicit guarded path.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const databasePath = resolve(option("database", "D:\\Bitcoin\\counterparty-index\\counterparty-bitcoin.sqlite"));
const stagingPath = resolve(option("staging", "D:\\Bitcoin\\counterparty-index\\source-refresh-staging.sqlite"));
const pageSize = Number.parseInt(option("page-size", "5000"), 10);
const reorgWindow = Number.parseInt(option("reorg-window", "10080"), 10);
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10_000) throw new Error("Invalid --page-size");
if (!Number.isSafeInteger(reorgWindow) || reorgWindow < 144) throw new Error("Invalid --reorg-window");

const db = new DatabaseSync(databasePath, { readOnly: true });
if (db.prepare("SELECT EXISTS(SELECT 1 FROM scan_state) present").get().present === 1) {
  db.close();
  throw new Error("Source refresh is forbidden after a scan checkpoint; rebuild a fresh compact database");
}
let validLocalAddresses = 0;
for (const row of db.prepare("SELECT address FROM watched_address").iterate()) {
  if (isMainnetBitcoinAddress(row.address)) validLocalAddresses += 1;
}
const priorAddressCursor = Number(
  db.prepare("SELECT value FROM index_metadata WHERE key='counterparty_source_remote_max_address_id'").get()?.value ??
    -1,
);
const hasUtxoWatch =
  db
    .prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='counterparty_utxo_watch') present")
    .get().present === 1;
const priorUtxoCursor = Number(
  db.prepare("SELECT value FROM index_metadata WHERE key='counterparty_source_remote_max_utxo_id'").get()?.value ?? -1,
);
const local = {
  addresses: Number(db.prepare("SELECT count(*) n FROM watched_address").get().n),
  validAddresses: validLocalAddresses,
  transactions: Number(db.prepare("SELECT count(*) n FROM counterparty_tx_watch").get().n),
  maxAddressId: Number(db.prepare("SELECT coalesce(max(address_id),-1) n FROM watched_address").get().n),
  maxTxIndex: Number(db.prepare("SELECT coalesce(max(tx_index),-1) n FROM counterparty_tx_watch").get().n),
  counterpartyUtxos: hasUtxoWatch ? Number(db.prepare("SELECT count(*) n FROM counterparty_utxo_watch").get().n) : 0,
};
db.close();

const apiDirectory = resolve(new URL("..", import.meta.url).pathname.slice(1));
const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
if (!existsSync(npxCli)) throw new Error(`Cannot find npm CLI at ${npxCli}`);
function remote(sql) {
  const command = sql.replace(/\s+/g, " ").trim();
  const stdout = execFileSync(
    process.execPath,
    [npxCli, "wrangler", "d1", "execute", "xcpio-core", "--remote", "--json", "--command", command],
    {
      cwd: apiDirectory,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const payload = JSON.parse(stdout);
  if (!Array.isArray(payload) || payload.some((item) => !item.success)) throw new Error("Remote D1 query failed");
  return payload.flatMap((item) => item.results ?? []);
}

const remoteSummary = remote(`WITH transaction_stats AS (
  SELECT count(*) transactions,
    sum(CASE WHEN length(tx_hash)<>32 OR tx_index IS NULL OR tx_index<0 OR
      block_index IS NULL OR block_index<0 THEN 1 ELSE 0 END) invalid_transactions,
    count(DISTINCT tx_index) distinct_tx_indices,
    min(tx_index) min_tx_index,max(tx_index) max_tx_index,max(block_index) max_height
  FROM transactions
), utxo_stats AS (
  SELECT count(*) utxo_balance_rows,
    count(DISTINCT lower(hex(b.utxo_tx_hash))||':'||b.utxo_vout) utxo_entities,
    count(DISTINCT lower(hex(b.utxo_tx_hash))||':'||b.utxo_vout||':'||coalesce(b.utxo_address_id,-1)) utxo_owner_bindings,
    count(DISTINCT entity.address_id) dictionary_utxo_entities,
    max(entity.address_id) max_utxo_id,
    sum(CASE WHEN entity.address_id IS NULL THEN 1 ELSE 0 END) missing_dictionary_entities,
    sum(CASE WHEN b.utxo_address_id IS NULL THEN 1 ELSE 0 END) missing_utxo_owners
  FROM balances b LEFT JOIN address_dictionary entity
    ON entity.address=lower(hex(b.utxo_tx_hash))||':'||b.utxo_vout
  WHERE b.utxo_tx_hash IS NOT NULL
)
SELECT transaction_stats.*,utxo_stats.*,
  (SELECT count(*) FROM address_dictionary WHERE address GLOB '1*' OR address GLOB '3*' OR address GLOB 'bc1*') address_candidates,
  (SELECT max(address_id) FROM address_dictionary WHERE address GLOB '1*' OR address GLOB '3*' OR address GLOB 'bc1*') max_address_id,
  (SELECT value FROM core_state WHERE key='last_block_index') chain_height
FROM transaction_stats CROSS JOIN utxo_stats`)[0];
const snapshotMaxAddressId = Number(remoteSummary.max_address_id);
const snapshotMaxUtxoId = Number(remoteSummary.max_utxo_id);
const snapshotMaxTxIndex = Number(remoteSummary.max_tx_index);
const reconcileFromHeight = Math.max(0, Number(remoteSummary.chain_height) - reorgWindow + 1);
if (
  !Number.isSafeInteger(snapshotMaxAddressId) ||
  !Number.isSafeInteger(snapshotMaxUtxoId) ||
  !Number.isSafeInteger(snapshotMaxTxIndex) ||
  !Number.isSafeInteger(Number(remoteSummary.chain_height)) ||
  Number(remoteSummary.chain_height) < Number(remoteSummary.max_height) ||
  Number(remoteSummary.transactions) < 1 ||
  Number(remoteSummary.invalid_transactions) !== 0 ||
  Number(remoteSummary.distinct_tx_indices) !== Number(remoteSummary.transactions) ||
  Number(remoteSummary.min_tx_index) !== 0 ||
  snapshotMaxTxIndex !== Number(remoteSummary.transactions) - 1 ||
  Number(remoteSummary.utxo_entities) < 1 ||
  Number(remoteSummary.utxo_owner_bindings) !== Number(remoteSummary.utxo_entities) ||
  Number(remoteSummary.dictionary_utxo_entities) !== Number(remoteSummary.utxo_entities) ||
  Number(remoteSummary.missing_dictionary_entities) !== 0 ||
  Number(remoteSummary.missing_utxo_owners) !== 0
) {
  throw new Error(`Invalid remote source snapshot boundary: ${JSON.stringify(remoteSummary)}`);
}

mkdirSync(dirname(stagingPath), { recursive: true });
const staging = new DatabaseSync(stagingPath);
staging.exec(`
  CREATE TABLE IF NOT EXISTS address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS utxo_entities(
    entity_id INTEGER PRIMARY KEY,entity TEXT NOT NULL UNIQUE,tx_hash TEXT NOT NULL,vout INTEGER NOT NULL,
    owner_address_id INTEGER NOT NULL,owner TEXT NOT NULL,UNIQUE(tx_hash,vout));
  CREATE TABLE IF NOT EXISTS transactions(tx_hash TEXT PRIMARY KEY,tx_index INTEGER,block_index INTEGER);
`);
const stagingUtxoColumns = new Set(
  staging
    .prepare("PRAGMA table_info(utxo_entities)")
    .all()
    .map((row) => row.name),
);
if (!stagingUtxoColumns.has("owner_address_id"))
  staging.exec("ALTER TABLE utxo_entities ADD COLUMN owner_address_id INTEGER");
if (!stagingUtxoColumns.has("owner")) staging.exec("ALTER TABLE utxo_entities ADD COLUMN owner TEXT");
staging
  .prepare("DELETE FROM address_dictionary WHERE address_id>?")
  .run(Math.max(snapshotMaxAddressId, snapshotMaxUtxoId));

const initialAddressCursor = priorAddressCursor >= 0 ? priorAddressCursor : local.maxAddressId;
let addressCursor = initialAddressCursor;
let addressRows = 0;
let validAddressRows = 0;
const insertAddress = staging.prepare("INSERT OR REPLACE INTO address_dictionary(address_id,address) VALUES(?,?)");
while (true) {
  const rows = remote(`SELECT address_id,address FROM address_dictionary
    WHERE address_id>${addressCursor} AND address_id<=${snapshotMaxAddressId} AND
      (address GLOB '1*' OR address GLOB '3*' OR address GLOB 'bc1*')
    ORDER BY address_id LIMIT ${pageSize}`);
  if (rows.length === 0) break;
  staging.exec("BEGIN");
  for (const row of rows) insertAddress.run(row.address_id, row.address);
  staging.exec("COMMIT");
  addressRows += rows.length;
  validAddressRows += rows.filter((row) => isMainnetBitcoinAddress(row.address)).length;
  addressCursor = Number(rows.at(-1).address_id);
  if (rows.length < pageSize) break;
}

const initialUtxoCursor = local.counterpartyUtxos > 0 && priorUtxoCursor >= 0 ? priorUtxoCursor : -1;
let utxoCursor = initialUtxoCursor;
let utxoRows = 0;
const insertUtxo = staging.prepare(`INSERT OR REPLACE INTO utxo_entities(
  entity_id,entity,tx_hash,vout,owner_address_id,owner) VALUES(?,?,?,?,?,?)`);
while (true) {
  const rows = remote(`SELECT entity.address_id entity_id,entity.address entity,
      lower(hex(b.utxo_tx_hash)) tx_hash,b.utxo_vout vout,b.utxo_address_id owner_address_id,owner.address owner
    FROM balances b JOIN address_dictionary entity
      ON entity.address=lower(hex(b.utxo_tx_hash))||':'||b.utxo_vout
    JOIN address_dictionary owner ON owner.address_id=b.utxo_address_id
    WHERE entity.address_id>${utxoCursor} AND entity.address_id<=${snapshotMaxUtxoId}
    GROUP BY entity.address_id,entity.address,b.utxo_tx_hash,b.utxo_vout,b.utxo_address_id,owner.address
    ORDER BY entity.address_id LIMIT ${pageSize}`);
  if (rows.length === 0) break;
  staging.exec("BEGIN");
  for (const row of rows)
    insertUtxo.run(row.entity_id, row.entity, row.tx_hash, row.vout, row.owner_address_id, row.owner);
  staging.exec("COMMIT");
  utxoRows += rows.length;
  utxoCursor = Number(rows.at(-1).entity_id);
  if (rows.length < pageSize) break;
}

staging.exec("DELETE FROM transactions");
let txCursor = -1;
let transactionRows = 0;
const insertTransaction = staging.prepare(
  "INSERT OR REPLACE INTO transactions(tx_hash,tx_index,block_index) VALUES(?,?,?)",
);
while (true) {
  const rows = remote(`SELECT lower(hex(tx_hash)) tx_hash,tx_index,block_index FROM transactions
    WHERE tx_index>${txCursor} AND tx_index<=${snapshotMaxTxIndex} AND
      block_index>=${reconcileFromHeight} AND length(tx_hash)=32
    ORDER BY tx_index LIMIT ${pageSize}`);
  if (rows.length === 0) break;
  staging.exec("BEGIN");
  for (const row of rows) insertTransaction.run(row.tx_hash, row.tx_index, row.block_index);
  staging.exec("COMMIT");
  transactionRows += rows.length;
  txCursor = Number(rows.at(-1).tx_index);
  if (rows.length < pageSize) break;
}
staging.close();

const builder = resolve(new URL("./build-counterparty-bitcoin-index.mjs", import.meta.url).pathname.slice(1));
execFileSync(
  process.execPath,
  [
    builder,
    `--database=${databasePath}`,
    `--address-database=${stagingPath}`,
    `--tx-database=${stagingPath}`,
    `--replace-tx-from-height=${reconcileFromHeight}`,
    "--initialize-only",
    "--accept-source-update",
  ],
  { stdio: "inherit" },
);

const updated = new DatabaseSync(databasePath);
const after = {
  addresses: Number(updated.prepare("SELECT count(*) n FROM watched_address").get().n),
  transactions: Number(updated.prepare("SELECT count(*) n FROM counterparty_tx_watch").get().n),
  maxHeight: Number(updated.prepare("SELECT max(expected_block_height) n FROM counterparty_tx_watch").get().n),
  counterpartyUtxos: Number(updated.prepare("SELECT count(*) n FROM counterparty_utxo_watch").get().n),
};
const expectedValidAddresses = local.validAddresses + validAddressRows;
if (
  after.addresses !== expectedValidAddresses ||
  after.counterpartyUtxos !== Number(remoteSummary.utxo_entities) ||
  after.transactions !== Number(remoteSummary.transactions) ||
  after.maxHeight !== Number(remoteSummary.max_height)
) {
  updated.close();
  throw new Error(
    `Refreshed source does not reconcile to remote summary: ${JSON.stringify({ after, expectedValidAddresses, remoteSummary })}`,
  );
}
const metadata = updated.prepare(`INSERT INTO index_metadata(key,value) VALUES(?,?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
metadata.run("counterparty_source_remote_height", String(remoteSummary.max_height));
metadata.run("counterparty_source_chain_height", String(remoteSummary.chain_height));
metadata.run("counterparty_source_remote_transactions", String(remoteSummary.transactions));
metadata.run("counterparty_source_remote_addresses", String(after.addresses));
metadata.run("counterparty_source_remote_address_candidates", String(remoteSummary.address_candidates));
metadata.run("counterparty_source_remote_max_address_id", String(remoteSummary.max_address_id));
metadata.run("counterparty_source_remote_utxos", String(remoteSummary.utxo_entities));
metadata.run("counterparty_source_remote_max_utxo_id", String(remoteSummary.max_utxo_id));
metadata.run("counterparty_source_refreshed_at", String(Math.floor(Date.now() / 1000)));
const result = {
  database: databasePath,
  staging: stagingPath,
  before: local,
  fetched: {
    address_candidates: addressRows,
    valid_addresses: validAddressRows,
    counterparty_utxos: utxoRows,
    transactions: transactionRows,
  },
  reconciled_transaction_tail: { from_height: reconcileFromHeight, through_height: Number(remoteSummary.chain_height) },
  after,
  remote: remoteSummary,
};
updated.close();
console.log(JSON.stringify(result, null, 2));
