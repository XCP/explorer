import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Env } from "../src/env";
import { readAdminToken, requireAdmin } from "../src/middleware/admin-auth";

function requestShape(authorization?: string, token?: string) {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined),
    query: (name: string) => (name === "token" ? token : undefined),
  };
}

test("admin token extraction prefers the authorization header", () => {
  assert.equal(readAdminToken(requestShape("Bearer preferred", "legacy")), "preferred");
  assert.equal(readAdminToken(requestShape(undefined, "legacy")), "legacy");
});

test("admin middleware rejects missing and incorrect credentials before route work", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/admin/*", requireAdmin);
  app.get("/admin/test", (c) => c.json({ reached: true }));
  const env = { ADMIN_TOKEN: "secret" } as Env;

  assert.equal((await app.request("/admin/test", undefined, env)).status, 403);
  assert.equal((await app.request("/admin/test", { headers: { Authorization: "Bearer wrong" } }, env)).status, 403);
});

test("admin middleware accepts bearer credentials and preserves the temporary query fallback", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/admin/*", requireAdmin);
  app.get("/admin/test", (c) => c.json({ reached: true }));
  const env = { ADMIN_TOKEN: "secret" } as Env;

  assert.equal((await app.request("/admin/test", { headers: { Authorization: "Bearer secret" } }, env)).status, 200);
  assert.equal((await app.request("/admin/test?token=secret", undefined, env)).status, 200);
});
