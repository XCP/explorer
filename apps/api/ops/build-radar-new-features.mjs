#!/usr/bin/env node

/** Replay exact holder state to a fixed age after each asset's first valid issuance. */
import { createReadStream, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const root = resolve(arg("input", ".analytics/radar/ownership"));
const ageDays = Number(arg("age-days", "30"));
if (!Number.isInteger(ageDays) || ageDays < 1 || ageDays > 365)
  throw new Error("age-days must be an integer from 1 through 365");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const blockReceipt = JSON.parse(readFileSync(resolve(root, "block-times.json"), "utf8"));
if (!manifest.complete || !blockReceipt.complete) throw new Error("Ownership and block-time snapshots must be complete");

const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
const blockRows = db.prepare(`SELECT block_index,block_time FROM block_times ORDER BY block_index`).all();
const blockTime = new Map(blockRows.map((row) => [Number(row.block_index), Number(row.block_time)]));
const frontierTime = blockTime.get(Number(manifest.frontier_block_index));
if (frontierTime == null) throw new Error(`Missing ownership-frontier block time ${manifest.frontier_block_index}`);
const firstIssuances = db
  .prepare(`WITH ranked AS (
    SELECT asset_id,event_index,block_index,issuer_id,divisible,
      ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY event_index) rank
    FROM issuance_history)
  SELECT asset_id,event_index,block_index,issuer_id,divisible FROM ranked WHERE rank=1`)
  .all();
const issuances = new Map();
const cutoffs = [];
for (const row of firstIssuances) {
  const issuedAt = blockTime.get(Number(row.block_index));
  if (issuedAt == null) throw new Error(`Missing block time for issuance at ${row.block_index}`);
  const cutoff = issuedAt + ageDays * 86400;
  if (cutoff > frontierTime) continue;
  const issuance = {
    assetId: Number(row.asset_id),
    eventIndex: Number(row.event_index),
    blockIndex: Number(row.block_index),
    issuedAt,
    cutoff,
    issuerId: Number(row.issuer_id),
    divisible: Number(row.divisible),
  };
  issuances.set(issuance.assetId, issuance);
  cutoffs.push(issuance);
}
cutoffs.sort((a, b) => a.cutoff - b.cutoff || a.assetId - b.assetId);

db.exec(`CREATE TABLE IF NOT EXISTS radar_new_features(
    age_days INTEGER NOT NULL,asset_id INTEGER NOT NULL,issuance_event_index INTEGER NOT NULL,
    issuance_block INTEGER NOT NULL,issued_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,
    issuer_id INTEGER NOT NULL,divisible INTEGER NOT NULL,holders INTEGER NOT NULL,
    raw_supply INTEGER NOT NULL,normalized_supply REAL NOT NULL,top1_quantity INTEGER NOT NULL,
    top5_quantity INTEGER NOT NULL,issuer_quantity INTEGER NOT NULL,ledger_events INTEGER NOT NULL,
    PRIMARY KEY(age_days,asset_id)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS radar_new_holders(
    age_days INTEGER NOT NULL,asset_id INTEGER NOT NULL,holder_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,is_utxo INTEGER NOT NULL,is_issuer INTEGER NOT NULL,
    PRIMARY KEY(age_days,asset_id,holder_id)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS radar_new_cohort_members(
    age_days INTEGER NOT NULL,frontier_event_index INTEGER NOT NULL,asset_id INTEGER NOT NULL,
    PRIMARY KEY(age_days,frontier_event_index,asset_id)) WITHOUT ROWID;`);
const upsert = db.prepare(`INSERT INTO radar_new_features(
    age_days,asset_id,issuance_event_index,issuance_block,issued_at,observed_at,issuer_id,divisible,
    holders,raw_supply,normalized_supply,top1_quantity,top5_quantity,issuer_quantity,ledger_events)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(age_days,asset_id) DO UPDATE SET
    issuance_event_index=excluded.issuance_event_index,issuance_block=excluded.issuance_block,
    issued_at=excluded.issued_at,observed_at=excluded.observed_at,issuer_id=excluded.issuer_id,
    divisible=excluded.divisible,holders=excluded.holders,raw_supply=excluded.raw_supply,
    normalized_supply=excluded.normalized_supply,top1_quantity=excluded.top1_quantity,
    top5_quantity=excluded.top5_quantity,issuer_quantity=excluded.issuer_quantity,
    ledger_events=excluded.ledger_events`);
const states = new Map();
const addMember = db.prepare(`INSERT OR IGNORE INTO radar_new_cohort_members(
  age_days,frontier_event_index,asset_id) VALUES(?,?,?)`);
const upsertHolder = db.prepare(`INSERT INTO radar_new_holders(
    age_days,asset_id,holder_id,quantity,is_utxo,is_issuer) VALUES(?,?,?,?,?,?)
  ON CONFLICT(age_days,asset_id,holder_id) DO UPDATE SET quantity=excluded.quantity,
    is_utxo=excluded.is_utxo,is_issuer=excluded.is_issuer`);
let cutoffCursor = 0;
let written = 0;
let negativeRows = 0;

function finalizeBefore(timestamp, inclusive = false) {
  while (
    cutoffCursor < cutoffs.length &&
    (inclusive ? cutoffs[cutoffCursor].cutoff <= timestamp : cutoffs[cutoffCursor].cutoff < timestamp)
  ) {
    const issuance = cutoffs[cutoffCursor++];
    const state = states.get(issuance.assetId);
    const positive = [];
    if (state) {
      for (const [holderId, balance] of state.balances) {
        if (balance.quantity > 0n) positive.push([holderId, balance.quantity, balance.isUtxo]);
        else if (balance.quantity < 0n) negativeRows++;
      }
    }
    positive.sort((a, b) => (a[1] === b[1] ? a[0] - b[0] : a[1] > b[1] ? -1 : 1));
    const supply = positive.reduce((sum, row) => sum + row[1], 0n);
    const top1 = positive[0]?.[1] ?? 0n;
    const top5 = positive.slice(0, 5).reduce((sum, row) => sum + row[1], 0n);
    const issuer = positive.find((row) => row[0] === issuance.issuerId)?.[1] ?? 0n;
    for (const [holderId, quantity, isUtxo] of positive)
      upsertHolder.run(ageDays, issuance.assetId, holderId, quantity, isUtxo ? 1 : 0, holderId === issuance.issuerId ? 1 : 0);
    upsert.run(
      ageDays,
      issuance.assetId,
      issuance.eventIndex,
      issuance.blockIndex,
      issuance.issuedAt,
      issuance.cutoff,
      issuance.issuerId,
      issuance.divisible,
      positive.length,
      supply,
      Number(supply) / (issuance.divisible ? 1e8 : 1),
      top1,
      top5,
      issuer,
      state?.events ?? 0,
    );
    addMember.run(ageDays, Number(manifest.frontier_event_index), issuance.assetId);
    states.delete(issuance.assetId);
    written++;
  }
}

const chunks = readdirSync(root)
  .filter((name) => /^\d{10}-\d{10}\.ndjson$/.test(name))
  .sort();
db.exec("BEGIN IMMEDIATE");
try {
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const lines = createInterface({ input: createReadStream(resolve(root, chunk)), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line);
      const timestamp = blockTime.get(Number(row.block_index));
      if (timestamp == null) throw new Error(`Missing block time for ledger event ${row.event_index}`);
      finalizeBefore(timestamp);
      const issuance = issuances.get(Number(row.asset_id));
      if (!issuance || timestamp < issuance.issuedAt || timestamp > issuance.cutoff) continue;
      let state = states.get(issuance.assetId);
      if (!state) {
        state = { balances: new Map(), events: 0 };
        states.set(issuance.assetId, state);
      }
      const isUtxo = row.utxo_address_id != null;
      const holderId = Number(row.utxo_address_id ?? row.address_id);
      const unsigned = BigInt(row.quantity);
      const delta = Number(row.direction) === 1 ? unsigned : -unsigned;
      const prior = state.balances.get(holderId);
      state.balances.set(holderId, {
        quantity: (prior?.quantity ?? 0n) + delta,
        isUtxo: prior?.isUtxo ?? isUtxo,
      });
      state.events++;
    }
    if ((chunkIndex + 1) % 50 === 0) process.stderr.write(`new features ${chunkIndex + 1}/${chunks.length}\n`);
  }
  finalizeBefore(frontierTime, true);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const stored = db.prepare(`SELECT COUNT(*) rows,MIN(feature.issued_at) min_issued_at,
  MAX(feature.issued_at) max_issued_at,SUM(feature.holders>0) assets_with_holders
  FROM radar_new_cohort_members member JOIN radar_new_features feature
    ON feature.age_days=member.age_days AND feature.asset_id=member.asset_id
  WHERE member.age_days=? AND member.frontier_event_index=?`).get(ageDays, Number(manifest.frontier_event_index));
const report = {
  schema: "xcp-radar-new-features/1",
  measured_at: new Date().toISOString(),
  age_days: ageDays,
  eligible_assets: cutoffs.length,
  written,
  negative_rows: negativeRows,
  stored: Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, Number(value)])),
  complete: written === cutoffs.length && Number(stored.rows) === cutoffs.length && negativeRows === 0,
};
writeFileSync(resolve(root, `new-features-${ageDays}d.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
