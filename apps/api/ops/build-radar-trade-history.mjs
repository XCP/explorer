#!/usr/bin/env node

/** Import normalized completed trades once for local, leakage-safe Radar evaluation. */
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

const concentration = JSON.parse(readFileSync(resolve(root, "concentration.json"), "utf8"));
if (!concentration.complete) throw new Error("Historical concentration snapshot must be complete first");
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

const receiptPath = resolve(root, "trade-history-build.json");
let receipt;
try {
  receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
} catch {
  const source = remote(`SELECT MAX(rowid) max_rowid,COUNT(*) rows,MAX(block_time) max_block_time FROM trades`).rows[0];
  receipt = {
    schema: "xcp-radar-trade-history-build/1",
    created_at: new Date().toISOString(),
    max_rowid: Number(source.max_rowid),
    expected_rows: Number(source.rows),
    max_block_time: Number(source.max_block_time),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS trade_history_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    cursor INTEGER NOT NULL,row_count INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
  INSERT OR IGNORE INTO trade_history_state VALUES(1,0,0,0);
  CREATE TABLE IF NOT EXISTS market_trades(
    trade_rowid INTEGER PRIMARY KEY,venue TEXT NOT NULL,asset_id INTEGER,block_time INTEGER,
    quantity REAL,usd_value REAL,buyer_id INTEGER,seller_id INTEGER,sale_class TEXT);
  CREATE INDEX IF NOT EXISTS idx_market_trades_asset_time
    ON market_trades(asset_id,block_time);`);
const state = () => db.prepare(`SELECT cursor,row_count,chunk_count FROM trade_history_state`).get();
const insert = db.prepare(`INSERT INTO market_trades
  (trade_rowid,venue,asset_id,block_time,quantity,usd_value,buyer_id,seller_id,sale_class)
  VALUES(?,?,?,?,?,?,?,?,?)`);
const advance = db.prepare(`UPDATE trade_history_state SET cursor=?,row_count=row_count+?,
  chunk_count=chunk_count+1 WHERE singleton=1`);

let completedThisRun = 0;
while (state().cursor < receipt.max_rowid && (!stopAfterChunks || completedThisRun < stopAfterChunks)) {
  const cursor = Number(state().cursor);
  const result = remote(`SELECT rowid trade_rowid,venue,asset_id,block_time,quantity,usd_value,
      buyer_id,seller_id,sale_class FROM trades
    WHERE rowid>${cursor} AND rowid<=${receipt.max_rowid} ORDER BY rowid LIMIT ${chunkSize}`);
  if (result.rows.length === 0) throw new Error(`Trade history ended before ${receipt.max_rowid}`);
  const after = Number(result.rows.at(-1).trade_rowid);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of result.rows)
      insert.run(
        Number(row.trade_rowid),
        row.venue,
        row.asset_id == null ? null : Number(row.asset_id),
        row.block_time == null ? null : Number(row.block_time),
        row.quantity == null ? null : Number(row.quantity),
        row.usd_value == null ? null : Number(row.usd_value),
        row.buyer_id == null ? null : Number(row.buyer_id),
        row.seller_id == null ? null : Number(row.seller_id),
        row.sale_class ?? null,
      );
    advance.run(after, result.rows.length);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  completedThisRun++;
  process.stderr.write(`trade history ${after}/${receipt.max_rowid}\n`);
}

const finalState = state();
const report = {
  ...receipt,
  schema: "xcp-radar-trade-history/1",
  ...finalState,
  complete:
    Number(finalState.cursor) === Number(receipt.max_rowid) &&
    Number(finalState.row_count) === Number(receipt.expected_rows),
};
writeFileSync(resolve(root, "trade-history.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();

