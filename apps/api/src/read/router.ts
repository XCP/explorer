/**
 * Explorer read API — serves the D1 Counterparty mirror as clean JSON for apps/web (and as a Counterparty-style
 * read mirror for any consumer). Composes the per-domain routers; the domains carry non-overlapping
 * path prefixes, so mount order is not significant. Balances already store raw + normalized, so no
 * divisibility joins are needed at read time.
 */
import { router } from "./respond";
import { stats } from "./stats";
import { assets } from "./assets";
import { addresses } from "./addresses";
import { chain } from "./chain";
import { emblem } from "./emblem";
import { firsts } from "./firsts";
import { vaults } from "./vaults";
import { exchanges } from "./exchanges";
import { trades } from "./trades";
import { mempool } from "./mempool";
import { tags } from "./tags";
import { graph } from "./graph";
import { radar } from "./radar";
import { candidates } from "./candidates";

export const read = router();

// Edge cache (Cloudflare Cache API) for read GETs. SSR reads arrive via the API_WORKER service binding,
// which BYPASSES Cloudflare's CDN edge cache — so a fresh copy of a heavy read (e.g. the 9-query AssetDetail)
// has to be cached inside the worker itself. On a hit we serve from the colo cache with ZERO D1; on a miss we
// run the handler and store the response, honoring each endpoint's own Cache-Control (the max-age set by J()).
// Per-colo, and a no-op in local dev (Cache API is unavailable there — guarded). `x-cache` reports HIT/MISS.
read.use("*", async (c, next) => {
  const cache = caches.default;
  if (c.req.method !== "GET" || !cache) return next();
  const key = new Request(c.req.url);
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-cache", "HIT");
    return r;
  }
  await next();
  const res = c.res;
  const cc = res?.headers.get("cache-control") || "";
  if (res && res.status === 200 && cc.includes("max-age") && !cc.includes("max-age=0")) {
    try {
      c.executionCtx.waitUntil(cache.put(key, res.clone()));
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
