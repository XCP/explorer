import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Env } from "#api/env";
import { adminTokensEqual, readAdminToken, requireAdmin } from "#api/middleware/admin-auth";

function requestShape(authorization?: string) {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined),
  };
}

test("admin token extraction accepts only the authorization header", () => {
  assert.equal(readAdminToken(requestShape("Bearer secret")), "secret");
  assert.equal(readAdminToken(requestShape()), undefined);
});

test("admin token comparison accepts only the complete credential", async () => {
  assert.equal(await adminTokensEqual("secret", "secret"), true);
  assert.equal(await adminTokensEqual("secreu", "secret"), false);
  assert.equal(await adminTokensEqual("secret-extra", "secret"), false);
  assert.equal(await adminTokensEqual(undefined, "secret"), false);
});

test("admin middleware rejects missing and incorrect credentials before route work", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/admin/*", requireAdmin);
  app.get("/admin/test", (c) => c.json({ reached: true }));
  const env = { ADMIN_TOKEN: "secret" } as Env;

  const missing = await app.request("/admin/test", undefined, env);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("WWW-Authenticate"), 'Bearer realm="xcp-api-admin"');
  assert.equal((await app.request("/admin/test", { headers: { Authorization: "Bearer wrong" } }, env)).status, 401);
});

test("admin middleware accepts bearer credentials and rejects query credentials", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/admin/*", requireAdmin);
  app.get("/admin/test", (c) => c.json({ reached: true }));
  const env = { ADMIN_TOKEN: "secret" } as Env;

  assert.equal((await app.request("/admin/test", { headers: { Authorization: "Bearer secret" } }, env)).status, 200);
  assert.equal((await app.request("/admin/test?token=secret", undefined, env)).status, 401);
});
