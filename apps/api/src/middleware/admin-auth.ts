import { createMiddleware } from "hono/factory";
import type { Env } from "#api/env";

type AdminRequest = {
  header(name: string): string | undefined;
};

/** Prefer credentials in a header so URLs, browser history, and access logs do not retain them. */
export function readAdminToken(req: AdminRequest): string | undefined {
  const authorization = req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return undefined;
}

export const requireAdmin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (readAdminToken(c.req) !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});
