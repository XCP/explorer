import { Hono } from "hono";
import type { Env } from "#api/env";
import { verifyRecoveryTransactions } from "#api/recovery/verify";
import { boundedInteger } from "#api/http/numbers";
import { reconcileRecoveryAttempts } from "#api/recovery/attempts";
import { recoveryHealth } from "#api/recovery/health";
import { reclassifyRecoveryOutputs } from "#api/recovery/reclassify";
import { auditRecoveryR2Page, recoveryR2AuditManifest, type RecoveryR2AuditManifest } from "#api/recovery/r2-audit";
import { scanRecoveryTransactions } from "#api/recovery/scanner";
import { refreshRecoveryStats } from "#api/recovery/stats";

export const recoveryAdmin = new Hono<{ Bindings: Env }>();

recoveryAdmin.get("/admin/recovery/protections/stamps/parity", async (c) => {
  const [counts, readiness, receipts] = await Promise.all([
    c.env.RECOVERY_DB.prepare(
      `SELECT
         COUNT(DISTINCT txid) protected_transactions,
         COUNT(DISTINCT CASE WHEN source='issuance-description' THEN txid END) issuance_transactions,
         COUNT(DISTINCT CASE WHEN source='btc-stamps-indexer' THEN txid END) official_transactions,
         COUNT(DISTINCT CASE WHEN source='btc-stamps-indexer' AND NOT EXISTS (
           SELECT 1 FROM recovery_protection_sources i
            WHERE i.txid=recovery_protection_sources.txid AND i.source='issuance-description'
         ) THEN txid END) official_only_transactions
       FROM recovery_protection_sources`,
    ).first(),
    c.env.RECOVERY_DB.prepare(
      `SELECT key,value,updated_at FROM recovery_state
        WHERE key IN ('stamp_protection_ready','official_stamp_protection_ready') ORDER BY key`,
    ).all(),
    c.env.RECOVERY_DB.prepare(
      `SELECT COUNT(*) pages,COALESCE(SUM(rows_seen),0) rows_seen,
              COUNT(DISTINCT snapshot_sha256) snapshots,MAX(next_cursor) cursor
         FROM recovery_stamp_import_receipts`,
    ).first(),
  ]);
  return c.json({ counts, readiness: readiness.results, import: receipts });
});

recoveryAdmin.post("/admin/recovery/verify", async (c) => {
  const limit = boundedInteger(c.req.query("transactions"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await verifyRecoveryTransactions(c.env, limit));
});

recoveryAdmin.post("/admin/recovery/reconcile-attempts", async (c) => {
  const limit = boundedInteger(c.req.query("attempts"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await reconcileRecoveryAttempts(c.env, limit));
});

recoveryAdmin.post("/admin/recovery/reclassify", async (c) => {
  const limit = boundedInteger(c.req.query("transactions"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await reclassifyRecoveryOutputs(c.env, limit));
});

recoveryAdmin.post("/admin/recovery/scan", async (c) => {
  const limit = boundedInteger(c.req.query("transactions"), { defaultValue: 200, min: 1, max: 250 });
  return c.json(await scanRecoveryTransactions(c.env, limit));
});

recoveryAdmin.post("/admin/recovery/stats/refresh", async (c) => c.json(await refreshRecoveryStats(c.env, true)));

recoveryAdmin.get("/admin/recovery/live-status", async (c) => {
  const [state, queue, attempts, stats, health] = await Promise.all([
    c.env.RECOVERY_DB.prepare(
      `SELECT key,value,updated_at FROM recovery_state WHERE key IN ('recovery_scan_tx_index','read_ready') ORDER BY key`,
    ).all(),
    c.env.RECOVERY_DB.prepare(
      `SELECT COUNT(DISTINCT txid) transactions FROM recovery_outputs WHERE chain_checked_at IS NULL`,
    ).first(),
    c.env.RECOVERY_DB.prepare(`SELECT COUNT(*) attempts FROM recovery_attempts WHERE status='pending'`).first(),
    c.env.RECOVERY_DB.prepare(`SELECT * FROM recovery_stats_snapshot WHERE singleton=1`).first(),
    recoveryHealth(c.env),
  ]);
  return c.json({ state: state.results, verification_queue: queue, pending_attempts: attempts, stats, health });
});

/** Alert surface: `health.unsettled.outputs` above zero means recovered coins are being re-offered. */
recoveryAdmin.get("/admin/recovery/health", async (c) => c.json(await recoveryHealth(c.env)));

recoveryAdmin.get("/admin/recovery/audit/transactions", async (c) => {
  const cursor = c.req.query("cursor") ?? "";
  if (cursor && !/^[0-9a-f]{64}$/.test(cursor)) return c.json({ error: "invalid cursor" }, 400);
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 25, min: 1, max: 100 });
  return c.json(await auditRecoveryR2Page(c.env, cursor, limit));
});

recoveryAdmin.get("/admin/recovery/audit/transactions/manifest", async (c) =>
  c.json(await recoveryR2AuditManifest(c.env.RECOVERY_DB)),
);

interface RecoveryR2AuditAcceptance {
  manifest?: RecoveryR2AuditManifest;
  checked?: number;
  last_cursor?: string | null;
  missing?: number;
  corrupt?: number;
}

recoveryAdmin.post("/admin/recovery/audit/transactions/accept", async (c) => {
  const body = await c.req.json<RecoveryR2AuditAcceptance>().catch(() => null);
  if (!body || !body.manifest || !Number.isSafeInteger(body.checked) || body.checked! < 0)
    return c.json({ error: "valid R2 audit report is required" }, 400);
  if (
    !Number.isSafeInteger(body.missing) ||
    body.missing! < 0 ||
    !Number.isSafeInteger(body.corrupt) ||
    body.corrupt! < 0
  )
    return c.json({ error: "valid R2 audit result counts are required" }, 400);
  if (body.last_cursor !== null && !/^[0-9a-f]{64}$/.test(String(body.last_cursor ?? "")))
    return c.json({ error: "valid last_cursor is required" }, 400);

  const current = await recoveryR2AuditManifest(c.env.RECOVERY_DB);
  const stableManifest = JSON.stringify(body.manifest) === JSON.stringify(current);
  const complete =
    stableManifest &&
    current.imports_complete &&
    body.checked === current.transactions &&
    body.last_cursor === current.last_txid &&
    body.missing === 0 &&
    body.corrupt === 0;
  if (!complete)
    return c.json(
      {
        error: "R2 audit is not complete for the current recovery import",
        stable_manifest: stableManifest,
        current_manifest: current,
        checked: body.checked,
        last_cursor: body.last_cursor,
        missing: body.missing,
        corrupt: body.corrupt,
      },
      409,
    );

  const now = Math.floor(Date.now() / 1000);
  const accepted = await c.env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_state (key,value,updated_at)
       SELECT 'r2_audit_ready','1',?
        WHERE (SELECT value FROM recovery_state WHERE key='r2_audit_generation')=?
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
  )
    .bind(now, String(current.generation))
    .run();
  if (Number(accepted.meta.changes) !== 1)
    return c.json({ error: "recovery import changed while accepting the R2 audit" }, 409);
  await c.env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_state (key,value,updated_at) VALUES ('r2_audit_manifest',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
  )
    .bind(JSON.stringify(current), now)
    .run();
  return c.json({ ok: true, r2_audit_ready: true, manifest: current });
});
