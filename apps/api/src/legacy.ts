/**
 * Legacy app.xcp.io/api/v1 surface the wallet extension depends on, so the old app.xcp.io droplet can
 * be retired (old installs reach app.xcp.io -> proxied here):
 *   /api/v1/simple-search, /api/v1/search, /api/v1/asset/{asset}   -> from our D1 assets mirror
 *   /api/v1/address/{addr}/utxos                                   -> cached read-through to CP
 *   /api/v1/address/{addr}/consolidation*                         -> proxy to Hetzner consolidation svc
 *   /api/v1/swap/{give}/{get}                                     -> proxy + reshape xcpdex market data
 */
import { Hono } from "hono";
import type { Env } from "./index";

export const legacy = new Hono<{ Bindings: Env }>();
const json = (c: any, body: unknown, ttl = 60) =>
  c.json(body, 200, { "cache-control": `public, max-age=${ttl}`, "access-control-allow-origin": "*" });
const num = (v: string | null): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ---------- assets: search / simple-search / asset (from D1 mirror) ---------- */

legacy.get("/api/v1/simple-search", async (c) => {
  const q = (c.req.query("query") || "").trim();
  if (!q) return json(c, { assets: [] });
  const like = q.toUpperCase() + "%";
  const rows = await c.env.DB.prepare(
    `SELECT asset, supply_normalized FROM assets
     WHERE asset LIKE ? OR asset_longname LIKE ?
     ORDER BY LENGTH(asset), asset LIMIT 20`
  ).bind(like, q + "%").all<{ asset: string; supply_normalized: string | null }>();
  return json(c, { assets: rows.results.map((r) => ({ symbol: r.asset, supply: num(r.supply_normalized) })) });
});

legacy.get("/api/v1/search", async (c) => {
  const q = (c.req.query("query") || "").trim();
  if (!q) return json(c, { assets: [] });
  const like = q.toUpperCase() + "%";
  const rows = await c.env.DB.prepare(
    `SELECT asset, description, issuer, owner, supply_normalized, locked, first_issuance_block_time
     FROM assets WHERE asset LIKE ? OR asset_longname LIKE ?
     ORDER BY LENGTH(asset), asset LIMIT 20`
  ).bind(like, q + "%").all<any>();
  return json(c, {
    assets: rows.results.map((r) => ({
      asset: r.asset, symbol: r.asset, description: r.description ?? "",
      issuer: r.issuer, owner: r.owner, issued: num(r.supply_normalized), burned: 0,
      supply: num(r.supply_normalized), locked: r.locked ? 1 : 0, low_quality: 0,
      first_issued_at: r.first_issuance_block_time,
    })),
  });
});

legacy.get("/api/v1/asset/:asset", async (c) => {
  const asset = c.req.param("asset");
  const r = await c.env.DB.prepare(
    `SELECT * FROM assets WHERE asset = ? OR asset_longname = ?`
  ).bind(asset.toUpperCase(), asset).first<any>();
  if (!r) return c.json({ error: "Asset not found" }, 404);
  // CP-derived fields only; market fields (price/volume) intentionally omitted (wallet falls back to CoinGecko).
  return json(c, {
    data: {
      asset: r.asset, symbol: r.asset, type: r.type, card_description: r.description ?? "",
      issued: num(r.supply_normalized), burned: 0, supply: num(r.supply_normalized),
      locked: r.locked ? 1 : 0, divisible: r.divisible ? 1 : 0,
      first_issued_at: r.first_issuance_block_time, asset_longname: r.asset_longname,
      issuer: r.issuer, owner: r.owner, description: r.description ?? "", mime_type: r.mime_type,
      eth_contract: null, eth_token_id: null,
    },
  }, 30);
});

/* ---------- utxos + consolidation: proxy to the Hetzner consolidation service ---------- */

// utxos lives in the consolidation service (same PHP codebase as app.xcp.io); proxy for shape parity.
legacy.get("/api/v1/address/:address/utxos", (c) => proxyConsolidation(c));
legacy.all("/api/v1/address/:address/consolidation", (c) => proxyConsolidation(c));
legacy.all("/api/v1/address/:address/consolidation/:sub", (c) => proxyConsolidation(c));
async function proxyConsolidation(c: any) {
  const url = new URL(c.req.url);
  const target = c.env.CONSOLIDATION_API + url.pathname + url.search;
  const res = await fetch(target, {
    method: c.req.method,
    headers: { accept: "application/json" },
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.clone().arrayBuffer(),
    signal: AbortSignal.timeout(45000),
  });
  return c.body(await res.text(), res.status, { "content-type": res.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" });
}

/* ---------- swap: proxy + reshape xcpdex pair data (market data lives in xcpdex) ---------- */

legacy.get("/api/v1/swap/:give/:get", async (c) => {
  const give = c.req.param("give"), get = c.req.param("get");
  // Wallet reads only data.trading_pair.{last_trade_price,name}. Map from xcpdex pair data.
  const res = await c.env.XCPDEX.fetch(
    `https://xcpdex-api/pair/${encodeURIComponent(give)}_${encodeURIComponent(get)}`
  );
  if (!res.ok) {
    return json(c, { data: { trading_pair: { name: `${give}/${get}`, last_trade_price: null } } }, 30);
  }
  const p: any = await res.json();
  const base = p.base_asset ?? give, quote = p.quote_asset ?? get;
  return json(c, {
    data: {
      base_asset: { asset: base, symbol: base },
      quote_asset: { asset: quote, symbol: quote },
      trading_pair: {
        name: `${base}/${quote}`,
        slug: `${base}_${quote}`,
        last_trade_price: p.last_price != null ? String(p.last_price) : null,
        last_trade_date: p.last_trade_time ?? null,
        volume_7d: p.volume_7d ?? null,
        volume_30d: p.volume_30d ?? null,
        trades_7d: p.trade_count_7d ?? null,
        trades_30d: p.trade_count_30d ?? null,
        price_change_7d: p.price_change_7d ?? null,
        price_change_30d: p.price_change_30d ?? null,
        updated_at: p.updated_at ?? null,
      },
    },
  }, 30);
});
