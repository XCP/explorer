/**
 * Stable app.xcp.io API surface consumed by the wallet extension:
 *   /api/v1/simple-search, /api/v1/search, /api/v1/asset/{asset}   -> canonical asset store
 *   /api/v1/address/{address}/utxos                                   -> cached read-through to Counterparty
 *   /api/v1/address/{address}/consolidation*                         -> proxy to Hetzner consolidation svc
 *   /api/v1/swap/{give}/{get}                                     -> proxy + reshape xcpdex market data
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "#api/env";

type Ctx = Context<{ Bindings: Env }>;

export const extensionApi = new Hono<{ Bindings: Env }>();
const json = (c: Ctx, body: unknown, ttl = 60) =>
  c.json(body, 200, { "cache-control": `public, max-age=${ttl}`, "access-control-allow-origin": "*" });
const num = (v: string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ---------- assets: search / simple-search / asset (from D1 mirror) ---------- */

extensionApi.get("/api/v1/simple-search", async (c) => {
  const q = (c.req.query("query") || "").trim();
  if (!q) return json(c, { assets: [] });
  const like = q.toUpperCase() + "%";
  const rows = await c.env.CORE_DB.prepare(
    `SELECT dictionary.asset,asset.supply_normalized FROM assets asset
     JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
     WHERE dictionary.asset LIKE ? OR asset.asset_longname LIKE ?
     ORDER BY length(dictionary.asset),dictionary.asset LIMIT 20`,
  )
    .bind(like, q + "%")
    .all<{ asset: string; supply_normalized: string | null }>();
  return json(c, { assets: rows.results.map((r) => ({ symbol: r.asset, supply: num(r.supply_normalized) })) });
});

extensionApi.get("/api/v1/search", async (c) => {
  const q = (c.req.query("query") || "").trim();
  if (!q) return json(c, { assets: [] });
  const like = q.toUpperCase() + "%";
  const rows = await c.env.CORE_DB.prepare(
    `SELECT dictionary.asset,asset.description,issuer.address issuer,owner.address owner,
       asset.supply_normalized,asset.locked,asset.first_issuance_block_time
     FROM assets asset JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
     LEFT JOIN address_dictionary issuer ON issuer.address_id=asset.issuer_id
     LEFT JOIN address_dictionary owner ON owner.address_id=asset.owner_id
     WHERE dictionary.asset LIKE ? OR asset.asset_longname LIKE ?
     ORDER BY length(dictionary.asset),dictionary.asset LIMIT 20`,
  )
    .bind(like, q + "%")
    .all<{
      asset: string;
      description: string | null;
      issuer: string | null;
      owner: string | null;
      supply_normalized: string | null;
      locked: number | null;
      first_issuance_block_time: number | null;
    }>();
  return json(c, {
    assets: rows.results.map((r) => ({
      asset: r.asset,
      symbol: r.asset,
      description: r.description ?? "",
      issuer: r.issuer,
      owner: r.owner,
      issued: num(r.supply_normalized),
      burned: 0,
      supply: num(r.supply_normalized),
      locked: r.locked ? 1 : 0,
      low_quality: 0,
      first_issued_at: r.first_issuance_block_time,
    })),
  });
});

extensionApi.get("/api/v1/asset/:asset", async (c) => {
  const asset = c.req.param("asset");
  const r = await c.env.CORE_DB.prepare(
    `SELECT dictionary.asset,asset.type,asset.description,asset.supply_normalized,asset.locked,
       asset.divisible,asset.first_issuance_block_time,asset.asset_longname,asset.mime_type,
       issuer.address issuer,owner.address owner
     FROM assets asset JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
     LEFT JOIN address_dictionary issuer ON issuer.address_id=asset.issuer_id
     LEFT JOIN address_dictionary owner ON owner.address_id=asset.owner_id
     WHERE dictionary.asset=? OR asset.asset_longname=?`,
  )
    .bind(asset.toUpperCase(), asset)
    .first<{
      asset: string;
      type: string | null;
      description: string | null;
      supply_normalized: string | null;
      locked: number | null;
      divisible: number | null;
      first_issuance_block_time: number | null;
      asset_longname: string | null;
      issuer: string | null;
      owner: string | null;
      mime_type: string | null;
    }>();
  if (!r) return c.json({ error: "Asset not found" }, 404);
  // Counterparty-derived fields only; market fields (price/volume) intentionally omitted (wallet falls back to CoinGecko).
  return json(
    c,
    {
      data: {
        asset: r.asset,
        symbol: r.asset,
        type: r.type,
        card_description: r.description ?? "",
        issued: num(r.supply_normalized),
        burned: 0,
        supply: num(r.supply_normalized),
        locked: r.locked ? 1 : 0,
        divisible: r.divisible ? 1 : 0,
        first_issued_at: r.first_issuance_block_time,
        asset_longname: r.asset_longname,
        issuer: r.issuer,
        owner: r.owner,
        description: r.description ?? "",
        mime_type: r.mime_type,
        eth_contract: null,
        eth_token_id: null,
      },
    },
    30,
  );
});

/* ---------- utxos + consolidation: proxy to the Hetzner consolidation service ---------- */

// utxos lives in the consolidation service (same PHP codebase as app.xcp.io); proxy for shape parity.
extensionApi.get("/api/v1/address/:address/utxos", (c) => proxyConsolidation(c));
extensionApi.all("/api/v1/address/:address/consolidation", (c) => proxyConsolidation(c));
extensionApi.all("/api/v1/address/:address/consolidation/:sub", (c) => proxyConsolidation(c));
async function proxyConsolidation(c: Ctx) {
  const url = new URL(c.req.url);
  const target = c.env.CONSOLIDATION_API + url.pathname + url.search;
  const res = await fetch(target, {
    method: c.req.method,
    headers: { accept: "application/json" },
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.clone().arrayBuffer(),
    signal: AbortSignal.timeout(45000),
  });
  return c.body(await res.text(), res.status as ContentfulStatusCode, {
    "content-type": res.headers.get("content-type") || "application/json",
    "access-control-allow-origin": "*",
  });
}

/* ---------- swap: proxy + reshape xcpdex pair data (market data lives in xcpdex) ---------- */

extensionApi.get("/api/v1/swap/:give/:get", async (c) => {
  const give = c.req.param("give"),
    get = c.req.param("get");
  // Wallet reads only data.trading_pair.{last_trade_price,name}. Map from xcpdex pair data.
  const res = await c.env.XCPDEX.fetch(
    `https://xcpdex-api/pair/${encodeURIComponent(give)}_${encodeURIComponent(get)}`,
  );
  if (!res.ok) {
    return json(c, { data: { trading_pair: { name: `${give}/${get}`, last_trade_price: null } } }, 30);
  }
  const p = (await res.json()) as {
    base_asset?: string;
    quote_asset?: string;
    last_price?: unknown;
    last_trade_time?: unknown;
    volume_7d?: unknown;
    volume_30d?: unknown;
    trade_count_7d?: unknown;
    trade_count_30d?: unknown;
    price_change_7d?: unknown;
    price_change_30d?: unknown;
    updated_at?: unknown;
  };
  const base = p.base_asset ?? give,
    quote = p.quote_asset ?? get;
  return json(
    c,
    {
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
    },
    30,
  );
});
