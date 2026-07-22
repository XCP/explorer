import type { Context, Next } from "hono";
import type { Env } from "#api/env";
import { routeFamily } from "#api/http/telemetry";

/**
 * Observe-only public API budget. Service bindings do not supply a public
 * CF-Connecting-IP, so internal SSR reads never share an anonymous-client
 * counter or influence a future public limit.
 */
export async function observePublicReadBudget(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  const client = c.req.header("CF-Connecting-IP")?.trim();
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
