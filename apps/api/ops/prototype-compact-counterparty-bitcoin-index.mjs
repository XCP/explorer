#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const source = resolve(process.argv[2] ?? "C:\\BitcoinIndex\\counterparty-bitcoin.sqlite");
const destination = resolve(process.argv[3] ?? "C:\\BitcoinIndex\\counterparty-bitcoin-compact-prototype.sqlite");
const schemaPath = resolve("apps/api/ops/sql/counterparty-bitcoin-index.sql");
const POLICY_VERSION = "counterparty-bitcoin-index-v6-compact-external";

if (!existsSync(source)) throw new Error(`Source does not exist: ${source}`);
if (existsSync(destination)) rmSync(destination);

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(destination);
db.exec(`
  PRAGMA journal_mode=OFF;
  PRAGMA synchronous=OFF;
  PRAGMA temp_store=MEMORY;
  PRAGMA cache_size=-262144;
  ${readFileSync(schemaPath, "utf8")}
  PRAGMA foreign_keys=OFF;
  ATTACH DATABASE ${quote(source)} AS source;
`);

const secondaryIndexes = db
  .prepare(
    `SELECT name,sql FROM main.sqlite_schema
     WHERE type='index' AND sql IS NOT NULL
     ORDER BY name`,
  )
  .all();
for (const { name } of secondaryIndexes) db.exec(`DROP INDEX main.${name}`);

let started = Date.now();
db.exec(`
  CREATE TEMP TABLE keep_tx(tx_id INTEGER PRIMARY KEY);
  INSERT INTO keep_tx(tx_id)
  SELECT tx_id FROM source.btc_tx WHERE (flags&6)<>0
  UNION
  SELECT tx_id FROM source.btc_address_io GROUP BY tx_id HAVING count(DISTINCT address_id)>1;
`);
console.log(JSON.stringify({ event: "selected_detailed_transactions", elapsed_ms: Date.now() - started }));

const excluded = new Set([
  "btc_address_io",
  "btc_direct_flow",
  "btc_external_address",
  "btc_external_io",
  "btc_tx",
  "btc_unknown_script_io",
]);
const tables = db
  .prepare(
    `SELECT name FROM source.sqlite_schema
     WHERE type='table' AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE name
       WHEN 'index_metadata' THEN 0
       WHEN 'watched_address' THEN 1
       WHEN 'counterparty_tx_watch' THEN 2
       WHEN 'counterparty_utxo_watch' THEN 3
       WHEN 'btc_tx' THEN 4
       ELSE 5 END, name`,
  )
  .all()
  .map(({ name }) => name)
  .filter((name) => !excluded.has(name));

for (const table of tables) {
  if (!db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name=?").get(table)) continue;
  const started = Date.now();
  db.exec(`INSERT INTO main.${table} SELECT * FROM source.${table}`);
  console.log(JSON.stringify({ event: "copied", table, elapsed_ms: Date.now() - started }));
}

for (const table of ["btc_tx", "btc_address_io", "btc_direct_flow", "btc_unknown_script_io"]) {
  started = Date.now();
  db.exec(`INSERT INTO main.${table} SELECT selected.* FROM source.${table} AS selected JOIN keep_tx USING(tx_id)`);
  console.log(JSON.stringify({ event: "copied_detailed", table, elapsed_ms: Date.now() - started }));
}

started = Date.now();
db.exec(`
  INSERT INTO btc_address_monthly_stats(address_id,month_start,input_txs,output_txs,sats_in,sats_out)
  SELECT io.address_id,
    unixepoch(strftime('%Y-%m-01 00:00:00',tx.block_time,'unixepoch')),
    count(DISTINCT CASE WHEN io.direction=0 THEN io.tx_id END),
    count(DISTINCT CASE WHEN io.direction=1 THEN io.tx_id END),
    sum(CASE WHEN io.direction=1 THEN io.value_sats ELSE 0 END),
    sum(CASE WHEN io.direction=0 THEN io.value_sats ELSE 0 END)
  FROM source.btc_address_io io JOIN source.btc_tx tx USING(tx_id)
  GROUP BY io.address_id,unixepoch(strftime('%Y-%m-01 00:00:00',tx.block_time,'unixepoch'));
`);
console.log(JSON.stringify({ event: "built_monthly_address_stats", elapsed_ms: Date.now() - started }));

started = Date.now();
db.exec(`
  UPDATE btc_tx SET flags=flags|8 WHERE tx_id IN (
    SELECT tx_id FROM btc_direct_flow WHERE (attribution_flags&8)<>0
    UNION SELECT tx_id FROM btc_unknown_script_io WHERE direction=0
  );
`);
console.log(JSON.stringify({ event: "migrated_external_input_flags", elapsed_ms: Date.now() - started }));

for (const { name, sql } of secondaryIndexes) {
  started = Date.now();
  db.exec(sql);
  console.log(JSON.stringify({ event: "built_index", name, elapsed_ms: Date.now() - started }));
}

db.exec(`
  INSERT OR REPLACE INTO index_metadata(key,value)
  VALUES
    ('compact_prototype_source',${quote(source)}),
    ('compact_prototype_external_policy','external identity and raw events only for explicit watchlist'),
    ('policy_version',${quote(POLICY_VERSION)});
  UPDATE scan_state SET policy_version=${quote(POLICY_VERSION)} WHERE singleton=1;
  DETACH DATABASE source;
  PRAGMA optimize;
  PRAGMA foreign_keys=ON;
`);

const pages = db.prepare("SELECT page_count*page_size bytes FROM pragma_page_count(),pragma_page_size()").get();
const counts = {
  external_summaries: Number(db.prepare("SELECT count(*) n FROM btc_external_summary").get().n),
};
db.close();
console.log(JSON.stringify({ event: "complete", destination, bytes: Number(pages.bytes), counts }));
