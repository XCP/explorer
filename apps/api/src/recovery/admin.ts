import { Hono } from "hono";
import type { Env } from "#api/env";
import { importRecoveryTransactions, type RecoveryImportTransaction } from "#api/recovery/import";
import { verifyRecoveryTransactions } from "#api/recovery/verify";
import { boundedInteger } from "#api/http/numbers";
import { advanceImportFrontier, type ImportReceipt } from "#api/recovery/import-receipts";
import { reconcileRecoveryAttempts } from "#api/recovery/attempts";

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
  if (
    body.next_cursor !== null &&
    (!Number.isSafeInteger(body.next_cursor) || Number(body.next_cursor) <= Number(body.cursor))
  )
    return c.json({ error: "valid next_cursor is required" }, 400);
  const rows = body.transactions;
  if (!Array.isArray(rows)) return c.json({ error: "transactions must be an array" }, 400);
  try {
    const pageCursor = Number(body.cursor);
    const nextCursor = body.next_cursor == null ? null : Number(body.next_cursor);
    const rowsSeen = rows.reduce((count, row) => count + row.outputs.length, 0);
    const existingReceipt = await c.env.RECOVERY_DB.prepare(
      `SELECT next_cursor,rows_seen FROM recovery_import_receipts WHERE import_id=? AND page_cursor=?`,
    )
      .bind(body.import_id, pageCursor)
      .first<{ next_cursor: number | null; rows_seen: number }>();
    if (
      existingReceipt &&
      (Number(existingReceipt.rows_seen) !== rowsSeen ||
        (existingReceipt.next_cursor == null ? null : Number(existingReceipt.next_cursor)) !== nextCursor)
    ) {
      return c.json({ error: "replayed recovery import page does not match its receipt" }, 409);
    }
    const upserted = rows.length === 0 ? 0 : await importRecoveryTransactions(c.env, rows);
    const now = Math.floor(Date.now() / 1000);
    await c.env.RECOVERY_DB.batch([
      c.env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_imports
           (id,source,cursor,rows_seen,rows_written,started_at,completed_at,error,
            receipt_base_cursor,receipt_base_rows_seen,receipt_base_rows_written)
         VALUES (?,'api.xcp.io',?,0,0,?,NULL,NULL,?,0,0)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(body.import_id, String(pageCursor), now, pageCursor),
      c.env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_import_receipts
           (import_id,page_cursor,next_cursor,rows_seen,rows_written,received_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(import_id,page_cursor) DO NOTHING`,
      ).bind(body.import_id, pageCursor, nextCursor, rowsSeen, upserted, now),
    ]);

    const [importRow, receiptRows] = await Promise.all([
      c.env.RECOVERY_DB.prepare(`SELECT cursor FROM recovery_imports WHERE id=?`)
        .bind(body.import_id)
        .first<{ cursor: string | null }>(),
      c.env.RECOVERY_DB.prepare(
        `SELECT page_cursor,next_cursor FROM recovery_import_receipts WHERE import_id=? ORDER BY page_cursor`,
      )
        .bind(body.import_id)
        .all<ImportReceipt>(),
    ]);
    const frontier = advanceImportFrontier(Number(importRow?.cursor ?? pageCursor), receiptRows.results);
    await c.env.RECOVERY_DB.prepare(
      `UPDATE recovery_imports SET
         cursor=?,
         rows_seen=receipt_base_rows_seen+
           (SELECT COALESCE(SUM(rows_seen),0) FROM recovery_import_receipts WHERE import_id=?),
         rows_written=receipt_base_rows_written+
           (SELECT COALESCE(SUM(rows_written),0) FROM recovery_import_receipts WHERE import_id=?),
         completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END,
         error=NULL
       WHERE id=? AND (completed_at IS NOT NULL OR CAST(COALESCE(cursor,'0') AS INTEGER)<=?)`,
    )
      .bind(
        String(frontier.cursor),
        body.import_id,
        body.import_id,
        frontier.complete ? 1 : 0,
        now,
        body.import_id,
        frontier.cursor,
      )
      .run();
    return c.json({
      ok: true,
      upserted,
      replayed: !!existingReceipt,
      next_cursor: frontier.complete ? null : frontier.cursor,
      complete: frontier.complete,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid recovery import" }, 400);
  }
});

recoveryAdmin.get("/admin/recovery/imports/:id", async (c) => {
  const row = await c.env.RECOVERY_DB.prepare(
    `SELECT id,source,cursor,rows_seen,rows_written,started_at,completed_at,error FROM recovery_imports WHERE id=?`,
  )
    .bind(c.req.param("id"))
    .first();
  return row ? c.json(row) : c.json({ error: "import not found" }, 404);
});

recoveryAdmin.post("/admin/recovery/verify", async (c) => {
  const limit = boundedInteger(c.req.query("transactions"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await verifyRecoveryTransactions(c.env, limit));
});

recoveryAdmin.post("/admin/recovery/reconcile-attempts", async (c) => {
  const limit = boundedInteger(c.req.query("attempts"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await reconcileRecoveryAttempts(c.env, limit));
});

recoveryAdmin.post("/admin/recovery/finalize", async (c) => {
  const [imports, unchecked] = await Promise.all([
    c.env.RECOVERY_DB.prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) completed FROM recovery_imports`,
    ).first<{ total: number; completed: number }>(),
    c.env.RECOVERY_DB.prepare(`SELECT COUNT(*) count FROM recovery_outputs WHERE chain_checked_at IS NULL`).first<{
      count: number;
    }>(),
  ]);
  const totalImports = Number(imports?.total ?? 0);
  const completedImports = Number(imports?.completed ?? 0);
  const uncheckedOutputs = Number(unchecked?.count ?? 0);
  if (totalImports === 0 || completedImports !== totalImports || uncheckedOutputs !== 0) {
    return c.json(
      {
        error: "recovery index is not ready",
        total_imports: totalImports,
        completed_imports: completedImports,
        unchecked_outputs: uncheckedOutputs,
      },
      409,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_state (key,value,updated_at) VALUES ('read_ready','1',?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
  )
    .bind(now)
    .run();
  return c.json({ ok: true, read_ready: true });
});
