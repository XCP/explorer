import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

type AdminRequest = {
  header(name: string): string | undefined;
  query(name: string): string | undefined;
};

/** Prefer credentials in a header so URLs, browser history, and access logs do not retain them. */
export function readAdminToken(req: AdminRequest): string | undefined {
  const authorization = req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();

  // Kept temporarily for existing operational scripts. New callers must use the Bearer header.
  return req.query("token");
}

export const requireAdmin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (readAdminToken(c.req) !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});
