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
  if (txids.length === 0) return {};
  let failure;
  const attempts = txids.length <= 10 ? 4 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
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
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const error = new Error(`Counterparty Bitcoin RPC: ${response.status} ${await response.text()}`);
        error.status = response.status;
        error.retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
        throw error;
      }
      const payload = await response.json();
      if (!payload.result || typeof payload.result !== "object")
        throw new Error(`Counterparty Bitcoin RPC: ${JSON.stringify(payload.error ?? payload).slice(0, 300)}`);
      return payload.result;
    } catch (error) {
      failure = error;
      if (attempt + 1 < attempts) {
        const wait = error?.status === 429 ? (error.retryAfter || 30) * 1_000 : 1_000 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  // Large batch responses occasionally exceed the provider's stream timeout. Split them until each request
  // is small enough; a persistently failing <=10-item leaf is reported to the page loop for a later pass.
  if (failure?.status !== 429 && txids.length > 10) {
    const middle = Math.ceil(txids.length / 2);
    const [left, right] = await Promise.all([transactions(txids.slice(0, middle)), transactions(txids.slice(middle))]);
    return { ...left, ...right };
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
let after = null;
let passUpdated = 0;
let complete = false;
for (;;) {
  if (MAX_PAGES > 0 && pages >= MAX_PAGES) break;
  const page = await api(`/admin/bitcoin-fees?limit=${PAGE_SIZE}${after == null ? "" : `&after=${after}`}`);
  if (!Array.isArray(page.rows) || page.rows.length === 0) {
    if (after == null) {
      complete = true;
      break;
    }
    if (passUpdated === 0) throw new Error("fee backfill pass made no progress; inspect unresolved RPC failures");
    after = null;
    passUpdated = 0;
    continue;
  }
  const chunks = [];
  for (let index = 0; index < page.rows.length; index += RPC_BATCH_SIZE)
    chunks.push(page.rows.slice(index, index + RPC_BATCH_SIZE));
  let chunkCursor = 0;
  let verified = 0;
  let updated = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(RPC_CONCURRENCY, chunks.length) }, async () => {
      while (chunkCursor < chunks.length) {
        const index = chunkCursor++;
        try {
          const fees = await calculateFees(chunks[index]);
          verified += fees.length;
          for (let write = 0; write < fees.length; write += 100) {
            const result = await api("/admin/bitcoin-fees", {
              method: "POST",
              body: JSON.stringify(fees.slice(write, write + 100)),
            });
            updated += Number(result.updated ?? 0);
          }
        } catch (error) {
          failed += chunks[index].length;
          console.error(
            JSON.stringify({
              event: "fee_chunk_failed",
              first_tx: chunks[index][0]?.tx_index,
              rows: chunks[index].length,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
    }),
  );
  total += updated;
  passUpdated += updated;
  pages += 1;
  after = page.next;
  console.log(JSON.stringify({ total, requested: page.rows.length, verified, updated, failed, next_tx: after }));
}

console.log(JSON.stringify({ complete, pages, updated: total }));
