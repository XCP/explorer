#!/usr/bin/env node

/** Find likely BTC purchases of whole Counterparty addresses delivered by SWEEP. */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const bitcoinPath = resolve("C:/BitcoinIndex/counterparty-bitcoin.sqlite");
const shadowPath = resolve("C:/BitcoinIndex/otc-sweep-shadow-v3.sqlite");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(shadowPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;
  DROP TABLE IF EXISTS sweep;
  CREATE TABLE sweep(
    tx_index INTEGER PRIMARY KEY,tx_hash BLOB NOT NULL,block_index INTEGER NOT NULL,
    block_time INTEGER,source TEXT NOT NULL,destination TEXT NOT NULL,flags INTEGER NOT NULL,
    source_excluded INTEGER NOT NULL,destination_excluded INTEGER NOT NULL
  );`);

const rows = executeRemoteD1(`SELECT sweep.tx_index,lower(hex(sweep.tx_hash)) tx_hash,
    sweep.block_index,sweep.block_time,source.address source,destination.address destination,
    sweep.flags,
    max(coalesce(source_signal.is_exchange,0),coalesce(source_signal.is_deposit,0),
      coalesce(source_signal.is_burn,0),coalesce(source_signal.is_emblem_vault,0)) source_excluded,
    max(coalesce(destination_signal.is_exchange,0),coalesce(destination_signal.is_deposit,0),
      coalesce(destination_signal.is_burn,0),coalesce(destination_signal.is_emblem_vault,0)) destination_excluded
  FROM sweeps sweep
  JOIN address_dictionary source ON source.address_id=sweep.source_id
  JOIN address_dictionary destination ON destination.address_id=sweep.destination_id
  LEFT JOIN address_signals source_signal ON source_signal.address_id=sweep.source_id
  LEFT JOIN address_signals destination_signal ON destination_signal.address_id=sweep.destination_id
  WHERE sweep.status='valid' ORDER BY sweep.block_index,sweep.tx_index`).rows;
const insert = db.prepare("INSERT INTO sweep VALUES(?,?,?,?,?,?,?,?,?)");
db.exec("BEGIN IMMEDIATE");
for (const row of rows)
  insert.run(
    row.tx_index,
    Buffer.from(row.tx_hash, "hex"),
    row.block_index,
    row.block_time,
    row.source,
    row.destination,
    row.flags,
    row.source_excluded,
    row.destination_excluded,
  );
db.exec("COMMIT");

db.exec(`ATTACH DATABASE ${quote(bitcoinPath)} AS bitcoin;`);
const watermark = Number(
  db.prepare("SELECT block_height FROM bitcoin.scan_state WHERE singleton=1").get().block_height,
);
db.exec(`DROP TABLE IF EXISTS raw_match;
  CREATE TABLE raw_match AS
  SELECT sweep.*,payer.address_id payer_id,payee.address_id payee_id,
    tx.tx_id,tx.tx_hash btc_tx_hash,tx.block_height btc_block,tx.block_time btc_time,
    flow.value_sats payment_sats,flow.payer_input_count,flow.payee_output_count,
    flow.attribution_flags,tx.block_height-sweep.block_index relative_blocks
  FROM sweep
  JOIN bitcoin.watched_address payer ON payer.address=sweep.destination
  JOIN bitcoin.watched_address payee ON payee.address=sweep.source
  JOIN bitcoin.btc_direct_flow flow ON flow.payer_id=payer.address_id AND flow.payee_id=payee.address_id
  JOIN bitcoin.btc_tx tx ON tx.tx_id=flow.tx_id
  WHERE sweep.block_index<=${watermark} AND tx.block_height<=${watermark}
    AND tx.block_height BETWEEN sweep.block_index-24 AND sweep.block_index+3
    AND flow.value_sats>=1000 AND (flow.attribution_flags&13)=0
    AND sweep.source<>sweep.destination
    AND NOT EXISTS(SELECT 1 FROM bitcoin.counterparty_tx_watch protocol WHERE protocol.tx_hash=tx.tx_hash)
    AND EXISTS(SELECT 1 FROM bitcoin.btc_direct_flow change
      WHERE change.tx_id=flow.tx_id AND change.payer_id=flow.payer_id AND change.payee_id=flow.payer_id);

  DROP TABLE IF EXISTS candidate;
  CREATE TABLE candidate AS
  WITH ranked AS (
    SELECT raw.*,
      count(*) OVER(PARTITION BY tx_index) competing_payments,
      count(*) OVER(PARTITION BY tx_id) competing_sweeps
    FROM raw_match raw
  )
  SELECT * FROM ranked WHERE competing_payments=1 AND competing_sweeps=1;
  CREATE UNIQUE INDEX candidate_sweep ON candidate(tx_index);
  CREATE UNIQUE INDEX candidate_payment ON candidate(tx_id);`);

const summary = {
  indexed_through: watermark,
  sweeps_total: rows.length,
  sweeps_covered: Number(db.prepare("SELECT count(*) n FROM sweep WHERE block_index<=?").get(watermark).n),
  raw_matches: Number(db.prepare("SELECT count(*) n FROM raw_match").get().n),
  unique_candidates: Number(db.prepare("SELECT count(*) n FROM candidate").get().n),
  clean_candidates: Number(
    db.prepare("SELECT count(*) n FROM candidate WHERE source_excluded=0 AND destination_excluded=0").get().n,
  ),
  btc: Number(
    db
      .prepare(
        "SELECT round(sum(payment_sats)/1e8,8) btc FROM candidate WHERE source_excluded=0 AND destination_excluded=0",
      )
      .get().btc ?? 0,
  ),
  timing: db
    .prepare(
      `SELECT relative_blocks,count(*) candidates,round(sum(payment_sats)/1e8,8) btc
      FROM candidate WHERE source_excluded=0 AND destination_excluded=0
      GROUP BY relative_blocks ORDER BY relative_blocks`,
    )
    .all(),
  examples: db
    .prepare(
      `SELECT lower(hex(tx_hash)) sweep_tx,lower(hex(btc_tx_hash)) btc_tx,block_index sweep_block,
      btc_block,relative_blocks,source,destination,flags,payment_sats,
      round(payment_sats/1e8,8) btc
      FROM candidate WHERE source_excluded=0 AND destination_excluded=0
      ORDER BY payment_sats DESC LIMIT 50`,
    )
    .all(),
};
console.log(JSON.stringify(summary, null, 2));
db.close();
