#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const sourcePath = resolve(option("source", ".codex-tmp/xcpio-core-export.sql"));
const databasePath = resolve(option("database", "D:\\Bitcoin\\counterparty-index\\counterparty-bitcoin.sqlite"));
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE");
const insert = db.prepare(`
  INSERT OR IGNORE INTO counterparty_tx_watch(tx_hash,tx_index,expected_block_height)
  VALUES(?,?,?)
`);
const insertAddress = db.prepare("INSERT OR IGNORE INTO watched_address(address_id,address) VALUES(?,?)");

function splitSqlValues(text) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "'") {
      value += character;
      if (quoted && text[index + 1] === "'") {
        value += text[++index];
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function sqlBlob(value) {
  const blob = /^X'([0-9a-f]+)'$/i.exec(value);
  if (blob) return Buffer.from(blob[1], "hex");
  const string = /^'([0-9a-f]{64})'$/i.exec(value);
  if (string) return Buffer.from(string[1], "hex");
  throw new Error(`Unsupported transaction hash representation: ${value.slice(0, 80)}`);
}

let rows = 0;
let addresses = 0;
let lines = 0;
let columns;
const input = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity });

try {
  for await (const line of input) {
    lines += 1;
    if (line.startsWith('INSERT INTO "address_dictionary" ')) {
      const addressMatch =
        /^INSERT INTO "address_dictionary" \("address_id","address"\) VALUES\((\d+),'((?:''|[^'])*)'\);$/.exec(line);
      if (!addressMatch) throw new Error(`Unrecognized address INSERT at line ${lines}`);
      const address = addressMatch[2].replaceAll("''", "'");
      if (address.startsWith("1") || address.startsWith("3") || address.startsWith("bc1")) {
        insertAddress.run(Number.parseInt(addressMatch[1], 10), address);
        addresses += 1;
      }
      continue;
    }
    if (!line.startsWith('INSERT INTO "transactions" ')) continue;
    const match = /^INSERT INTO "transactions" \((.+)\) VALUES\((.*)\);$/.exec(line);
    if (!match) throw new Error(`Unrecognized transactions INSERT at line ${lines}`);
    const currentColumns = match[1].split(",").map((value) => value.trim().replaceAll('"', ""));
    if (!columns) columns = currentColumns;
    const values = splitSqlValues(match[2]);
    const txIndexPosition = currentColumns.indexOf("tx_index");
    const txHashPosition = currentColumns.indexOf("tx_hash");
    const blockPosition = currentColumns.indexOf("block_index");
    if (txIndexPosition < 0 || txHashPosition < 0 || blockPosition < 0) {
      throw new Error("transactions export omitted a required column");
    }
    insert.run(
      sqlBlob(values[txHashPosition]),
      Number.parseInt(values[txIndexPosition], 10),
      Number.parseInt(values[blockPosition], 10),
    );
    rows += 1;
    if (rows % 100_000 === 0) {
      db.exec("COMMIT; BEGIN IMMEDIATE");
      console.log(JSON.stringify({ event: "progress", rows, addresses, lines }));
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify({ event: "complete", rows, addresses, lines, columns }));
