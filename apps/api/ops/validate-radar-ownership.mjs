#!/usr/bin/env node

/** Exact row-level validation of a completed local ownership replay against canonical D1 balances. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const root = resolve(arg("input", ".analytics/radar/ownership"));
const chunkSize = Number(arg("chunk-size", "10000"));
const stopAfterChunks = Number(arg("stop-after-chunks", "0"));
if (!Number.isInteger(chunkSize) || chunkSize < 100 || chunkSize > 10000)
  throw new Error("chunk-size must be an integer from 100 through 10000");
if (!Number.isInteger(stopAfterChunks) || stopAfterChunks < 0)
  throw new Error("stop-after-chunks must be a non-negative integer");

const replay = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
if (replay.schema !== "xcp-radar-ownership-snapshot/1" || !replay.complete)
  throw new Error("Ownership replay is not complete");

const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
function remote(sql) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return executeRemoteD1(sql);
    } catch (error) {
      lastError = error;
      if (attempt < 5) sleep(attempt * 2000);
    }
  }
  throw lastError;
}

const validationPath = resolve(root, "validation-build.json");
let receipt;
try {
  receipt = JSON.parse(readFileSync(validationPath, "utf8"));
} catch {
  const source = remote(`SELECT MAX(balance_id) max_balance_id,COUNT(*) balance_rows,
    MAX(updated_event_index) max_updated_event_index FROM balances`).rows[0];
  receipt = {
    schema: "xcp-radar-ownership-validation-build/1",
    created_at: new Date().toISOString(),
    replay_frontier_event_index: replay.frontier_event_index,
    max_balance_id: Number(source.max_balance_id),
    source_balance_rows: Number(source.balance_rows),
    source_max_updated_event_index: Number(source.max_updated_event_index),
  };
  writeFileSync(validationPath, `${JSON.stringify(receipt, null, 2)}\n`);
}
if (!Array.isArray(receipt.native_asset_ids)) {
  receipt.native_asset_ids = remote(`SELECT asset_id FROM asset_dictionary WHERE asset IN ('BTC','XCP')
    ORDER BY asset_id`).rows.map((row) => Number(row.asset_id));
  writeFileSync(validationPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS validation_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    cursor INTEGER NOT NULL,row_count INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
  INSERT OR IGNORE INTO validation_state VALUES(1,0,0,0);
  CREATE TABLE IF NOT EXISTS canonical_balances(
    balance_id INTEGER PRIMARY KEY,holder_id INTEGER,asset_id INTEGER NOT NULL,quantity INTEGER NOT NULL,
    updated_event_index INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_holder_asset
    ON canonical_balances(holder_id,asset_id);`);
const state = () => db.prepare(`SELECT cursor,row_count,chunk_count FROM validation_state WHERE singleton=1`).get();
const insert = db.prepare(`INSERT INTO canonical_balances
  (balance_id,holder_id,asset_id,quantity,updated_event_index) VALUES(?,?,?,?,?)
  ON CONFLICT(balance_id) DO UPDATE SET holder_id=excluded.holder_id,asset_id=excluded.asset_id,
    quantity=excluded.quantity,updated_event_index=excluded.updated_event_index`);
const advance = db.prepare(`UPDATE validation_state SET cursor=?,row_count=row_count+?,chunk_count=chunk_count+1
  WHERE singleton=1`);

let completedThisRun = 0;
while (state().cursor < receipt.max_balance_id && (!stopAfterChunks || completedThisRun < stopAfterChunks)) {
  const cursor = Number(state().cursor);
  const result = remote(`SELECT balance.balance_id,
      CASE WHEN balance.address_id IS NOT NULL THEN balance.address_id ELSE holder.address_id END holder_id,
      balance.asset_id,balance.quantity,balance.updated_event_index
    FROM balances balance
    LEFT JOIN address_dictionary holder
      ON balance.address_id IS NULL
     AND holder.address=lower(hex(balance.utxo_tx_hash))||':'||balance.utxo_vout
    WHERE balance.balance_id>${cursor} AND balance.balance_id<=${receipt.max_balance_id}
    ORDER BY balance.balance_id LIMIT ${chunkSize}`);
  if (result.rows.length === 0) throw new Error(`Canonical balances ended before ${receipt.max_balance_id}`);
  const after = Number(result.rows.at(-1).balance_id);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of result.rows) {
      if (row.holder_id == null) throw new Error(`Unresolved UTXO holder for balance ${row.balance_id}`);
      insert.run(
        Number(row.balance_id),
        Number(row.holder_id),
        Number(row.asset_id),
        BigInt(row.quantity),
        Number(row.updated_event_index),
      );
    }
    advance.run(after, result.rows.length);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  completedThisRun++;
  process.stderr.write(`ownership validation ${after}/${receipt.max_balance_id}\n`);
}

const finalState = state();
const complete = Number(finalState.cursor) === Number(receipt.max_balance_id);
let comparison = null;
if (complete) {
  const nativeIds = receipt.native_asset_ids.join(",") || "-1";
  comparison = db
    .prepare(`SELECT
      SUM(c.updated_event_index<=? AND r.holder_id IS NULL) missing_from_replay,
      SUM(c.updated_event_index<=? AND r.holder_id IS NOT NULL AND c.quantity!=r.quantity) quantity_mismatches,
      SUM(c.updated_event_index<=? AND c.asset_id NOT IN (${nativeIds})
        AND r.holder_id IS NOT NULL AND c.quantity!=r.quantity) non_native_quantity_mismatches,
      SUM(c.updated_event_index<=? AND r.holder_id IS NOT NULL AND c.quantity=r.quantity) exact_matches,
      SUM(c.updated_event_index>?) changed_after_frontier
    FROM canonical_balances c
    LEFT JOIN balances r ON r.holder_id=c.holder_id AND r.asset_id=c.asset_id`)
    .get(
      replay.frontier_event_index,
      replay.frontier_event_index,
      replay.frontier_event_index,
      replay.frontier_event_index,
      replay.frontier_event_index,
    );
  comparison.replay_only = db
    .prepare(`SELECT COUNT(*) count FROM balances replay
      WHERE NOT EXISTS (SELECT 1 FROM canonical_balances canonical
        WHERE canonical.holder_id=replay.holder_id AND canonical.asset_id=replay.asset_id)`)
    .get().count;
}
const report = { ...receipt, schema: "xcp-radar-ownership-validation/1", ...finalState, complete, comparison };
writeFileSync(resolve(root, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
