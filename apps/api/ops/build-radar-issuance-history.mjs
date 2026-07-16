#!/usr/bin/env node

/** Import valid issuance/transfer ownership history into the frozen local Radar research snapshot. */
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

const ownership = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
if (!ownership.complete) throw new Error("Ownership replay must be complete first");
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

const receiptPath = resolve(root, "issuance-history-build.json");
let receipt;
try {
  receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
} catch {
  const source = remote(`SELECT MAX(event_index) max_event_index,COUNT(*) rows
    FROM issuances WHERE status='valid' AND asset_id IS NOT NULL AND issuer_id IS NOT NULL
      AND event_index<=${ownership.frontier_event_index}`).rows[0];
  receipt = {
    schema: "xcp-radar-issuance-history-build/1",
    created_at: new Date().toISOString(),
    ownership_frontier_event_index: ownership.frontier_event_index,
    max_event_index: Number(source.max_event_index),
    expected_rows: Number(source.rows),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS issuance_history_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    cursor INTEGER NOT NULL,row_count INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
  INSERT OR IGNORE INTO issuance_history_state VALUES(1,-1,0,0);
  CREATE TABLE IF NOT EXISTS issuance_history(
    event_index INTEGER PRIMARY KEY,block_index INTEGER NOT NULL,asset_id INTEGER NOT NULL,
    source_id INTEGER,issuer_id INTEGER NOT NULL,transfer INTEGER NOT NULL,
    divisible INTEGER NOT NULL DEFAULT 0,reset INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS idx_issuance_history_asset_event
    ON issuance_history(asset_id,event_index);`);
const issuanceColumns = new Set(db.prepare(`PRAGMA table_info(issuance_history)`).all().map((column) => column.name));
if (!issuanceColumns.has("divisible")) {
  db.exec(`ALTER TABLE issuance_history ADD COLUMN divisible INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE issuance_history ADD COLUMN reset INTEGER NOT NULL DEFAULT 0;
    DELETE FROM issuance_history;
    UPDATE issuance_history_state SET cursor=-1,row_count=0,chunk_count=0 WHERE singleton=1;`);
}
const state = () => db.prepare(`SELECT cursor,row_count,chunk_count FROM issuance_history_state`).get();
const insert = db.prepare(`INSERT INTO issuance_history
  (event_index,block_index,asset_id,source_id,issuer_id,transfer,divisible,reset) VALUES(?,?,?,?,?,?,?,?)`);
const advance = db.prepare(`UPDATE issuance_history_state SET cursor=?,row_count=row_count+?,
  chunk_count=chunk_count+1 WHERE singleton=1`);

let completedThisRun = 0;
while (state().cursor < receipt.max_event_index && (!stopAfterChunks || completedThisRun < stopAfterChunks)) {
  const cursor = Number(state().cursor);
  const result = remote(`SELECT event_index,block_index,asset_id,source_id,issuer_id,transfer,divisible,reset
    FROM issuances WHERE status='valid' AND asset_id IS NOT NULL AND issuer_id IS NOT NULL
      AND event_index>${cursor} AND event_index<=${receipt.max_event_index}
    ORDER BY event_index LIMIT ${chunkSize}`);
  if (result.rows.length === 0) throw new Error(`Issuance history ended before ${receipt.max_event_index}`);
  const after = Number(result.rows.at(-1).event_index);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of result.rows)
      insert.run(
        Number(row.event_index),
        Number(row.block_index),
        Number(row.asset_id),
        row.source_id == null ? null : Number(row.source_id),
        Number(row.issuer_id),
        Number(row.transfer),
        Number(row.divisible),
        Number(row.reset ?? 0),
      );
    advance.run(after, result.rows.length);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  completedThisRun++;
  process.stderr.write(`issuance history ${after}/${receipt.max_event_index}\n`);
}

const finalState = state();
const report = {
  ...receipt,
  schema: "xcp-radar-issuance-history/1",
  ...finalState,
  complete:
    Number(finalState.cursor) === Number(receipt.max_event_index) &&
    Number(finalState.row_count) === Number(receipt.expected_rows),
};
writeFileSync(resolve(root, "issuance-history.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
