#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const dbPath =
  process.argv.find((x) => x.startsWith("--database="))?.slice(11) ?? "C:/BitcoinIndex/counterparty-bitcoin.sqlite";
const cookiePath = process.argv.find((x) => x.startsWith("--cookie="))?.slice(9) ?? "C:/BitcoinFastState/.cookie";
const rpcUrl = process.argv.find((x) => x.startsWith("--rpc-url="))?.slice(10) ?? "http://127.0.0.1:8332/";
const db = new DatabaseSync(dbPath);
const auth = `Basic ${Buffer.from(readFileSync(cookiePath, "utf8").trim()).toString("base64")}`;
let id = 0;
async function rpc(method, params = []) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "1.0", id: ++id, method, params }),
  });
  const b = await r.json();
  if (b.error) throw Error(`${method}: ${JSON.stringify(b.error)}`);
  return b.result;
}
const rows = db
  .prepare(
    `SELECT lower(hex(w.tx_hash)) tx_hash,w.expected_block_height block_height FROM counterparty_tx_watch w LEFT JOIN counterparty_tx_fee f ON f.tx_hash=w.tx_hash WHERE f.tx_hash IS NULL ORDER BY w.expected_block_height`,
  )
  .all();
const byBlock = new Map();
for (const r of rows) {
  if (!byBlock.has(r.block_height)) byBlock.set(r.block_height, []);
  byBlock.get(r.block_height).push(r);
}
const insert = db.prepare(
  "INSERT OR IGNORE INTO counterparty_tx_fee(tx_hash,block_height,fee_sats,published_at) VALUES(?,?,?,NULL)",
);
let resolved = 0,
  absent = 0,
  failures = [];
for (const [height, wanted] of byBlock) {
  try {
    const hash = await rpc("getblockhash", [height]);
    const block = await rpc("getblock", [hash, 3]);
    const txs = new Map();
    for (const t of block.tx ?? []) {
      txs.set(t.txid, t);
      if (t.hash) txs.set(t.hash, t);
    }
    for (const row of wanted) {
      const tx = txs.get(row.tx_hash);
      if (!tx) {
        absent++;
        continue;
      }
      let feeSats = Number.isFinite(tx.fee) ? Math.round(tx.fee * 1e8) : null;
      if (feeSats === null) {
        let input = 0;
        for (const vin of tx.vin ?? []) {
          if (vin.coinbase) continue;
          const p = vin.prevout;
          if (!p || !Number.isFinite(p.value)) throw Error(`missing prevout ${vin.txid}:${vin.vout}`);
          input += Math.round(p.value * 1e8);
        }
        const output = (tx.vout ?? []).reduce((s, v) => s + Math.round(Number(v.value) * 1e8), 0);
        feeSats = input - output;
      }
      if (!Number.isSafeInteger(feeSats) || feeSats < 0) throw Error(`invalid fee ${feeSats}`);
      insert.run(Buffer.from(row.tx_hash, "hex"), height, feeSats);
      resolved++;
    }
    console.log(JSON.stringify({ event: "block_fee_progress", height, requested: wanted.length, resolved, absent }));
  } catch (error) {
    failures.push({ height, error: String(error?.message ?? error) });
  }
}
console.log(
  JSON.stringify({
    event: "block_fee_complete",
    requested: rows.length,
    resolved,
    absent,
    failed_blocks: failures.length,
    failures,
  }),
);
