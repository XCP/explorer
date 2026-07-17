#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { BITCOIN_FEE_PROVIDERS, fetchProviderFee } from "./lib/bitcoin-fee-providers.mjs";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const API = arg("api", "https://xcp-api.me-bbe.workers.dev").replace(/\/$/, "");
const requestedProviderNames = new Set(
  arg("providers", BITCOIN_FEE_PROVIDERS.map((provider) => provider.name).join(","))
    .split(",")
    .filter(Boolean),
);
const requestedProviders = BITCOIN_FEE_PROVIDERS.filter((provider) => requestedProviderNames.has(provider.name));
if (requestedProviders.length !== requestedProviderNames.size) throw new Error("unknown Bitcoin fee provider");
if (!requestedProviderNames.has("counterparty")) throw new Error("counterparty must remain the canary provider");
// Resolve local credentials relative to this script so unattended runners do not depend on their working directory.
const devToken = process.env.ADMIN_TOKEN
  ? undefined
  : readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((line) => line.startsWith("ADMIN_TOKEN="))
      ?.slice("ADMIN_TOKEN=".length)
      .replace(/^"|"$/g, "");
const TOKEN = process.env.ADMIN_TOKEN ?? devToken ?? readFileSync(arg("token-file", "admin.tok"), "utf8").trim();
const PAGE_SIZE = Number(arg("page-size", "500"));
const MAX_PAGES = Number(arg("max-pages", "0"));

if (!Number.isSafeInteger(PAGE_SIZE) || PAGE_SIZE < 1 || PAGE_SIZE > 5_000) throw new Error("invalid page-size");
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

async function fetchFee(provider, txHash) {
  return fetchProviderFee(provider, txHash);
}

async function resolvePage(rows, providers, availableAt) {
  const fees = [];
  const failures = [];
  const providerStats = Object.fromEntries(providers.map((provider) => [provider.name, { verified: 0, failed: 0 }]));
  let cursor = 0;
  let completed = 0;
  const startedAt = Date.now();
  await Promise.all(
    providers.map(async (provider) => {
      for (;;) {
        let wait = Math.max(0, (availableAt.get(provider.name) ?? 0) - Date.now());
        while (wait > 0 && cursor < rows.length) {
          await delay(Math.min(250, wait));
          wait = Math.max(0, (availableAt.get(provider.name) ?? 0) - Date.now());
        }
        if (cursor >= rows.length) break;
        const row = rows[cursor++];
        try {
          const fee = await fetchFee(provider, row.tx_hash);
          if (fee !== null) {
            fees.push({ tx_hash: row.tx_hash, fee });
            providerStats[provider.name].verified += 1;
          }
        } catch (error) {
          providerStats[provider.name].failed += 1;
          failures.push({
            tx_index: row.tx_index,
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        availableAt.set(provider.name, Date.now() + provider.minIntervalMs);
        completed += 1;
        if (completed % 50 === 0 || completed === rows.length)
          console.log(
            JSON.stringify({
              event: "fee_page_progress",
              completed,
              requested: rows.length,
              verified: fees.length,
              failed: failures.length,
              providers: providerStats,
              duration_ms: Date.now() - startedAt,
            }),
          );
      }
    }),
  );
  return { fees, failures, providerStats };
}

let total = 0;
let pages = 0;
let after = null;
let passUpdated = 0;
let complete = false;
const providerAvailableAt = new Map();
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
    const { fees, failures } = await resolvePage(
      page.rows.slice(window, window + 100),
      requestedProviders,
      providerAvailableAt,
    );
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
