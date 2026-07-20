#!/usr/bin/env node

/** Fetch authorized CMC historical listings and retain reviewed Counterparty identities in resumable NDJSON. */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGETS = new Map([
  [1, { asset: "BTC", name: "Bitcoin", symbol: "BTC" }],
  [132, { asset: "XCP", name: "Counterparty", symbol: "XCP" }],
  [606, { asset: "FLDC", name: "FoldingCoin", symbol: "FLDC" }],
  [549, { asset: "SJCX", name: "Storjcoin X", symbol: "SJCX" }],
  [1063, { asset: "BITCRYSTALS", name: "BitCrystals", symbol: "BCY" }],
  [550, { asset: "LTBCOIN", name: "LTBcoin", symbol: "LTBC" }],
  [779, { asset: "GEMZ", name: "GetGems", symbol: "GEMZ" }],
  [1405, { asset: "PEPECASH", name: "Pepe Cash", symbol: "PEPECASH" }],
  [1603, { asset: "DATABITS", name: "Databits", symbol: "DTB" }],
  [1423, { asset: "TRIGGERS", name: "Triggers", symbol: "TRIG" }],
  [346, { asset: "SCOTCOIN", name: "Scotcoin", symbol: "SCOT" }],
  [1219, { asset: "ZAIF", name: "ZAIF", symbol: "ZAIF" }],
  [607, { asset: "SWARM", name: "Swarm", symbol: "SWARM" }],
  [694, { asset: "TILECOINX", name: "TileCoin", symbol: "XTC" }],
  // UCID 788 continued into the migrated ERC-20 asset. The bounded window below is the independently
  // corroborated Counterparty COVALC era; never extend it from ticker or UCID continuity alone.
  [
    788,
    {
      asset: "COVALC",
      name: "Circuits of Value",
      symbol: "COVAL",
      firstDay: "2016-08-07",
      lastDay: "2019-05-30",
    },
  ],
]);

const key = process.env.CMC_API_KEY;
if (!key) throw new Error("CMC_API_KEY is required");
const start = process.env.CMC_START;
const end = process.env.CMC_END;
if (!/^\d{4}-\d{2}-\d{2}$/.test(start ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) {
  throw new Error("CMC_START and CMC_END must be YYYY-MM-DD");
}
const output = resolve(process.env.CMC_SNAPSHOT_OUTPUT || "../../docs/data/cmc-counterparty-snapshots.ndjson");
const delayMs = Number(process.env.CMC_DELAY_MS ?? 300);
if (!Number.isInteger(delayMs) || delayMs < 200) throw new Error("CMC_DELAY_MS must be an integer of at least 200");

const completed = new Set();
if (existsSync(output)) {
  for (const line of readFileSync(output, "utf8").split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day)) throw new Error("Existing snapshot output is malformed");
    completed.add(row.day);
  }
}
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const iso = (time) => new Date(time).toISOString().slice(0, 10);

async function fetchDay(day) {
  const url = new URL("https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/historical");
  url.search = new URLSearchParams({ date: day, start: "1", limit: "5000", convert: "USD" }).toString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: "application/json", "X-CMC_PRO_API_KEY": key },
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    const payload = JSON.parse(raw);
    if (response.ok) return { url: String(url), raw, payload, available: true };
    if (response.status === 400 && payload?.status?.error_message?.includes("Search query is out of range")) {
      return { url: String(url), raw, payload, available: false };
    }
    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`CMC snapshot ${day} failed: ${response.status} ${raw.slice(0, 300)}`);
    }
    await sleep(2 ** attempt * 1_000);
  }
  throw new Error(`CMC snapshot ${day} exhausted retries`);
}

let fetched = 0;
let observations = 0;
let credits = 0;
const concurrency = Number(process.env.CMC_CONCURRENCY ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error("CMC_CONCURRENCY must be an integer from 1 through 8");
}
const pendingDays = [];
for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86_400_000) {
  const day = iso(time);
  if (!completed.has(day)) pendingDays.push(day);
}

async function processDay(day) {
  const { url, raw, payload, available } = await fetchDay(day);
  if (available && (payload?.status?.error_code !== 0 || !Array.isArray(payload.data))) {
    throw new Error(`CMC snapshot ${day} response shape changed`);
  }
  const targets = (available ? payload.data : []).flatMap((item) => {
    const expected = TARGETS.get(item.id);
    if (!expected) return [];
    if ((expected.firstDay && day < expected.firstDay) || (expected.lastDay && day > expected.lastDay)) return [];
    if (item.name !== expected.name || item.symbol !== expected.symbol) {
      throw new Error(`CMC identity changed for UCID ${item.id} on ${day}`);
    }
    const quote = item.quote?.USD;
    const price = Number(quote?.price);
    const volume = quote?.volume_24h;
    const marketCap = quote?.market_cap;
    if (
      !(price > 0) ||
      (volume != null && !(Number(volume) >= 0)) ||
      (marketCap != null && !(Number(marketCap) >= 0))
    ) {
      throw new Error(`CMC quote is invalid for UCID ${item.id} on ${day}`);
    }
    return [
      {
        asset: expected.asset,
        cmc_id: item.id,
        name: item.name,
        symbol: item.symbol,
        rank: item.cmc_rank ?? item.rank ?? null,
        price_usd: price,
        volume_24h_usd: volume == null ? null : Number(volume),
        market_cap_usd: marketCap == null ? null : Number(marketCap),
        circulating_supply: item.circulating_supply ?? null,
        // The listings endpoint currently stamps item.last_updated with fetch time even for old snapshots.
        quote_timestamp: quote?.last_updated ?? null,
      },
    ];
  });
  return {
    line: JSON.stringify({
      schema: "cmc-counterparty-historical-listing/1",
      day,
      source_url: url,
      response_sha256: createHash("sha256").update(raw).digest("hex"),
      fetched_at: new Date().toISOString(),
      available,
      unavailable_reason: available ? null : "cmc_historical_listing_out_of_range",
      listing_rows: available ? payload.data.length : 0,
      credit_count: Number(payload.status.credit_count ?? 0),
      targets,
    }),
    targets: targets.length,
    credits: Number(payload.status.credit_count ?? 0),
  };
}

for (let offset = 0; offset < pendingDays.length; offset += concurrency) {
  const batchDays = pendingDays.slice(offset, offset + concurrency);
  const batch = await Promise.all(batchDays.map(processDay));
  appendFileSync(output, `${batch.map((row) => row.line).join("\n")}\n`, "utf8");
  fetched += batch.length;
  observations += batch.reduce((sum, row) => sum + row.targets, 0);
  credits += batch.reduce((sum, row) => sum + row.credits, 0);
  if (fetched % 100 < concurrency) {
    process.stdout.write(`${JSON.stringify({ fetched, observations, credits, day: batchDays.at(-1) })}\n`);
  }
  await sleep(delayMs);
}
process.stdout.write(`${JSON.stringify({ output, fetched, observations, credits, completed_days: completed.size })}\n`);
