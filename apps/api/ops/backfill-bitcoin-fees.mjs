#!/usr/bin/env node
import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const API = arg("api", "https://xcp-api.me-bbe.workers.dev").replace(/\/$/, "");
const COUNTERPARTY = arg("counterparty", "https://api.counterparty.io:4000/api/");
const devToken = readFileSync(".dev.vars", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("ADMIN_TOKEN="))
  ?.slice("ADMIN_TOKEN=".length)
  .replace(/^"|"$/g, "");
const TOKEN = process.env.ADMIN_TOKEN ?? devToken ?? readFileSync(arg("token-file", "admin.tok"), "utf8").trim();
const PAGE_SIZE = Number(arg("page-size", "1000"));
const RPC_BATCH_SIZE = Number(arg("rpc-batch-size", "100"));
const RPC_CONCURRENCY = Number(arg("rpc-concurrency", "1"));
const MAX_PAGES = Number(arg("max-pages", "0"));

if (!Number.isSafeInteger(PAGE_SIZE) || PAGE_SIZE < 1 || PAGE_SIZE > 10_000) throw new Error("invalid page-size");
if (!Number.isSafeInteger(RPC_BATCH_SIZE) || RPC_BATCH_SIZE < 1 || RPC_BATCH_SIZE > 500)
  throw new Error("invalid rpc-batch-size");
if (!Number.isSafeInteger(RPC_CONCURRENCY) || RPC_CONCURRENCY < 1 || RPC_CONCURRENCY > 4)
  throw new Error("invalid rpc-concurrency");
if (!Number.isSafeInteger(MAX_PAGES) || MAX_PAGES < 0) throw new Error("invalid max-pages");

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function transactions(txids) {
  let failure;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(COUNTERPARTY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "getrawtransaction_batch",
          params: { txhash_list: txids, verbose: true },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Counterparty Bitcoin RPC: ${response.status} ${await response.text()}`);
      const payload = await response.json();
      if (!payload.result || typeof payload.result !== "object")
        throw new Error(`Counterparty Bitcoin RPC: ${JSON.stringify(payload.error ?? payload).slice(0, 300)}`);
      return payload.result;
    } catch (error) {
      failure = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt)));
    }
  }
  throw failure;
}

function sats(value) {
  const amount = Math.round(Number(value) * 100_000_000);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`invalid Bitcoin amount: ${value}`);
  return amount;
}

async function calculateFees(rows) {
  const targetByHash = await transactions(rows.map((row) => row.tx_hash));
  const parentIds = [
    ...new Set(
      rows.flatMap((row) =>
        (targetByHash[row.tx_hash]?.vin ?? []).flatMap((vin) => (typeof vin.txid === "string" ? [vin.txid] : [])),
      ),
    ),
  ];
  const parentByHash = await transactions(parentIds);
  return rows.flatMap((row) => {
    const transaction = targetByHash[row.tx_hash];
    if (!transaction || !Array.isArray(transaction.vin) || !Array.isArray(transaction.vout)) return [];
    let inputs = 0;
    for (const vin of transaction.vin) {
      const output = parentByHash[vin.txid]?.vout?.[vin.vout];
      if (!output) return [];
      inputs += sats(output.value);
    }
    const outputs = transaction.vout.reduce((sum, output) => sum + sats(output.value), 0);
    const fee = inputs - outputs;
    return Number.isSafeInteger(fee) && fee >= 0 ? [{ tx_hash: row.tx_hash, fee }] : [];
  });
}

let total = 0;
let pages = 0;
for (;;) {
  if (MAX_PAGES > 0 && pages >= MAX_PAGES) break;
  const page = await api(`/admin/bitcoin-fees?limit=${PAGE_SIZE}`);
  if (!Array.isArray(page.rows) || page.rows.length === 0) break;
  const chunks = [];
  for (let index = 0; index < page.rows.length; index += RPC_BATCH_SIZE)
    chunks.push(page.rows.slice(index, index + RPC_BATCH_SIZE));
  const feeChunks = new Array(chunks.length);
  let chunkCursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(RPC_CONCURRENCY, chunks.length) }, async () => {
      while (chunkCursor < chunks.length) {
        const index = chunkCursor++;
        feeChunks[index] = await calculateFees(chunks[index]);
      }
    }),
  );
  const fees = feeChunks.flat();
  const verified = fees.length;
  let updated = 0;
  for (let write = 0; write < fees.length; write += 100) {
    const result = await api("/admin/bitcoin-fees", {
      method: "POST",
      body: JSON.stringify(fees.slice(write, write + 100)),
    });
    updated += Number(result.updated ?? 0);
  }
  total += updated;
  pages += 1;
  console.log(JSON.stringify({ total, requested: page.rows.length, verified, updated, next_tx: page.next }));
  if (updated === 0) throw new Error("fee backfill made no progress; inspect the remaining Bitcoin RPC failures");
}

console.log(JSON.stringify({ complete: MAX_PAGES === 0, pages, updated: total }));
