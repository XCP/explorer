import { Hono } from "hono";
import type { Env } from "#api/env";
import { importRecoveryTransactions, type RecoveryImportTransaction } from "#api/recovery/import";

export const recoveryAdmin = new Hono<{ Bindings: Env }>();

recoveryAdmin.post("/admin/recovery/import", async (c) => {
  const rows = await c.req.json<RecoveryImportTransaction[]>().catch(() => null);
  if (!Array.isArray(rows)) return c.json({ error: "expected a JSON array" }, 400);
  try {
    const upserted = await importRecoveryTransactions(c.env, rows);
    return c.json({ ok: true, upserted });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid recovery import" }, 400);
  }
});
