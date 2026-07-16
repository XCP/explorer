#!/usr/bin/env node

/** Import valid Fairmints once for cutoff-safe New Radar evaluation. */
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
if (!Number.isInteger(chunkSize) || chunkSize < 100 || chunkSize > 10000)
  throw new Error("chunk-size must be an integer from 100 through 10000");
const ownership = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
if (!ownership.complete) throw new Error("Ownership snapshot must be complete first");

const source = executeRemoteD1(
  `SELECT COALESCE(MAX(event_index),0) max_event_index,COUNT(*) rows FROM fairmints WHERE status='valid'`,
).rows[0];
const frontier = Number(source.max_event_index);
const expected = Number(source.rows);
const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS fairmint_history(
    event_index INTEGER PRIMARY KEY,asset_id INTEGER NOT NULL,block_time INTEGER NOT NULL,
    source_id INTEGER,fairminter_tx_index INTEGER,earn_quantity TEXT NOT NULL,
    paid_quantity TEXT NOT NULL,commission TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_fairmint_history_asset_time
    ON fairmint_history(asset_id,block_time);
  CREATE TABLE IF NOT EXISTS fairmint_history_state(
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),cursor INTEGER NOT NULL,row_count INTEGER NOT NULL);
  INSERT OR IGNORE INTO fairmint_history_state VALUES(1,0,0);`);
const state = () => db.prepare(`SELECT cursor,row_count FROM fairmint_history_state`).get();
const insert = db.prepare(`INSERT OR IGNORE INTO fairmint_history(
  event_index,asset_id,block_time,source_id,fairminter_tx_index,earn_quantity,paid_quantity,commission)
  VALUES(?,?,?,?,?,?,?,?)`);
const advance = db.prepare(`UPDATE fairmint_history_state SET cursor=MAX(cursor,?),
  row_count=(SELECT COUNT(*) FROM fairmint_history) WHERE singleton=1`);

while (Number(state().cursor) < frontier) {
  const cursor = Number(state().cursor);
  const rows = executeRemoteD1(`SELECT event_index,asset_id,block_time,source_id,fairminter_tx_index,
      earn_quantity,paid_quantity,commission FROM fairmints
    WHERE status='valid' AND event_index>${cursor} AND event_index<=${frontier}
    ORDER BY event_index LIMIT ${chunkSize}`).rows;
  if (!rows.length) break;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows)
      insert.run(
        Number(row.event_index),
        Number(row.asset_id),
        Number(row.block_time),
        row.source_id == null ? null : Number(row.source_id),
        row.fairminter_tx_index == null ? null : Number(row.fairminter_tx_index),
        String(row.earn_quantity),
        String(row.paid_quantity),
        String(row.commission),
      );
    advance.run(Number(rows.at(-1).event_index));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  process.stderr.write(`fairmint history ${state().row_count}/${expected}\n`);
}

const final = state();
const stored = Number(
  db.prepare(`SELECT COUNT(*) rows FROM fairmint_history WHERE event_index<=?`).get(frontier).rows,
);
const report = {
  schema: "xcp-radar-fairmint-history/1",
  measured_at: new Date().toISOString(),
  frontier_event_index: frontier,
  expected_rows: expected,
  cursor: Number(final.cursor),
  rows: stored,
  complete: Number(final.cursor) === frontier && stored === expected,
};
writeFileSync(resolve(root, "fairmint-history.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
