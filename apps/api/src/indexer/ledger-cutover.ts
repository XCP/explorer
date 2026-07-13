import type { Env } from "#api/env";
import { auditLedgerReadiness, type LedgerReadinessReport } from "#api/indexer/ledger-readiness";

type LedgerEnv = Pick<Env, "DB" | "LEDGER_DB">;
type ReadinessAudit = (env: LedgerEnv, sampleRadius?: number) => Promise<LedgerReadinessReport>;

export type LedgerCutoverActivation = {
  ok: boolean;
  outcome: "activated" | "already_active" | "blocked";
  readiness: LedgerReadinessReport;
};

/**
 * Activate compact-ledger reads only after the complete, read-only readiness audit passes.
 * The conditional update makes retries idempotent and this operation can only write read_cutover=1.
 */
export async function activateLedgerReadCutover(
  env: LedgerEnv,
  sampleRadius?: number,
  audit: ReadinessAudit = auditLedgerReadiness,
): Promise<LedgerCutoverActivation> {
  const readiness = await audit(env, sampleRadius);
  if (!readiness.ready) return { ok: false, outcome: "blocked", readiness };
  if (readiness.state.read_cutover === "1") {
    return { ok: true, outcome: "already_active", readiness };
  }

  const result = await env.LEDGER_DB.prepare(
    `UPDATE ledger_state SET value='1' WHERE key='read_cutover' AND value='0'`,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) {
    return {
      ok: false,
      outcome: "blocked",
      readiness: {
        ...readiness,
        ready: false,
        failures: [...readiness.failures, "read cutover state changed during activation"],
      },
    };
  }
  return { ok: true, outcome: "activated", readiness };
}

export type LedgerCutoverRollback = {
  ok: true;
  outcome: "rolled_back" | "already_inactive";
};

/** Emergency rollback is intentionally separate from activation and can only write read_cutover=0. */
export async function rollbackLedgerReadCutover(db: D1Database): Promise<LedgerCutoverRollback> {
  const result = await db.prepare(`UPDATE ledger_state SET value='0' WHERE key='read_cutover' AND value='1'`).run();
  return {
    ok: true,
    outcome: (result.meta.changes ?? 0) === 1 ? "rolled_back" : "already_inactive",
  };
}
