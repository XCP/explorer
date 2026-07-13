import { Hono } from "hono";
import type { Env } from "#api/env";
import { requireAdmin } from "#api/middleware/admin-auth";
import { recoveryAdmin } from "#api/recovery/admin";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "recovery-bootstrap" }));
app.use("/admin/*", requireAdmin);
app.route("/", recoveryAdmin);
app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((error, c) => {
  console.error("recovery bootstrap request failed", error);
  return c.json({ error: "internal server error" }, 500);
});

export default app;
