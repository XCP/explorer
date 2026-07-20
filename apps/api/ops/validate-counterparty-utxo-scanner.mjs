#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// A deterministic mechanical test of the unified UTXO scanner. This uses a real
// output from block 278319, but an isolated synthetic Counterparty source row, so
// it exercises output discovery and owner resolution without touching production.
const blockHeight = 278319;
const txid = "685623401c3f5e9d2eaaf0657a50454e56a270ee7630d409e98d3bc257560098";
const vout = 2;
const owner = "1Pcpxw6wJwXABhjCspe3CNf3gqSeh6eien";
const expectedValueSats = 340000;
const fixtureRoot = resolve(process.env.COUNTERPARTY_FIXTURE_ROOT ?? "D:\\Bitcoin\\counterparty-index");
const sourcePath = resolve(fixtureRoot, "utxo-scanner-source-fixture.sqlite");
const compactPath = resolve(fixtureRoot, "utxo-scanner-compact-fixture.sqlite");
const builderPath = resolve("apps/api/ops/build-counterparty-bitcoin-index.mjs");

for (const path of [sourcePath, compactPath, `${compactPath}-wal`, `${compactPath}-shm`]) {
  rmSync(path, { force: true });
}

const source = new DatabaseSync(sourcePath);
source.exec(`
  CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE);
  CREATE TABLE utxo_entities(
    entity_id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL UNIQUE,
    tx_hash TEXT NOT NULL,
    vout INTEGER NOT NULL,
    owner_address_id INTEGER,
    owner TEXT NOT NULL
  );
  CREATE TABLE transactions(
    tx_hash TEXT PRIMARY KEY,
    tx_index INTEGER NOT NULL UNIQUE,
    block_index INTEGER NOT NULL
  );
`);
source.prepare("INSERT INTO address_dictionary VALUES(?,?)").run(1, owner);
source.prepare("INSERT INTO utxo_entities VALUES(?,?,?,?,?,?)").run(1, `${txid}:${vout}`, txid, vout, 1, owner);
source.prepare("INSERT INTO transactions VALUES(?,?,?)").run(txid, 0, blockHeight);
source.close();

const output = execFileSync(
  process.execPath,
  [
    builderPath,
    `--database=${compactPath}`,
    `--address-database=${sourcePath}`,
    `--tx-database=${sourcePath}`,
    `--start-height=${blockHeight}`,
    `--end-height=${blockHeight}`,
    "--batch-size=1",
    "--commit-blocks=1",
  ],
  { cwd: resolve("."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

const compact = new DatabaseSync(compactPath, { readOnly: true });
const state = compact
  .prepare(
    `
  SELECT lower(hex(w.tx_hash)) txid,w.vout,w.owner,
         lower(hex(t.tx_hash)) created_txid,t.block_height created_height,
         s.value_sats,s.script_type,s.resolved_owner,s.spent_by_tx_id
  FROM counterparty_utxo_watch w
  LEFT JOIN btc_counterparty_utxo s USING(entity_id)
  LEFT JOIN btc_tx t ON t.tx_id=s.created_tx_id
  WHERE w.entity_id=1
`,
  )
  .get();
const transaction = compact
  .prepare(
    `
  SELECT flags,fee_sats,block_height FROM btc_tx WHERE tx_hash=unhex(?)
`,
  )
  .get(txid);
const summary = compact
  .prepare(
    `
  SELECT
    (SELECT count(*) FROM counterparty_utxo_watch) source_entities,
    (SELECT count(*) FROM btc_counterparty_utxo) observed_entities,
    (SELECT count(*) FROM btc_tx WHERE (flags&4)<>0) relevant_utxo_transactions,
    (SELECT count(*) FROM btc_tx WHERE (flags&2)<>0) counterparty_transactions
`,
  )
  .get();
compact.close();

const failures = [];
if (!state) failures.push("missing UTXO state");
if (state?.txid !== txid || Number(state?.vout) !== vout) failures.push("outpoint mismatch");
if (state?.owner !== owner || state?.resolved_owner !== owner) failures.push("owner mismatch");
if (state?.created_txid !== txid || Number(state?.created_height) !== blockHeight) failures.push("creation mismatch");
if (Number(state?.value_sats) !== expectedValueSats) failures.push("value mismatch");
if (state?.spent_by_tx_id !== null) failures.push("unexpected spend");
if ((Number(transaction?.flags) & 6) !== 6) failures.push("expected Counterparty and UTXO flags");
if (Number(transaction?.block_height) !== blockHeight) failures.push("transaction height mismatch");
if (
  Number(summary.source_entities) !== 1 ||
  Number(summary.observed_entities) !== 1 ||
  Number(summary.relevant_utxo_transactions) !== 1 ||
  Number(summary.counterparty_transactions) !== 1
) {
  failures.push("summary counts mismatch");
}

const result = {
  ok: failures.length === 0,
  fixture: { blockHeight, txid, vout, owner, expectedValueSats },
  state,
  transaction,
  summary,
  builderEvents: output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
  failures,
  compactPath,
  sourcePath,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
