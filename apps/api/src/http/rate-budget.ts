import type { Context, Next } from "hono";
import type { Env } from "#api/env";
import { routeFamily } from "#api/http/telemetry";

function tooManyRequests(c: Context<{ Bindings: Env }>, seconds: number): Response {
  return c.json({ error: "Too many asset list requests" }, 429, {
    "Retry-After": String(seconds),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Retry-After",
  });
}

/** Called only on a list cache miss, before the first D1 query. Keys are independent of caller identity. */
export async function limitAssetListMiss(
  c: Context<{ Bindings: Env }>,
  filter: { offset: number; sort?: string; query?: string },
): Promise<Response | undefined> {
  const prefixLength = filter.query?.trim().length ?? 0;
  const pool = filter.offset >= 1000 || filter.sort === "supply" || prefixLength === 1 ? "bulk" : "browse";
  if (!(await c.env.ASSET_LIST_MISS_LIMIT.limit({ key: pool })).success) return tooManyRequests(c, 60);
  const seconds = await c.env.ASSET_LIST_BUDGET.getByName(pool).take(pool);
  if (seconds > 0) return tooManyRequests(c, seconds);
}

/**
 * Observe-only public API budget. Service bindings do not supply a public
 * CF-Connecting-IP, so internal SSR reads never share an anonymous-client
 * counter or influence a future public limit.
 */
export async function observePublicReadBudget(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const client = c.req.header("CF-Connecting-IP")?.trim();
  if (client && c.req.path === "/v2/assets" && (c.req.method === "GET" || c.req.method === "HEAD")) {
    if (!(await c.env.ASSET_LIST_CLIENT_LIMIT.limit({ key: client })).success) return tooManyRequests(c, 60);
    return next();
  }
  const limiter = c.env.PUBLIC_API_RATE_LIMITER;
  if (c.req.method === "GET" && client && limiter) {
    const family = routeFamily(c.req.path);
    const { success } = await limiter.limit({ key: `${client}:${family}` });
    if (!success) {
      console.warn({
        event: "rate_budget_exceeded",
        mode: "observe",
        route_family: family,
      });
    }
  }
  await next();
}
