#!/usr/bin/env node

/** Track each cutoff's dominant/creator holders to their exact 180-day balance outcome. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(".analytics/radar/ownership");
const ownership = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const concentration = JSON.parse(readFileSync(resolve(root, "concentration.json"), "utf8"));
if (!ownership.complete || !concentration.complete) throw new Error("Required Radar snapshots are incomplete");
const timeline = [
  { kind: "observe", label: "2025-01-01", block: 877258 },
  { kind: "outcome", label: "2025-01-01", block: 903309 },
  { kind: "observe", label: "2025-07-01", block: 903454 },
  { kind: "outcome", label: "2025-07-01", block: 929757 },
  { kind: "observe", label: "2026-01-01", block: 930340 },
  { kind: "outcome", label: "2026-01-01", block: 955991 },
];
const chunks = readdirSync(root)
  .filter((name) => /^\d{10}-\d{10}\.ndjson$/.test(name))
  .sort();

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS holder_outcome_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    cursor INTEGER NOT NULL,event_count INTEGER NOT NULL,chunk_count INTEGER NOT NULL,timeline_index INTEGER NOT NULL);
  INSERT OR IGNORE INTO holder_outcome_state VALUES(1,-1,0,0,0);
  CREATE TABLE IF NOT EXISTS outcome_balances(
    holder_id INTEGER NOT NULL,asset_id INTEGER NOT NULL,quantity INTEGER NOT NULL,
    last_event_index INTEGER NOT NULL,utxo_address_id INTEGER,
    PRIMARY KEY(holder_id,asset_id)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS holder_outcomes(
    cutoff_label TEXT NOT NULL,asset_id INTEGER NOT NULL,horizon_block INTEGER NOT NULL,
    top1_holder_id INTEGER,top1_start INTEGER NOT NULL,top1_end INTEGER,
    creator_id INTEGER,creator_start INTEGER NOT NULL,creator_end INTEGER,
    owner_id INTEGER,owner_start INTEGER NOT NULL,owner_end INTEGER,
    non_creator_holder_id INTEGER,non_creator_start INTEGER NOT NULL,non_creator_end INTEGER,
    PRIMARY KEY(cutoff_label,asset_id)) WITHOUT ROWID;`);
const state = () => db.prepare(`SELECT cursor,event_count,chunk_count,timeline_index FROM holder_outcome_state`).get();
const apply = db.prepare(`INSERT INTO outcome_balances
  (holder_id,asset_id,quantity,last_event_index,utxo_address_id) VALUES(?,?,?,?,?)
  ON CONFLICT(holder_id,asset_id) DO UPDATE SET quantity=outcome_balances.quantity+excluded.quantity,
    last_event_index=excluded.last_event_index,
    utxo_address_id=COALESCE(excluded.utxo_address_id,outcome_balances.utxo_address_id)`);
const advance = db.prepare(`UPDATE holder_outcome_state SET cursor=?,event_count=event_count+?,
  chunk_count=chunk_count+? WHERE singleton=1`);

function applyRows(rows, completedChunk) {
  if (!rows.length) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const quantity = BigInt(row.quantity);
      apply.run(
        Number(row.address_id),
        Number(row.asset_id),
        Number(row.direction) === 1 ? quantity : -quantity,
        Number(row.event_index),
        row.utxo_address_id == null ? null : Number(row.utxo_address_id),
      );
    }
    advance.run(Number(rows.at(-1).event_index), rows.length, completedChunk ? 1 : 0);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function observe(point, index) {
  const horizon = timeline[index + 1];
  db.exec(`INSERT OR REPLACE INTO holder_outcomes
    (cutoff_label,asset_id,horizon_block,top1_holder_id,top1_start,
     creator_id,creator_start,owner_id,owner_start,
     non_creator_holder_id,non_creator_start)
    SELECT cutoff_label,asset_id,${horizon.block},top1_holder_id,top1_quantity,
      creator_id,creator_quantity,owner_id,owner_quantity,
      largest_non_creator_holder_id,largest_non_creator_quantity
    FROM historical_concentration WHERE cutoff_label='${point.label}';
    UPDATE holder_outcome_state SET timeline_index=${index + 1} WHERE singleton=1;`);
  process.stderr.write(`tracking holders from ${point.label}\n`);
}

function outcome(point, index) {
  db.exec(`DROP TABLE IF EXISTS temp.outcome_effective;
    CREATE TEMP TABLE outcome_effective AS
      SELECT asset_id,COALESCE(utxo_address_id,holder_id) holder_id,SUM(quantity) quantity
      FROM outcome_balances WHERE quantity>0
      GROUP BY asset_id,COALESCE(utxo_address_id,holder_id) HAVING SUM(quantity)>0;
    CREATE UNIQUE INDEX temp.idx_outcome_effective ON outcome_effective(asset_id,holder_id);
    UPDATE holder_outcomes AS tracked SET
      top1_end=COALESCE((SELECT quantity FROM outcome_effective
        WHERE asset_id=tracked.asset_id AND holder_id=tracked.top1_holder_id),0),
      creator_end=COALESCE((SELECT quantity FROM outcome_effective
        WHERE asset_id=tracked.asset_id AND holder_id=tracked.creator_id),0),
      owner_end=COALESCE((SELECT quantity FROM outcome_effective
        WHERE asset_id=tracked.asset_id AND holder_id=tracked.owner_id),0),
      non_creator_end=COALESCE((SELECT quantity FROM outcome_effective
        WHERE asset_id=tracked.asset_id AND holder_id=tracked.non_creator_holder_id),0)
    WHERE cutoff_label='${point.label}';
    UPDATE holder_outcome_state SET timeline_index=${index + 1} WHERE singleton=1;
    DROP TABLE temp.outcome_effective;`);
  process.stderr.write(`holder outcomes ${point.label}\n`);
}

for (const name of chunks) {
  const rows = readFileSync(resolve(root, name), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const pending = rows.filter((row) => Number(row.event_index) > Number(state().cursor));
  if (!pending.length) continue;
  let offset = 0;
  while (offset < pending.length) {
    const point = timeline[Number(state().timeline_index)];
    if (!point) break;
    let end = offset;
    while (end < pending.length && Number(pending[end].block_index) <= point.block) end++;
    if (end > offset) applyRows(pending.slice(offset, end), end === pending.length);
    offset = end;
    if (offset < pending.length) {
      const index = Number(state().timeline_index);
      if (point.kind === "observe") observe(point, index);
      else outcome(point, index);
    }
  }
  if (offset < pending.length && !timeline[Number(state().timeline_index)]) break;
}

const finalState = state();
const report = {
  schema: "xcp-radar-holder-outcomes/1",
  timeline,
  ...finalState,
  complete: Number(finalState.timeline_index) === timeline.length,
  rows: Number(db.prepare(`SELECT COUNT(*) count FROM holder_outcomes WHERE top1_end IS NOT NULL`).get().count),
};
writeFileSync(resolve(root, "holder-outcomes.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
