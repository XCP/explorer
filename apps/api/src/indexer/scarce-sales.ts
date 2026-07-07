/**
 * Scarce.city SALES history — the Bitcoin-native card marketplace, a venue our Ethereum/Alchemy Emblem
 * crawl is entirely blind to. Source: scarce.city's live public API (the old app's
 * ProcessScarceCityTradeHistoryJob used the same): GET /api/marketplace/digital/{asset}/sales →
 * [{ assetName, priceInBtc, timestamp (RFC-1123) }]. No listing endpoint exists, so we sweep our own
 * asset universe (resumable rowid cursor), query per asset, and keep the hits. Feeds the unified sales
 * stream as the 'scarce.city' venue (BTC-priced). Idempotent on (asset, sold_at).
 */
import type { Env } from "../index";

const SALES_URL = (asset: string) => `https://scarce.city/api/marketplace/digital/${encodeURIComponent(asset)}/sales`;
const ASSETS_PER_RUN = 90;   // bounded per cron tick (stays well under the Worker subrequest/CPU budget)
const CONCURRENCY = 5;

export const SCARCE_SALES_DDL = `CREATE TABLE IF NOT EXISTS scarce_city_sales (
  asset TEXT NOT NULL, sold_at INTEGER NOT NULL, price_btc REAL NOT NULL, PRIMARY KEY (asset, sold_at))`;
export const SCARCE_SALES_IDX = `CREATE INDEX IF NOT EXISTS idx_scarce_asset ON scarce_city_sales(asset)`;

interface ScarceSale { assetName?: string; priceInBtc?: string | number; timestamp?: string }

async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}

/** One asset's sales, or [] on any miss (404 / HTML / network). Bounded timeout so one slow asset
 *  can't stall the whole run. */
async function fetchSales(asset: string): Promise<ScarceSale[]> {
  try {
    const r = await fetch(SALES_URL(asset), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("json")) return []; // the SPA returns HTML for unknown assets
    const d = await r.json();
    return Array.isArray(d) ? (d as ScarceSale[]) : [];
  } catch { return []; }
}

/** One bounded, resumable step: sweep the next ASSETS_PER_RUN assets by rowid, query scarce.city for
 *  each, upsert any sales. Wraps the cursor at the end of the universe to re-sweep for new sales. */
export async function crawlScarceSales(env: Env): Promise<Record<string, unknown>> {
  await env.DB.prepare(SCARCE_SALES_DDL).run();
  await env.DB.prepare(SCARCE_SALES_IDX).run();

  const cursor = parseInt((await getState(env, "scarce_cursor")) || "0", 10);
  const rows = (await env.DB.prepare(
    `SELECT rowid, asset FROM assets WHERE rowid > ? ORDER BY rowid LIMIT ?`
  ).bind(cursor, ASSETS_PER_RUN).all<{ rowid: number; asset: string }>()).results || [];

  const out: { from: number; to: number; assets: number; sales_found: number; wrapped?: boolean; total?: number } =
    { from: cursor, to: cursor, assets: rows.length, sales_found: 0 };
  if (!rows.length) { // past the end — wrap to re-sweep for new sales next tick
    await setState(env, "scarce_cursor", "0");
    out.wrapped = true;
    out.total = (await env.DB.prepare(`SELECT COUNT(*) c FROM scarce_city_sales`).first<{ c: number }>())?.c ?? 0;
    return out;
  }

  // fetch in small concurrent waves; collect upserts
  const upserts: { asset: string; sold_at: number; price: number }[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const wave = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(wave.map((r) => fetchSales(r.asset).then((s) => ({ asset: r.asset, sales: s }))));
    for (const { asset, sales } of results) {
      for (const s of sales) {
        const t = s.timestamp ? Math.floor(Date.parse(s.timestamp) / 1000) : NaN;
        const p = Number(s.priceInBtc);
        if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;
        upserts.push({ asset, sold_at: t, price: p });
      }
    }
  }

  if (upserts.length) {
    const stmts = upserts.map((u) =>
      env.DB.prepare(`INSERT OR IGNORE INTO scarce_city_sales (asset,sold_at,price_btc) VALUES (?,?,?)`).bind(u.asset, u.sold_at, u.price));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    out.sales_found = upserts.length;
  }

  const last = rows[rows.length - 1].rowid;
  await setState(env, "scarce_cursor", String(last));
  out.to = last;
  out.total = (await env.DB.prepare(`SELECT COUNT(*) c FROM scarce_city_sales`).first<{ c: number }>())?.c ?? 0;
  return out;
}
