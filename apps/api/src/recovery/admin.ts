import { Hono } from "hono";
import type { Env } from "#api/env";
import { importRecoveryTransactions, type RecoveryImportTransaction } from "#api/recovery/import";

export const recoveryAdmin = new Hono<{ Bindings: Env }>();

interface RecoveryImportRequest {
  import_id?: string;
  cursor?: number;
  next_cursor?: number | null;
  transactions?: RecoveryImportTransaction[];
}

recoveryAdmin.post("/admin/recovery/import", async (c) => {
  const body = await c.req.json<RecoveryImportRequest>().catch(() => null);
  if (!body || typeof body.import_id !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(body.import_id))
    return c.json({ error: "valid import_id is required" }, 400);
  if (!Number.isSafeInteger(body.cursor) || Number(body.cursor) < 0)
    return c.json({ error: "valid cursor is required" }, 400);
  if (body.next_cursor !== null && (!Number.isSafeInteger(body.next_cursor) || Number(body.next_cursor) < Number(body.cursor)))
    return c.json({ error: "valid next_cursor is required" }, 400);
  const rows = body.transactions;
  if (!Array.isArray(rows)) return c.json({ error: "transactions must be an array" }, 400);
  try {
    const upserted = rows.length === 0 ? 0 : await importRecoveryTransactions(c.env, rows);
    const now = Math.floor(Date.now() / 1000);
    await c.env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_imports (id,source,cursor,rows_seen,rows_written,started_at,completed_at,error)
       VALUES (?,'api.xcp.io',?,?,?, ?,?,NULL)
       ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor,
         rows_seen=recovery_imports.rows_seen+excluded.rows_seen,
         rows_written=recovery_imports.rows_written+excluded.rows_written,
         completed_at=excluded.completed_at,error=NULL`,
    ).bind(
      body.import_id,
      body.next_cursor == null ? null : String(body.next_cursor),
      rows.reduce((count, row) => count + row.outputs.length, 0),
      upserted,
      now,
      body.next_cursor == null ? now : null,
    ).run();
    return c.json({ ok: true, upserted, next_cursor: body.next_cursor, complete: body.next_cursor == null });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid recovery import" }, 400);
  }
});

recoveryAdmin.get("/admin/recovery/imports/:id", async (c) => {
  const row = await c.env.RECOVERY_DB.prepare(
    `SELECT id,source,cursor,rows_seen,rows_written,started_at,completed_at,error FROM recovery_imports WHERE id=?`,
  ).bind(c.req.param("id")).first();
  return row ? c.json(row) : c.json({ error: "import not found" }, 404);
});
