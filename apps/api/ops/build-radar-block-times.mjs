#!/usr/bin/env node

/** Import the canonical Bitcoin time spine for exact age-based Radar cohorts. */
import { writeFileSync } from "node:fs";
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

const source = remote(`SELECT COUNT(*) rows,MIN(block_index) min_block,MAX(block_index) max_block,
  MIN(block_time) min_time,MAX(block_time) max_time FROM blocks`).rows[0];
const receipt = {
  schema: "xcp-radar-block-times-source/1",
  measured_at: new Date().toISOString(),
  expected_rows: Number(source.rows),
  min_block: Number(source.min_block),
  max_block: Number(source.max_block),
  min_time: Number(source.min_time),
  max_time: Number(source.max_time),
};

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS block_times(
    block_index INTEGER PRIMARY KEY,block_time INTEGER NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS block_time_state(
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),cursor INTEGER NOT NULL,
    row_count INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
  INSERT OR IGNORE INTO block_time_state VALUES(1,0,0,0);`);
const state = () => db.prepare(`SELECT cursor,row_count,chunk_count FROM block_time_state`).get();
const upsert = db.prepare(`INSERT INTO block_times(block_index,block_time) VALUES(?,?)
  ON CONFLICT(block_index) DO UPDATE SET block_time=excluded.block_time`);
const advance = db.prepare(`UPDATE block_time_state SET cursor=?,row_count=(SELECT COUNT(*) FROM block_times),
  chunk_count=chunk_count+1 WHERE singleton=1`);

let completedThisRun = 0;
while (state().cursor < receipt.max_block && (!stopAfterChunks || completedThisRun < stopAfterChunks)) {
  const cursor = Number(state().cursor);
  const rows = remote(`SELECT block_index,block_time FROM blocks WHERE block_index>${cursor}
    AND block_index<=${receipt.max_block} ORDER BY block_index LIMIT ${chunkSize}`).rows;
  if (rows.length === 0) throw new Error(`Block-time import ended after ${cursor}, before ${receipt.max_block}`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) upsert.run(Number(row.block_index), Number(row.block_time));
    advance.run(Number(rows.at(-1).block_index));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  completedThisRun++;
  process.stderr.write(`block times ${rows.at(-1).block_index}/${receipt.max_block}\n`);
}

const finalState = state();
const observed = db.prepare(`SELECT COUNT(*) rows,MIN(block_index) min_block,MAX(block_index) max_block,
  MIN(block_time) min_time,MAX(block_time) max_time FROM block_times`).get();
const report = {
  ...receipt,
  schema: "xcp-radar-block-times/1",
  cursor: Number(finalState.cursor),
  row_count: Number(finalState.row_count),
  chunk_count: Number(finalState.chunk_count),
  complete:
    Number(observed.rows) === receipt.expected_rows &&
    Number(observed.min_block) === receipt.min_block &&
    Number(observed.max_block) === receipt.max_block &&
    Number(observed.min_time) === receipt.min_time &&
    Number(observed.max_time) === receipt.max_time,
};
writeFileSync(resolve(root, "block-times.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
