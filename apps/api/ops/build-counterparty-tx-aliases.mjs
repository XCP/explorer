#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("C:/BitcoinIndex/counterparty-bitcoin.sqlite");
const auth = `Basic ${Buffer.from(readFileSync("C:/BitcoinFastState/.cookie", "utf8").trim()).toString("base64")}`;
let id = 0;
async function rpc(method, params = []) {
  const r = await fetch("http://127.0.0.1:8332/", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "1.0", id: ++id, method, params }),
  });
  const b = await r.json();
  if (b.error) throw Error(JSON.stringify(b.error));
  return b.result;
}
db.exec(
  "CREATE TABLE IF NOT EXISTS counterparty_tx_alias(source_hash BLOB PRIMARY KEY,tx_id INTEGER NOT NULL,canonical_hash BLOB NOT NULL) WITHOUT ROWID",
);
const ins = db.prepare("INSERT OR REPLACE INTO counterparty_tx_alias(source_hash,tx_id,canonical_hash) VALUES(?,?,?)");
const txins = db.prepare(
  "INSERT OR IGNORE INTO btc_tx(tx_hash,block_height,tx_position,block_time,fee_sats,flags) VALUES(?,?,?,?,?,2)",
);
const rows = db
  .prepare(
    "SELECT lower(hex(w.tx_hash)) source_hash,w.expected_block_height h FROM counterparty_tx_watch w JOIN counterparty_tx_fee f ON f.tx_hash=w.tx_hash LEFT JOIN btc_tx t ON t.tx_hash=w.tx_hash WHERE t.tx_id IS NULL",
  )
  .all();
const by = new Map();
for (const r of rows) {
  if (!by.has(r.h)) by.set(r.h, []);
  by.get(r.h).push(r);
}
let found = 0,
  absent = 0;
for (const [h, wanted] of by) {
  const bh = await rpc("getblockhash", [h]);
  const b = await rpc("getblock", [bh, 3]);
  const m = new Map();
  for (const t of b.tx ?? []) {
    if (t.hash) m.set(t.hash, t);
    m.set(t.txid, t);
  }
  for (const r of wanted) {
    const t = m.get(r.source_hash);
    if (!t) {
      absent++;
      continue;
    }
    let row = db.prepare("SELECT tx_id FROM btc_tx WHERE tx_hash=?").get(Buffer.from(t.txid, "hex"));
    if (!row) {
      const pos = b.tx.findIndex((x) => x.txid === t.txid);
      txins.run(Buffer.from(t.txid, "hex"), h, pos, b.time, Math.round(Number(t.fee ?? 0) * 1e8));
      row = db.prepare("SELECT tx_id FROM btc_tx WHERE tx_hash=?").get(Buffer.from(t.txid, "hex"));
    }
    if (!row) {
      absent++;
      continue;
    }
    ins.run(Buffer.from(r.source_hash, "hex"), row.tx_id, Buffer.from(t.txid, "hex"));
    found++;
  }
  console.log(JSON.stringify({ height: h, found, absent }));
}
console.log(JSON.stringify({ requested: rows.length, found, absent }));
