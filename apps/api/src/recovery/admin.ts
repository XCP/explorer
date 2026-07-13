import { Hono } from "hono";
import type { Env } from "#api/env";
import { importRecoveryTransactions, type RecoveryImportTransaction } from "#api/recovery/import";
import { verifyRecoveryTransactions } from "#api/recovery/verify";
import { boundedInteger } from "#api/http/numbers";
import { advanceImportFrontier, type ImportReceipt } from "#api/recovery/import-receipts";
import { reconcileRecoveryAttempts } from "#api/recovery/attempts";
import { stampProtectionSourcePage, type StampProtectionSource } from "#api/recovery/stamp-source";
import { auditRecoveryR2Page } from "#api/recovery/r2-audit";

export const recoveryAdmin = new Hono<{ Bindings: Env }>();

interface RecoveryImportRequest {
  import_id?: string;
  cursor?: number;
  next_cursor?: number | null;
  transactions?: RecoveryImportTransaction[];
}

interface StampProtectionRequest {
  transactions?: Array<{ txid?: string; source_reference?: string }>;
  complete?: boolean;
}

async function storeStampProtections(
  env: Env,
  entries: StampProtectionSource[],
  now: number,
  source = "issuance-description",
): Promise<number> {
  const uniqueTransactions = [...new Set(entries.map(({ txid }) => txid))];
  const statements = [
    ...uniqueTransactions.map((txid) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_protected_transactions (txid,protection_kind,protected_at)
         VALUES (?,'stamp',?) ON CONFLICT(txid) DO UPDATE SET protected_at=excluded.protected_at`,
      ).bind(txid, now),
    ),
    ...entries.map(({ txid, source_reference: reference }) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_protection_sources (txid,source,source_reference,recorded_at)
         VALUES (?,?,?,?)
         ON CONFLICT(txid,source,source_reference) DO UPDATE SET recorded_at=excluded.recorded_at`,
      ).bind(txid, source, reference, now),
    ),
  ];
  for (let index = 0; index < statements.length; index += 100)
    await env.RECOVERY_DB.batch(statements.slice(index, index + 100));
  return uniqueTransactions.length;
}

interface OfficialStampProtectionRequest extends StampProtectionRequest {
  cursor?: number;
  next_cursor?: number | null;
  snapshot_sha256?: string;
}

recoveryAdmin.post("/admin/recovery/protections/stamps/official", async (c) => {
  const body = await c.req.json<OfficialStampProtectionRequest>().catch(() => null);
  if (!body || !Number.isSafeInteger(body.cursor) || Number(body.cursor) < -1)
    return c.json({ error: "valid cursor is required" }, 400);
  if (!/^[0-9a-f]{64}$/.test(String(body.snapshot_sha256 ?? "")))
    return c.json({ error: "valid snapshot_sha256 is required" }, 400);
  if (
    body.next_cursor !== null &&
    (!Number.isSafeInteger(body.next_cursor) || Number(body.next_cursor) <= Number(body.cursor))
  )
    return c.json({ error: "valid next_cursor is required" }, 400);
  if (!Array.isArray(body.transactions) || body.transactions.length > 500)
    return c.json({ error: "transactions must be an array of at most 500 entries" }, 400);
  const entries = body.transactions.map((entry) => ({
    txid: String(entry.txid ?? "").toLowerCase(),
    source_reference: String(entry.source_reference ?? ""),
  }));
  if (
    entries.some(
      ({ txid, source_reference }) => !/^[0-9a-f]{64}$/.test(txid) || !/^stamp:[0-9]+$/.test(source_reference),
    )
  )
    return c.json({ error: "each transaction requires a valid txid and stamp:<number> reference" }, 400);

  const cursor = Number(body.cursor);
  const nextCursor = body.next_cursor == null ? null : Number(body.next_cursor);
  const now = Math.floor(Date.now() / 1000);
  const existing = await c.env.RECOVERY_DB.prepare(
    `SELECT next_cursor,rows_seen,snapshot_sha256 FROM recovery_stamp_import_receipts WHERE page_cursor=?`,
  )
    .bind(cursor)
    .first<{ next_cursor: number | null; rows_seen: number; snapshot_sha256: string }>();
  if (
    existing &&
    (Number(existing.rows_seen) !== entries.length ||
      (existing.next_cursor == null ? null : Number(existing.next_cursor)) !== nextCursor ||
      existing.snapshot_sha256 !== body.snapshot_sha256)
  )
    return c.json({ error: "official Stamp page conflicts with its recorded receipt" }, 409);

  const protectedTransactions = await storeStampProtections(c.env, entries, now, "btc-stamps-indexer");
  await c.env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_stamp_import_receipts
       (page_cursor,next_cursor,rows_seen,snapshot_sha256,recorded_at)
     VALUES (?,?,?,?,?) ON CONFLICT(page_cursor) DO NOTHING`,
  )
    .bind(cursor, nextCursor, entries.length, body.snapshot_sha256, now)
    .run();
  if (body.complete === true && nextCursor === null)
    await c.env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_state (key,value,updated_at) VALUES ('official_stamp_protection_ready','1',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    )
      .bind(now)
      .run();
  return c.json({
    ok: true,
    replay: Boolean(existing),
    protected_transactions: protectedTransactions,
    provenance_rows: entries.length,
    next_cursor: nextCursor,
  });
});

recoveryAdmin.post("/admin/recovery/protections/stamps", async (c) => {
  const body = await c.req.json<StampProtectionRequest>().catch(() => null);
  if (!body || !Array.isArray(body.transactions) || body.transactions.length > 500)
    return c.json({ error: "transactions must be an array of at most 500 entries" }, 400);
  const entries = body.transactions.map((entry) => ({
    txid: String(entry.txid ?? "").toLowerCase(),
    reference: String(entry.source_reference ?? ""),
  }));
  if (entries.some(({ txid, reference }) => !/^[0-9a-f]{64}$/.test(txid) || !reference || reference.length > 256))
    return c.json({ error: "each transaction requires a valid txid and source_reference" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const sourceEntries = entries.map(({ txid, reference }) => ({ txid, source_reference: reference }));
  const protectedTransactions = await storeStampProtections(c.env, sourceEntries, now);
  if (body.complete === true)
    await c.env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_state (key,value,updated_at) VALUES ('stamp_protection_ready','1',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    )
      .bind(now)
      .run();
  return c.json({ ok: true, protected_transactions: protectedTransactions, provenance_rows: entries.length });
});

recoveryAdmin.post("/admin/recovery/protections/stamps/bootstrap", async (c) => {
  const cursor = boundedInteger(c.req.query("cursor"), { defaultValue: -1, min: -1 });
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 500, min: 1, max: 2_000 });
  const page = await stampProtectionSourcePage(c.env.DB, cursor, limit);
  const now = Math.floor(Date.now() / 1000);
  const protectedTransactions = await storeStampProtections(c.env, page.transactions, now);
  if (page.next_cursor === null)
    await c.env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_state (key,value,updated_at) VALUES ('stamp_protection_ready','1',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    )
      .bind(now)
      .run();
  return c.json({
    ok: true,
    scanned: page.scanned,
    protected_transactions: protectedTransactions,
    provenance_rows: page.transactions.length,
    next_cursor: page.next_cursor,
    complete: page.next_cursor === null,
  });
});

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

recoveryAdmin.get("/admin/recovery/audit/transactions", async (c) => {
  const cursor = c.req.query("cursor") ?? "";
  if (cursor && !/^[0-9a-f]{64}$/.test(cursor)) return c.json({ error: "invalid cursor" }, 400);
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await auditRecoveryR2Page(c.env, cursor, limit));
});

recoveryAdmin.post("/admin/recovery/finalize", async (c) => {
  const [imports, unchecked, stampProtection] = await Promise.all([
    c.env.RECOVERY_DB.prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) completed FROM recovery_imports`,
    ).first<{ total: number; completed: number }>(),
    c.env.RECOVERY_DB.prepare(`SELECT COUNT(*) count FROM recovery_outputs WHERE chain_checked_at IS NULL`).first<{
      count: number;
    }>(),
    c.env.RECOVERY_DB.prepare(`SELECT value FROM recovery_state WHERE key='stamp_protection_ready'`).first<{
      value: string;
    }>(),
  ]);
  const totalImports = Number(imports?.total ?? 0);
  const completedImports = Number(imports?.completed ?? 0);
  const uncheckedOutputs = Number(unchecked?.count ?? 0);
  const stampProtectionReady = stampProtection?.value === "1";
  if (totalImports === 0 || completedImports !== totalImports || uncheckedOutputs !== 0 || !stampProtectionReady) {
    return c.json(
      {
        error: "recovery index is not ready",
        total_imports: totalImports,
        completed_imports: completedImports,
        unchecked_outputs: uncheckedOutputs,
        stamp_protection_ready: stampProtectionReady,
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
