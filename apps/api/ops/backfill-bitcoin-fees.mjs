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

const FAILURE_THRESHOLD = 2;
const FAILURE_COOLDOWN_MS = 60_000;
const WINDOW_BUDGET_MS = 10_000;

async function resolvePage(rows, providers, providerState) {
  const fees = [];
  const failures = [];
  const providerStats = Object.fromEntries(providers.map((provider) => [provider.name, { verified: 0, failed: 0 }]));
  let cursor = 0;
  let completed = 0;
  const startedAt = Date.now();
  await Promise.all(
    providers.map(async (provider) => {
      const state = providerState.get(provider.name) ?? { availableAt: 0, consecutiveFailures: 0, cooldownUntil: 0 };
      providerState.set(provider.name, state);
      for (;;) {
        if (Date.now() - startedAt >= WINDOW_BUDGET_MS) break;
        if (state.cooldownUntil > Date.now()) break;
        let wait = Math.max(0, state.availableAt - Date.now());
        while (wait > 0 && cursor < rows.length && Date.now() - startedAt < WINDOW_BUDGET_MS) {
          await delay(Math.min(250, wait));
          wait = Math.max(0, state.availableAt - Date.now());
        }
        if (Date.now() - startedAt >= WINDOW_BUDGET_MS) break;
        if (cursor >= rows.length) break;
        const row = rows[cursor++];
        try {
          const fee = await fetchFee(provider, row.tx_hash);
          if (fee !== null) {
            fees.push({ tx_hash: row.tx_hash, fee });
            providerStats[provider.name].verified += 1;
          }
          state.consecutiveFailures = 0;
        } catch (error) {
          providerStats[provider.name].failed += 1;
          state.consecutiveFailures += 1;
          if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
            const retryAfterMs = Number.isSafeInteger(error?.retryAfter) ? error.retryAfter * 1_000 : 0;
            state.cooldownUntil = Date.now() + Math.max(FAILURE_COOLDOWN_MS, retryAfterMs);
          }
          failures.push({
            tx_index: row.tx_index,
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        state.availableAt = Date.now() + provider.minIntervalMs;
        completed += 1;
        if (completed % 50 === 0 || completed === rows.length)
          console.log(
            JSON.stringify({
              event: "fee_page_progress",
              completed,
              requested: rows.length,
              verified: fees.length,
              failed: failures.length,
              deferred: rows.length - completed,
              providers: providerStats,
              duration_ms: Date.now() - startedAt,
            }),
          );
      }
    }),
  );
  return { fees, failures, deferred: rows.length - completed, providerStats };
}

let total = 0;
let pages = 0;
let after = null;
let passUpdated = 0;
let complete = false;
const providerState = new Map();
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
  let deferred = 0;
  for (let window = 0; window < page.rows.length; window += 100) {
    const result = await resolvePage(page.rows.slice(window, window + 100), requestedProviders, providerState);
    const { fees, failures } = result;
    failed += failures.length;
    deferred += result.deferred;
    if (fees.length === 0) continue;
    const writeResult = await api("/admin/bitcoin-fees", {
      method: "POST",
      body: JSON.stringify(fees),
    });
    updated += Number(writeResult.updated ?? 0);
  }
  total += updated;
  passUpdated += updated;
  pages += 1;
  after = page.next;
  console.log(
    JSON.stringify({
      event: "fee_page_complete",
      total,
      requested: page.rows.length,
      updated,
      failed,
      deferred,
      next_tx: after,
    }),
  );
}

console.log(JSON.stringify({ complete, pages, updated: total }));
