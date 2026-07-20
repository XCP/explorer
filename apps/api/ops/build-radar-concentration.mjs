#!/usr/bin/env node

/** Build compact, cutoff-safe holder concentration features from the downloaded exact ownership ledger. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const root = resolve(arg("input", ".analytics/radar/ownership"));
const stopAfterChunks = Number(arg("stop-after-chunks", "0"));
if (!Number.isInteger(stopAfterChunks) || stopAfterChunks < 0)
  throw new Error("stop-after-chunks must be a non-negative integer");

const ownership = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const issuances = JSON.parse(readFileSync(resolve(root, "issuance-history.json"), "utf8"));
if (!ownership.complete || !issuances.complete) throw new Error("Ownership and issuance snapshots must be complete");
const cutoffs = [
  { label: "2025-01-01", timestamp: 1735689600, block: 877258 },
  { label: "2025-07-01", timestamp: 1751328000, block: 903454 },
  { label: "2026-01-01", timestamp: 1767225600, block: 930340 },
];
const chunks = readdirSync(root)
  .filter((name) => /^\d{10}-\d{10}\.ndjson$/.test(name))
  .sort();
if (chunks.length !== ownership.chunk_count)
  throw new Error(`Expected ${ownership.chunk_count} ownership chunks, found ${chunks.length}`);

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS historical_replay_state(
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),cursor INTEGER NOT NULL,event_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,next_cutoff INTEGER NOT NULL);
  INSERT OR IGNORE INTO historical_replay_state VALUES(1,-1,0,0,0);
  CREATE TABLE IF NOT EXISTS historical_balances(
    holder_id INTEGER NOT NULL,asset_id INTEGER NOT NULL,quantity INTEGER NOT NULL,
    last_event_index INTEGER NOT NULL,utxo_address_id INTEGER,
    PRIMARY KEY(holder_id,asset_id)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS historical_concentration(
    cutoff_label TEXT NOT NULL,cutoff_block INTEGER NOT NULL,asset_id INTEGER NOT NULL,
    holders INTEGER NOT NULL,total_quantity INTEGER NOT NULL,top1_quantity INTEGER NOT NULL,
    top1_holder_id INTEGER,top5_quantity INTEGER NOT NULL,creator_id INTEGER,owner_id INTEGER,
    divisible INTEGER NOT NULL DEFAULT 0,normalized_supply REAL NOT NULL DEFAULT 0,
    creator_quantity INTEGER NOT NULL,owner_quantity INTEGER NOT NULL,
    largest_non_creator_quantity INTEGER NOT NULL,largest_non_creator_holder_id INTEGER,
    largest_non_owner_quantity INTEGER NOT NULL,largest_non_owner_holder_id INTEGER,
    PRIMARY KEY(cutoff_label,asset_id)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_issuance_history_block_asset
    ON issuance_history(block_index,asset_id,event_index);`);
const concentrationColumns = new Set(
  db
    .prepare(`PRAGMA table_info(historical_concentration)`)
    .all()
    .map((column) => column.name),
);
if (!concentrationColumns.has("top1_holder_id")) {
  db.exec(`ALTER TABLE historical_concentration ADD COLUMN top1_holder_id INTEGER;
    ALTER TABLE historical_concentration ADD COLUMN largest_non_creator_holder_id INTEGER;
    ALTER TABLE historical_concentration ADD COLUMN largest_non_owner_holder_id INTEGER;
    DELETE FROM historical_concentration;
    DELETE FROM historical_balances;
    UPDATE historical_replay_state SET cursor=-1,event_count=0,chunk_count=0,next_cutoff=0 WHERE singleton=1;`);
}
const state = () => db.prepare(`SELECT cursor,event_count,chunk_count,next_cutoff FROM historical_replay_state`).get();
const apply = db.prepare(`INSERT INTO historical_balances
  (holder_id,asset_id,quantity,last_event_index,utxo_address_id) VALUES(?,?,?,?,?)
  ON CONFLICT(holder_id,asset_id) DO UPDATE SET quantity=historical_balances.quantity+excluded.quantity,
    last_event_index=excluded.last_event_index,
    utxo_address_id=COALESCE(excluded.utxo_address_id,historical_balances.utxo_address_id)`);
const advance = db.prepare(`UPDATE historical_replay_state SET cursor=?,event_count=event_count+?,
  chunk_count=chunk_count+? WHERE singleton=1`);

function applyRows(rows, completedChunk) {
  if (rows.length === 0) return;
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

function emitConcentration(cutoff, cutoffIndex) {
  const negatives = db.prepare(`SELECT COUNT(*) count FROM historical_balances WHERE quantity<0`).get().count;
  if (Number(negatives) !== 0) throw new Error(`Negative balances at ${cutoff.label}: ${negatives}`);
  db.exec(`DROP TABLE IF EXISTS temp.effective_holders;
    DROP TABLE IF EXISTS temp.cutoff_owners;
    CREATE TEMP TABLE effective_holders AS
      SELECT asset_id,COALESCE(utxo_address_id,holder_id) holder_id,SUM(quantity) quantity
      FROM historical_balances WHERE quantity>0 AND asset_id NOT IN (1,2)
      GROUP BY asset_id,COALESCE(utxo_address_id,holder_id) HAVING SUM(quantity)>0;
    CREATE INDEX temp.idx_effective_asset_quantity
      ON effective_holders(asset_id,quantity DESC,holder_id);
    CREATE TEMP TABLE cutoff_owners AS
      WITH ranked AS (
        SELECT asset_id,issuer_id,divisible,
          ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY event_index) creator_rank,
          ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY event_index DESC) owner_rank
        FROM issuance_history WHERE block_index<=${cutoff.block}
      )
      SELECT asset_id,MAX(CASE WHEN creator_rank=1 THEN issuer_id END) creator_id,
        MAX(CASE WHEN owner_rank=1 THEN issuer_id END) owner_id,
        MAX(CASE WHEN owner_rank=1 THEN divisible END) divisible
      FROM ranked GROUP BY asset_id;
    CREATE UNIQUE INDEX temp.idx_cutoff_owners_asset ON cutoff_owners(asset_id);
    INSERT OR REPLACE INTO historical_concentration
      (cutoff_label,cutoff_block,asset_id,holders,total_quantity,top1_quantity,top5_quantity,
       creator_id,owner_id,creator_quantity,owner_quantity,
       largest_non_creator_quantity,largest_non_owner_quantity,divisible,normalized_supply,
       top1_holder_id,largest_non_creator_holder_id,largest_non_owner_holder_id)
    WITH ranked AS (
      SELECT holder.asset_id,holder.holder_id,holder.quantity,owner.creator_id,owner.owner_id,owner.divisible,
        ROW_NUMBER() OVER(PARTITION BY holder.asset_id ORDER BY holder.quantity DESC,holder.holder_id) rank,
        ROW_NUMBER() OVER(PARTITION BY holder.asset_id
          ORDER BY (holder.holder_id=owner.creator_id),holder.quantity DESC,holder.holder_id) non_creator_rank,
        ROW_NUMBER() OVER(PARTITION BY holder.asset_id
          ORDER BY (holder.holder_id=owner.owner_id),holder.quantity DESC,holder.holder_id) non_owner_rank
      FROM effective_holders holder LEFT JOIN cutoff_owners owner ON owner.asset_id=holder.asset_id
    )
    SELECT '${cutoff.label}',${cutoff.block},asset_id,COUNT(*),SUM(quantity),
      MAX(CASE WHEN rank=1 THEN quantity ELSE 0 END),
      SUM(CASE WHEN rank<=5 THEN quantity ELSE 0 END),creator_id,owner_id,
      SUM(CASE WHEN holder_id=creator_id THEN quantity ELSE 0 END),
      SUM(CASE WHEN holder_id=owner_id THEN quantity ELSE 0 END),
      MAX(CASE WHEN holder_id<>creator_id OR creator_id IS NULL THEN quantity ELSE 0 END),
      MAX(CASE WHEN holder_id<>owner_id OR owner_id IS NULL THEN quantity ELSE 0 END),
      COALESCE(divisible,0),SUM(quantity)/CASE WHEN COALESCE(divisible,0)=1 THEN 1e8 ELSE 1 END,
      MAX(CASE WHEN rank=1 THEN holder_id END),
      MAX(CASE WHEN non_creator_rank=1 AND holder_id<>creator_id THEN holder_id END),
      MAX(CASE WHEN non_owner_rank=1 AND holder_id<>owner_id THEN holder_id END)
    FROM ranked GROUP BY asset_id;
    UPDATE historical_replay_state SET next_cutoff=${cutoffIndex + 1} WHERE singleton=1;
    DROP TABLE temp.effective_holders;
    DROP TABLE temp.cutoff_owners;`);
  const count = db
    .prepare(`SELECT COUNT(*) count FROM historical_concentration WHERE cutoff_label=?`)
    .get(cutoff.label).count;
  process.stderr.write(`concentration ${cutoff.label}: ${count} assets\n`);
}

let completedThisRun = 0;
for (const name of chunks) {
  if (stopAfterChunks && completedThisRun >= stopAfterChunks) break;
  const rows = readFileSync(resolve(root, name), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const pending = rows.filter((row) => Number(row.event_index) > Number(state().cursor));
  if (pending.length === 0) continue;
  let offset = 0;
  while (offset < pending.length) {
    const next = cutoffs[Number(state().next_cutoff)];
    if (!next) break;
    let end = offset;
    while (end < pending.length && Number(pending[end].block_index) <= next.block) end++;
    if (end > offset) applyRows(pending.slice(offset, end), end === pending.length);
    offset = end;
    if (offset < pending.length) emitConcentration(next, Number(state().next_cutoff));
  }
  if (offset < pending.length && !cutoffs[Number(state().next_cutoff)]) break;
  if (offset === pending.length && Number(state().cursor) < Number(pending.at(-1).event_index))
    applyRows(pending.slice(offset), true);
  completedThisRun++;
}
while (Number(state().next_cutoff) < cutoffs.length) {
  const next = cutoffs[Number(state().next_cutoff)];
  const latestBlock = db.prepare(`SELECT MAX(last_event_index) value FROM historical_balances`).get().value;
  if (latestBlock == null || Number(state().cursor) < ownership.frontier_event_index) break;
  emitConcentration(next, Number(state().next_cutoff));
}

const finalState = state();
const report = {
  schema: "xcp-radar-concentration/1",
  cutoffs,
  ...finalState,
  complete: Number(finalState.next_cutoff) === cutoffs.length,
  feature_rows: Number(db.prepare(`SELECT COUNT(*) count FROM historical_concentration`).get().count),
};
writeFileSync(resolve(root, "concentration.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
