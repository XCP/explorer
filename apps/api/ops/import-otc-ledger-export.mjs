#!/usr/bin/env node

import { createReadStream, existsSync, renameSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const sourcePath = resolve(option("source", ".codex-tmp/otc-ledger-export.sql"));
const destinationPath = resolve(option("database", "C:/BitcoinIndex/otc-ledger.sqlite"));
const stagingPath = `${destinationPath}.building`;
const batchLines = Math.max(100, Number(option("batch-lines", "5000")));

if (!existsSync(sourcePath)) throw new Error(`Missing source export: ${sourcePath}`);
rmSync(stagingPath, { force: true });

const db = new DatabaseSync(stagingPath);
db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=OFF;");

const input = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity });
let statements = [];
let lines = 0;
let inserts = 0;

function flush() {
  if (!statements.length) return;
  db.exec(`BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
  statements = [];
}

try {
  for await (const line of input) {
    lines += 1;
    const sql = line.trim();
    if (!sql || sql.startsWith("PRAGMA defer_foreign_keys")) continue;
    statements.push(sql);
    if (sql.startsWith("INSERT INTO")) inserts += 1;
    if (statements.length >= batchLines) {
      flush();
      if (inserts > 0 && inserts % 250_000 < batchLines) {
        console.log(JSON.stringify({ event: "progress", lines, inserts }));
      }
    }
  }
  flush();
  db.exec(`
    CREATE INDEX IF NOT EXISTS otc_sends_delivery
      ON sends(destination_id,source_id,block_index,event_index);
    CREATE INDEX IF NOT EXISTS otc_sends_delivery_address
      ON sends(destination_address_id,source_address_id,block_index,event_index)
      WHERE destination_address_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS otc_sends_block
      ON sends(block_index,event_index);
    CREATE INDEX IF NOT EXISTS otc_trade_legs_event
      ON trade_legs(leg_index);
    CREATE INDEX IF NOT EXISTS otc_prices_currency_day
      ON prices(currency,day);
    ANALYZE;
    PRAGMA optimize;
  `);
  const counts = Object.fromEntries(
    ["address_dictionary", "asset_dictionary", "sends", "address_signals", "prices", "trade_legs"].map((table) => [
      table,
      Number(db.prepare(`SELECT count(*) n FROM ${table}`).get().n),
    ]),
  );
  db.close();
  rmSync(destinationPath, { force: true });
  renameSync(stagingPath, destinationPath);
  console.log(JSON.stringify({ event: "complete", sourcePath, destinationPath, lines, inserts, counts }, null, 2));
} catch (error) {
  try {
    db.exec("ROLLBACK");
  } catch {}
  db.close();
  throw error;
}
