#!/usr/bin/env node
import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const API = arg("api", "https://xcp-api.me-bbe.workers.dev").replace(/\/$/, "");
// Keep one-time bulk history off Counterparty's operational Electrs service. Both sources expose the same
// Bitcoin-indexed integer fee; production maintenance continues to use the configured Counterparty endpoint.
const ELECTRS = arg("electrs", "https://mempool.space/api").replace(/\/$/, "");
// Resolve local credentials relative to this script so unattended runners do not depend on their working directory.
const devToken = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("ADMIN_TOKEN="))
  ?.slice("ADMIN_TOKEN=".length)
  .replace(/^"|"$/g, "");
const TOKEN = process.env.ADMIN_TOKEN ?? devToken ?? readFileSync(arg("token-file", "admin.tok"), "utf8").trim();
const PAGE_SIZE = Number(arg("page-size", "500"));
const CONCURRENCY = Number(arg("concurrency", "2"));
const REQUEST_DELAY_MS = Number(arg("request-delay-ms", "100"));
const MAX_PAGES = Number(arg("max-pages", "0"));

if (!Number.isSafeInteger(PAGE_SIZE) || PAGE_SIZE < 1 || PAGE_SIZE > 5_000) throw new Error("invalid page-size");
if (!Number.isSafeInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 8) throw new Error("invalid concurrency");
if (!Number.isSafeInteger(REQUEST_DELAY_MS) || REQUEST_DELAY_MS < 0 || REQUEST_DELAY_MS > 60_000)
  throw new Error("invalid request-delay-ms");
if (!Number.isSafeInteger(MAX_PAGES) || MAX_PAGES < 0) throw new Error("invalid max-pages");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function fetchFee(txHash) {
  let failure;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${ELECTRS}/tx/${encodeURIComponent(txHash)}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        const error = new Error(`Electrs transaction ${response.status}`);
        error.status = response.status;
        error.retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
        throw error;
      }
      const transaction = await response.json();
      if (!Number.isSafeInteger(transaction?.fee) || transaction.fee < 0)
        throw new Error("Electrs transaction has an invalid fee");
      return transaction.fee;
    } catch (error) {
      failure = error;
      if (attempt + 1 < 4) {
        const wait = error?.status === 429 ? Math.min(error.retryAfter || 30, 60) * 1_000 : 1_000 * 2 ** attempt;
        await delay(wait);
      }
    }
  }
  throw failure;
}

async function resolvePage(rows) {
  const fees = [];
  const failures = [];
  let cursor = 0;
  let completed = 0;
  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        try {
          const fee = await fetchFee(row.tx_hash);
          if (fee !== null) fees.push({ tx_hash: row.tx_hash, fee });
        } catch (error) {
          failures.push({ tx_index: row.tx_index, error: error instanceof Error ? error.message : String(error) });
        }
        completed += 1;
        if (completed % 50 === 0 || completed === rows.length)
          console.log(
            JSON.stringify({
              event: "fee_page_progress",
              completed,
              requested: rows.length,
              verified: fees.length,
              failed: failures.length,
              duration_ms: Date.now() - startedAt,
            }),
          );
        if (REQUEST_DELAY_MS > 0) await delay(REQUEST_DELAY_MS);
      }
    }),
  );
  return { fees, failures };
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
    if (passUpdated === 0) throw new Error("fee backfill pass made no progress; inspect Electrs failures");
    after = null;
    passUpdated = 0;
    continue;
  }

  let updated = 0;
  let failed = 0;
  for (let window = 0; window < page.rows.length; window += 100) {
    const { fees, failures } = await resolvePage(page.rows.slice(window, window + 100));
    failed += failures.length;
    if (fees.length === 0) continue;
    const result = await api("/admin/bitcoin-fees", {
      method: "POST",
      body: JSON.stringify(fees),
    });
    updated += Number(result.updated ?? 0);
  }
  total += updated;
  passUpdated += updated;
  pages += 1;
  after = page.next;
  console.log(
    JSON.stringify({ event: "fee_page_complete", total, requested: page.rows.length, updated, failed, next_tx: after }),
  );
}

console.log(JSON.stringify({ complete, pages, updated: total }));
