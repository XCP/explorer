#!/usr/bin/env node

/**
 * Resumable exact-integer replay of the canonical ownership ledger.
 *
 * D1 is only asked for bounded, event-indexed pages. A local SQLite state applies each signed uint64-compatible
 * quantity in canonical order without REAL conversion. The frozen frontier makes a resumed build one reproducible
 * observation rather than a moving mixture of chain states.
 *
 *   npm run snapshot:radar-ownership
 *   npm run snapshot:radar-ownership -- --stop-after-chunks=1 --output=.analytics/radar/ownership-smoke
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
function remote(sql) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return executeRemoteD1(sql);
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        const delay = attempt * 2000;
        process.stderr.write(`remote page attempt ${attempt} failed; retrying in ${delay / 1000}s\n`);
        sleep(delay);
      }
    }
  }
  throw lastError;
}

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const output = resolve(arg("output", ".analytics/radar/ownership"));
const chunkSize = Number(arg("chunk-size", "10000"));
const stopAfterChunks = Number(arg("stop-after-chunks", "0"));
if (!Number.isInteger(chunkSize) || chunkSize < 100 || chunkSize > 10000)
  throw new Error("chunk-size must be an integer from 100 through 10000");
if (!Number.isInteger(stopAfterChunks) || stopAfterChunks < 0)
  throw new Error("stop-after-chunks must be a non-negative integer");

mkdirSync(output, { recursive: true });
const receiptPath = resolve(output, "build.json");
let receipt;
try {
  receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
} catch {
  const frontier = remote(`SELECT MAX(event_index) event_index,MAX(block_index) block_index,
    COUNT(*) events FROM ledger_events`).rows[0];
  receipt = {
    schema: "xcp-radar-ownership-build/1",
    created_at: new Date().toISOString(),
    frontier_event_index: Number(frontier.event_index),
    frontier_block_index: Number(frontier.block_index),
    expected_events: Number(frontier.events),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}
if (receipt.schema !== "xcp-radar-ownership-build/1") throw new Error("Unknown ownership build receipt");

const db = new DatabaseSync(resolve(output, "ownership.sqlite"));
db.exec(`PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS replay_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    cursor INTEGER NOT NULL,event_count INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
  INSERT OR IGNORE INTO replay_state VALUES(1,-1,0,0);
  CREATE TABLE IF NOT EXISTS balances(
    holder_id INTEGER NOT NULL,asset_id INTEGER NOT NULL,quantity INTEGER NOT NULL,
    last_event_index INTEGER NOT NULL,utxo_address_id INTEGER,
    PRIMARY KEY(holder_id,asset_id)) WITHOUT ROWID;`);
const state = () => db.prepare(`SELECT cursor,event_count,chunk_count FROM replay_state WHERE singleton=1`).get();
const apply = db.prepare(`INSERT INTO balances(holder_id,asset_id,quantity,last_event_index,utxo_address_id)
  VALUES(?,?,?,?,?) ON CONFLICT(holder_id,asset_id) DO UPDATE SET
    quantity=balances.quantity+excluded.quantity,
    last_event_index=excluded.last_event_index,
    utxo_address_id=COALESCE(excluded.utxo_address_id,balances.utxo_address_id)`);
const advance = db.prepare(`UPDATE replay_state SET cursor=?,event_count=event_count+?,chunk_count=chunk_count+1
  WHERE singleton=1`);

let completedThisRun = 0;
while (state().cursor < receipt.frontier_event_index && (!stopAfterChunks || completedThisRun < stopAfterChunks)) {
  const before = Number(state().cursor);
  const result = remote(`SELECT event_index,direction,block_index,address_id,asset_id,quantity,utxo_address_id
    FROM ledger_events WHERE event_index>${before} AND event_index<=${receipt.frontier_event_index}
    ORDER BY event_index LIMIT ${chunkSize}`);
  if (result.rows.length === 0) throw new Error(`Ledger ended before frozen frontier after event ${before}`);
  const after = Number(result.rows.at(-1).event_index);
  const body = `${result.rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const chunkName = `${String(before + 1).padStart(10, "0")}-${String(after).padStart(10, "0")}.ndjson`;
  writeFileSync(resolve(output, chunkName), body);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of result.rows) {
      const unsigned = BigInt(row.quantity);
      if (unsigned < 0n || unsigned > 9223372036854775807n)
        throw new Error(`Invalid quantity at event ${row.event_index}`);
      const delta = Number(row.direction) === 1 ? unsigned : -unsigned;
      apply.run(
        Number(row.address_id),
        Number(row.asset_id),
        delta,
        Number(row.event_index),
        row.utxo_address_id == null ? null : Number(row.utxo_address_id),
      );
    }
    advance.run(after, result.rows.length);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  completedThisRun++;
  process.stderr.write(`ownership replay ${after}/${receipt.frontier_event_index}\n`);
}

const finalState = state();
const invariants = db
  .prepare(
    `SELECT COUNT(*) balance_rows,SUM(quantity<0) negative_rows,SUM(quantity=0) zero_rows,
    COUNT(DISTINCT asset_id) assets,COUNT(DISTINCT holder_id) holders FROM balances`,
  )
  .get();
const chunkFiles = db.prepare(`SELECT cursor,event_count,chunk_count FROM replay_state WHERE singleton=1`).get();
const manifest = {
  ...receipt,
  schema: "xcp-radar-ownership-snapshot/1",
  ...chunkFiles,
  complete:
    Number(finalState.cursor) === Number(receipt.frontier_event_index) &&
    Number(finalState.event_count) === Number(receipt.expected_events),
  invariants,
  receipt_sha256: createHash("sha256").update(readFileSync(receiptPath)).digest("hex"),
};
writeFileSync(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, manifest }, null, 2)}\n`);
db.close();
