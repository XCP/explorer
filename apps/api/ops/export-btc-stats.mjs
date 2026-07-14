#!/usr/bin/env node
/**
 * Bitcoin-side address summaries -> POST /admin/btc-stats.
 * The Counterparty mirror is blind to plain BTC activity; this bridges it from an address-indexed source.
 *
 * Source modes:
 *   --source=esplora   (default) Esplora REST API — works TODAY against a public instance
 *                      (https://blockstream.info/api or https://mempool.space/api) for incremental /
 *                      small batches, or against a self-hosted esplora for bulk. One GET per address.
 *   (planned) --source=fulcrum   local Core+Fulcrum electrum protocol for full-universe bulk sweeps.
 *   (planned) --source=counterparty  the CP node's /v2/bitcoin proxy (balance-grade only).
 *
 * Usage:
 *   node ops/export-btc-stats.mjs --api=https://xcp-api.me-bbe.workers.dev --token-file=admin.tok \
 *     [--base=https://blockstream.info/api] [--offset=0] [--max=1000] [--rps=4]
 *
 * Resumable: prints the next offset on exit; pass it back via --offset. Be a good citizen on public
 * instances: keep --rps low (default 4) and --max bounded; bulk sweeps belong on your own node.
 */
import { readFileSync } from "node:fs";

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const API = arg("api", "https://xcp-api.me-bbe.workers.dev");
const BASE = arg("base", "https://blockstream.info/api");
const TOKEN = readFileSync(arg("token-file", "admin.tok"), "utf8").trim();
const MAX = parseInt(arg("max", "1000"), 10);
const RPS = Math.max(1, parseInt(arg("rps", "4"), 10));
let offset = parseInt(arg("offset", "0"), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

// Esplora: GET /address/{addr} -> chain_stats { funded_txo_sum, spent_txo_sum, funded_txo_count, tx_count }
// (sats). last activity block from the newest confirmed tx (one extra call, only when tx_count > 0).
async function esploraSummary(addr) {
  const a = await getJson(`${BASE}/address/${addr}`);
  const cs = a.chain_stats ?? {};
  const received = (cs.funded_txo_sum ?? 0) / 1e8;
  const sent = (cs.spent_txo_sum ?? 0) / 1e8;
  const row = {
    addr,
    btc_received: received,
    btc_sent: sent,
    btc_balance: received - sent,
    btc_txs: cs.tx_count ?? 0,
    btc_first_block: null, // full history paging is a bulk-node job; esplora mode records last activity only
    btc_last_block: null,
  };
  if (row.btc_txs > 0) {
    const txs = await getJson(`${BASE}/address/${addr}/txs`).catch(() => []);
    const confirmed = Array.isArray(txs) ? txs.find((t) => t.status?.confirmed) : null;
    row.btc_last_block = confirmed?.status?.block_height ?? null;
  }
  return row;
}

async function push(rows) {
  const res = await fetch(`${API}/admin/btc-stats`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
}

let done = 0;
const failures = [];
while (done < MAX) {
  const page = await getJson(`${API}/admin/btc-stats/addresses?limit=${Math.min(200, MAX - done)}&offset=${offset}`, {
    Authorization: `Bearer ${TOKEN}`,
  });
  const addrs = page.result ?? [];
  if (addrs.length === 0) break;
  const rows = [];
  for (const addr of addrs) {
    try {
      rows.push(await esploraSummary(addr));
    } catch (e) {
      failures.push(addr);
      if (failures.length > 25) throw new Error(`too many source failures (last: ${e.message})`);
    }
    await sleep(1000 / RPS);
    if (rows.length === 100) {
      await push(rows.splice(0));
    }
  }
  if (rows.length) await push(rows);
  offset = page.next_offset ?? offset + addrs.length;
  done += addrs.length;
  console.log(`progress: ${done} addresses, next offset ${offset}, failures ${failures.length}`);
  if (page.next_offset == null) break;
}
console.log(`DONE. next --offset=${offset}${failures.length ? ` | failed: ${failures.join(",")}` : ""}`);
