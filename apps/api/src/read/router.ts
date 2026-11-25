/**
 * Explorer read API — serves the D1 Counterparty mirror as clean JSON for apps/web (and as a Counterparty-style
 * read mirror for any consumer). Composes the per-domain routers; the domains carry non-overlapping
 * path prefixes, so mount order is not significant. Balances already store raw + normalized, so no
 * divisibility joins are needed at read time.
 */
import { router } from "#api/read/respond";
import { stats } from "#api/read/stats";
import { assets } from "#api/read/assets";
import { addresses } from "#api/read/addresses";
import { chain } from "#api/read/chain";
import { emblem } from "#api/read/emblem";
import { firsts } from "#api/read/firsts";
import { vaults } from "#api/read/vaults";
import { exchanges } from "#api/read/exchanges";
import { trades } from "#api/read/trades";
import { mempool } from "#api/read/mempool";
import { tags } from "#api/read/tags";
import { graph, graphLimit } from "#api/read/graph";
import { radar } from "#api/read/radar";
import { candidates } from "#api/read/candidates";
import { markets } from "#api/read/markets";
import { years } from "#api/read/years";
import { utxos } from "#api/read/utxos";
import { prices } from "#api/read/prices";

export const read = router();

// The Cache API is keyed before route handlers run, so D1 cache-key changes alone cannot invalidate an
// already-cached response. Bump this contract version when a read response's historical meaning changes.
const READ_EDGE_CACHE_VERSION = "23"; // Payment-capped dispense allocations, including historical records.

// Edge cache (Cloudflare Cache API) for read GETs. SSR reads arrive via the API_WORKER service binding,
// which BYPASSES Cloudflare's CDN edge cache — so a fresh copy of a heavy read (e.g. the 9-query AssetDetail)
// has to be cached inside the worker itself. On a hit we serve from the colo cache with ZERO D1; on a miss we
// run the handler and store the response, honoring each endpoint's own Cache-Control (the max-age set by J()).
// Per-colo, and a no-op in local dev (Cache API is unavailable there — guarded). `x-cache` reports HIT/MISS.
read.use("*", async (c, next) => {
  const cache = caches.default;
  if (c.req.method !== "GET" || !cache) return next();
  const keyUrl = new URL(c.req.url);
  const graphKind = /^\/v2\/graph\/(asset|address)\/[^/]+$/.exec(keyUrl.pathname)?.[1];
  const reportTtl: Record<string, number> = {
    "/v2/addresses/census": 604800,
    "/v2/price": 300,
    "/v2/price/ticker": 120,
    "/v2/price/ohlc": 3600,
  };
  const report = reportTtl[keyUrl.pathname];
  if (graphKind || report) {
    const limit = keyUrl.searchParams.get("limit");
    keyUrl.search = "";
    if (graphKind) keyUrl.searchParams.set("limit", String(graphLimit(graphKind, limit ?? undefined)));
  }
  keyUrl.searchParams.set("__read_contract", READ_EDGE_CACHE_VERSION);
  const key = new Request(keyUrl);
  const isAssetDetail = /^\/v2\/assets\/[^/]+$/.test(keyUrl.pathname);
  const fallbackTtl = isAssetDetail ? 604800 : graphKind ? 86400 : report;
  const fallbackUrl = new URL(isAssetDetail ? keyUrl.origin + keyUrl.pathname : keyUrl);
  fallbackUrl.searchParams.set(isAssetDetail ? "__asset_last_good" : "__last_good", READ_EDGE_CACHE_VERSION);
  const fallbackKey = new Request(fallbackUrl);
  const lastGood = async () => {
    if (!fallbackTtl) return undefined;
    const stale = await cache.match(fallbackKey).catch(() => undefined);
    if (!stale) return undefined;
    const response = new Response(stale.body, stale);
    response.headers.set("cache-control", "no-store");
    response.headers.set("warning", '110 - "stale response served after origin failure"');
    response.headers.set("x-cache", "STALE-IF-ERROR");
    return response;
  };
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-cache", "HIT");
    return r;
  }
  try {
    await next();
  } catch (error) {
    const stale = await lastGood();
    if (stale) {
      c.res = stale;
      return;
    }
    throw error;
  }
  const res = c.res;
  if (res && res.status >= 500) {
    const stale = await lastGood();
    if (stale) {
      c.res = stale;
      return;
    }
  }
  const cc = res?.headers.get("cache-control") || "";
  if (res && res.status === 200 && cc.includes("max-age") && !cc.includes("max-age=0")) {
    try {
      c.executionCtx.waitUntil(cache.put(key, res.clone()));
      if (fallbackTtl) {
        const durable = res.clone();
        durable.headers.set("cache-control", `public, max-age=${fallbackTtl}`);
        c.executionCtx.waitUntil(cache.put(fallbackKey, durable));
      }
    } catch {
      /* no executionCtx (dev) */
    }
    // Hono uses c.res (not a middleware's post-next() return value), so replace it to stamp the header.
    const out = new Response(res.body, res);
    out.headers.set("x-cache", "MISS");
    c.res = out;
  }
});

read.route("/", stats);
read.route("/", assets);
read.route("/", addresses);
read.route("/", chain);
read.route("/", emblem);
read.route("/", firsts);
read.route("/", vaults);
read.route("/", exchanges);
read.route("/", trades);
read.route("/", mempool);
read.route("/", tags);
read.route("/", graph);
read.route("/", radar);
read.route("/", candidates);
read.route("/", markets);
read.route("/", years);
read.route("/", utxos);
read.route("/", prices);
