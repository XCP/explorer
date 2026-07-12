/**
 * Response plumbing shared by the read API route modules: the router factory, the JSON envelope helper,
 * the D1-backed response cache, pagination parsing, and JS rounding. No SQL lives here — query functions
 * own their SQL in src/queries/<domain>.ts. Single source of truth so the per-domain routers stay thin.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "#api/env";
import { boundedInteger } from "#api/http/numbers";

export type ReadApp = Hono<{ Bindings: Env }>;
export type Ctx = Context<{ Bindings: Env }>;
export const router = (): ReadApp => new Hono<{ Bindings: Env }>();

/* ---------- response + pagination ---------- */
// Envelope: { result, result_count?, next_offset? }. Cached at the edge via cache-control.
export const J = (c: Ctx, body: unknown, ttl = 30) =>
  c.json(body, 200, {
    "cache-control": `public, max-age=${ttl}, stale-while-revalidate=${ttl}`,
    "access-control-allow-origin": "*",
  });

/**
 * D1-backed response cache (the `cache` table: key, body, ctype, expires_at) with stale-while-revalidate.
 * Layer 2 above the per-colo edge cache: it PERSISTS across colos and cold edge, so a heavy aggregation
 * (e.g. the home COUNT(*) over millions of rows, or the leaderboards fan-out) runs at most once per `ttl`
 * GLOBALLY instead of once per colo per edge-TTL. On a stale-but-usable hit we serve the cached body
 * immediately and recompute in the background via waitUntil, so a user never blocks on the slow query.
 * Use ONLY for low-cardinality, global (non per-entity) endpoints so the key space stays tiny.
 */
export async function cached(
  c: Ctx,
  key: string,
  opts: { ttl: number; edge?: number; swr?: number },
  producer: () => Promise<unknown>,
): Promise<Response> {
  const { ttl, edge = Math.min(ttl, 30), swr = ttl } = opts;
  const now = Math.floor(Date.now() / 1000);
  const send = (body: string, ctype = "application/json") =>
    c.body(body, 200, {
      "content-type": ctype,
      "cache-control": `public, max-age=${edge}`,
      "access-control-allow-origin": "*",
    });
  const write = async (): Promise<string> => {
    const body = JSON.stringify(await producer());
    await c.env.DB.prepare(
      `INSERT INTO cache (key,body,ctype,expires_at) VALUES (?,?,'application/json',?)
       ON CONFLICT(key) DO UPDATE SET body=excluded.body, ctype=excluded.ctype, expires_at=excluded.expires_at`,
    )
      .bind(key, body, Math.floor(Date.now() / 1000) + ttl)
      .run()
      .catch(() => {});
    return body;
  };
  const hit = await c.env.DB.prepare(`SELECT body, ctype, expires_at FROM cache WHERE key=?`)
    .bind(key)
    .first<{ body: string; ctype: string; expires_at: number }>()
    .catch(() => null);
  if (hit?.body) {
    if (now < hit.expires_at) {
      const response = send(hit.body, hit.ctype);
      response.headers.set("x-d1-cache", "HIT");
      return response;
    }
    if (now < hit.expires_at + swr) {
      // stale: serve now, refresh in bg
      const ctx = (() => {
        try {
          return c.executionCtx;
        } catch {
          return null;
        }
      })();
      if (ctx) {
        ctx.waitUntil(write().catch(() => {}));
        const response = send(hit.body, hit.ctype);
        response.headers.set("x-d1-cache", "STALE");
        return response;
      }
    }
  }
  const started = Date.now();
  const response = send(await write()); // miss / too stale: compute now
  response.headers.set("x-d1-cache", "MISS");
  response.headers.set("server-timing", `producer;dur=${Date.now() - started}`);
  return response;
}
export const lim = (c: Ctx, def = 50, max = 100) =>
  boundedInteger(c.req.query("limit"), { defaultValue: def, min: 1, max });
export const off = (c: Ctx) => boundedInteger(c.req.query("offset"), { defaultValue: 0, min: 0 });

/* ---------- formatting ---------- */
// single JS rounding strategy (replaces the per-endpoint num()/Math.round mix).
export const round = (v: unknown, dp = 1) => {
  const p = 10 ** dp;
  return Math.round((Number(v) || 0) * p) / p;
};

// Reputation/quality scoring moved to src/reputation/ — config.ts (the tuning surface) + score.ts (engine).
