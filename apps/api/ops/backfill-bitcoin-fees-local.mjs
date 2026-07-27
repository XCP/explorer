#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dbPath =
  process.argv.find((x) => x.startsWith("--database="))?.slice(11) ?? "C:/BitcoinIndex/counterparty-bitcoin.sqlite";
const rpcUrl = process.argv.find((x) => x.startsWith("--rpc-url="))?.slice(10) ?? "http://127.0.0.1:8332/";
const cookiePath = process.argv.find((x) => x.startsWith("--cookie="))?.slice(9) ?? "C:/BitcoinFastState/.cookie";
const db = new DatabaseSync(dbPath);
const auth = `Basic ${Buffer.from(readFileSync(cookiePath, "utf8").trim()).toString("base64")}`;
let id = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "1.0", id: ++id, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const missing = db
  .prepare(
    `SELECT lower(hex(w.tx_hash)) tx_hash,w.expected_block_height block_height
  FROM counterparty_tx_watch w LEFT JOIN counterparty_tx_fee f ON f.tx_hash=w.tx_hash
  WHERE f.tx_hash IS NULL ORDER BY w.expected_block_height,w.tx_index`,
  )
  .all();
const insert = db.prepare(
  "INSERT OR IGNORE INTO counterparty_tx_fee(tx_hash,block_height,fee_sats,published_at) VALUES(?,?,?,NULL)",
);
let resolved = 0;
const failures = [];
for (const row of missing) {
  try {
    const tx = await rpc("getrawtransaction", [row.tx_hash, 2]);
    let inputSats = 0;
    for (const input of tx.vin ?? []) {
      if (input.coinbase) continue;
      let prevout = input.prevout;
      if (!prevout) {
        const previous = await rpc("getrawtransaction", [input.txid, 2]);
        prevout = previous.vout?.[input.vout];
      }
      if (!prevout || !Number.isFinite(prevout.value)) throw new Error(`missing prevout ${input.txid}:${input.vout}`);
      inputSats += Math.round(prevout.value * 100_000_000);
    }
    const outputSats = (tx.vout ?? []).reduce((sum, output) => sum + Math.round(Number(output.value) * 100_000_000), 0);
    const fee = inputSats - outputSats;
    if (!Number.isSafeInteger(fee) || fee < 0) throw new Error(`invalid fee ${fee}`);
    insert.run(Buffer.from(row.tx_hash, "hex"), row.block_height, fee);
    resolved += 1;
    if (resolved % 25 === 0)
      console.log(
        JSON.stringify({
          event: "local_fee_progress",
          resolved,
          remaining: missing.length - resolved,
          tx_hash: row.tx_hash,
        }),
      );
  } catch (error) {
    failures.push({ tx_hash: row.tx_hash, block_height: row.block_height, error: String(error?.message ?? error) });
  }
}
console.log(
  JSON.stringify({
    event: "local_fee_complete",
    requested: missing.length,
    resolved,
    failed: failures.length,
    failures,
  }),
);
