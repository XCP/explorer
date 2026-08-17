import type { Env } from "#api/env";
import {
  ELECTRS_REQUEST_BATCH_INTERVAL_MS,
  ELECTRS_REQUEST_BATCH_SIZE,
  fetchTransactionOutspends,
} from "#api/integrations/electrs";

interface RecoveryOutputIdentity {
  txid: string;
  vout: number;
  classification: string;
}

type FetchOutspends = typeof fetchTransactionOutspends;
const RETRY_SHARE = 0.1;
/**
 * How long a `recoverable` verdict is trusted before the output is checked again. Verification used
 * to be strictly one-shot — an output checked once while unspent could never re-enter the queue — so
 * an output spent after that check stayed `recoverable` forever. Recoveries this service performs are
 * marked spent directly from their attempt record; this sweep is the backstop for spends it did not
 * cause, so it runs slowly and always yields to never-checked work.
 */
export const RECOVERY_REVERIFY_INTERVAL_SECONDS = 30 * 86_400;

/**
 * How recently a reader must have verified an address before another page view stops asking again.
 * A reader is the sharpest signal the index has: the page someone is about to spend from is the page
 * that must be right, and a blind monthly sweep will not reach it in time.
 */
export const RECOVERY_READ_REVERIFY_SECONDS = 3_600;

/**
 * `chain_checked_at` sentinel marking an output a reader asked us to re-check. It outranks the rolling
 * backstop without displacing never-checked imports, which stay strictly first at -1.
 */
const REVERIFY_REQUESTED = 0;

/**
 * Priority order: never-checked imports, then reader requests, then the rolling backstop oldest-first.
 * No backlog can starve new work no matter how large the tracked set grows.
 */
export const RECOVERY_VERIFICATION_QUEUE_SQL = `
  WITH due_retries AS (
    SELECT f.txid,f.next_retry_at
      FROM recovery_verification_failures f
     WHERE f.next_retry_at<=?
       AND EXISTS (
         SELECT 1 FROM recovery_outputs o
          WHERE o.txid=f.txid
            AND (o.chain_checked_at IS NULL OR (o.classification='recoverable' AND o.chain_checked_at<=?))
       )
     ORDER BY f.next_retry_at,f.txid
     LIMIT ?
  ), never AS (
    SELECT DISTINCT o.txid
      FROM recovery_outputs o
     WHERE o.chain_checked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM recovery_verification_failures f WHERE f.txid=o.txid)
     LIMIT ?
  ), backstop AS (
    SELECT c.txid,MIN(c.chain_checked_at) checked_at FROM (
      SELECT o.txid,o.chain_checked_at
        FROM recovery_outputs o
       WHERE o.classification='recoverable' AND o.chain_checked_at<=?
         AND NOT EXISTS (SELECT 1 FROM recovery_verification_failures f WHERE f.txid=o.txid)
       ORDER BY o.chain_checked_at,o.txid
       LIMIT ?
    ) c
     GROUP BY c.txid
     ORDER BY checked_at,c.txid
     LIMIT ?
  )
  SELECT txid FROM (
    SELECT txid,0 AS pool_order,next_retry_at AS sort_at FROM due_retries
    UNION ALL
    SELECT txid,1 AS pool_order,-1 AS sort_at FROM never
    UNION ALL
    SELECT txid,2 AS pool_order,checked_at AS sort_at FROM backstop
  )
  ORDER BY pool_order,sort_at,txid
  LIMIT ?`;

/**
 * How many OUTPUTS the backstop arm reads to find its page of TXIDS.
 *
 * Outputs collapse into transactions, so the window has to overshoot the page
 * it is filling. 40x covers the observed fan-out with room to spare; a window
 * too small does not break anything, it just returns a short page and the next
 * tick continues from the same place.
 *
 * This is the whole reason the arm is cheap now: the scan is bounded, so cost
 * is a function of the page size rather than of how many outputs happen to be
 * due. It is what keeps a bulk import from making every run read the entire
 * eligible set.
 */
export const VERIFICATION_BACKSTOP_WINDOW = 40;

/**
 * Ask for the outputs a reader is about to act on to be re-checked, highest value first. Rate limiting
 * is inherent rather than bookkept: a row already requested sits at the sentinel and a freshly verified
 * one is inside the window, so both fall outside this predicate and a refresh loop writes nothing.
 */
export const RECOVERY_REQUEST_REVERIFY_SQL = `
  UPDATE recovery_outputs SET chain_checked_at=${REVERIFY_REQUESTED}
   WHERE (txid,vout) IN (
     SELECT txid,vout FROM recovery_outputs
      WHERE recovery_address=? AND classification='recoverable'
        AND chain_checked_at>=1 AND chain_checked_at<=?
      ORDER BY value_sats DESC,txid,vout LIMIT ?)`;

/** Fire-and-forget: a verification request must never fail or delay the page that triggered it. */
export async function requestAddressReverification(env: Env, address: string, limit: number): Promise<void> {
  const staleBefore = Math.floor(Date.now() / 1000) - RECOVERY_READ_REVERIFY_SECONDS;
  try {
    await env.RECOVERY_DB.prepare(RECOVERY_REQUEST_REVERIFY_SQL).bind(address, staleBefore, limit).run();
  } catch (error) {
    console.error("recovery re-verification request failed", error);
  }
}

export function verificationRetryQuota(limit: number): number {
  return Math.max(1, Math.floor(limit * RETRY_SHARE));
}

export function verificationRetryDelay(attempts: number): number {
  return Math.min(6 * 60 * 60, 30 * 2 ** Math.min(10, Math.max(0, attempts - 1)));
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

export async function verifyRecoveryTransactions(
  env: Env,
  transactionLimit = 25,
  options: { fetchOutspends?: FetchOutspends; now?: number; batchIntervalMs?: number } = {},
): Promise<{ transactions: number; outputs: number; spent: number; failed: number }> {
  const limit = Math.min(100, Math.max(1, Math.trunc(transactionLimit)));
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const fetchOutspends = options.fetchOutspends ?? fetchTransactionOutspends;
  const batchIntervalMs = options.batchIntervalMs ?? ELECTRS_REQUEST_BATCH_INTERVAL_MS;
  const staleBefore = now - RECOVERY_REVERIFY_INTERVAL_SECONDS;
  const transactionRows = await env.RECOVERY_DB.prepare(RECOVERY_VERIFICATION_QUEUE_SQL)
    // Order matches the CTEs: due_retries(now, staleBefore, retryQuota),
    // never(limit), backstop(staleBefore, scanWindow, limit), outer(limit).
    .bind(
      now,
      staleBefore,
      verificationRetryQuota(limit),
      limit,
      staleBefore,
      limit * VERIFICATION_BACKSTOP_WINDOW,
      limit,
      limit,
    )
    .all<{ txid: string }>();
  if (transactionRows.results.length === 0) return { transactions: 0, outputs: 0, spent: 0, failed: 0 };

  const identities = (
    await env.RECOVERY_DB.batch(
      transactionRows.results.map((row) =>
        env.RECOVERY_DB.prepare(`SELECT txid,vout,classification FROM recovery_outputs WHERE txid=?`).bind(row.txid),
      ),
    )
  ).flatMap((result) => result.results as unknown as RecoveryOutputIdentity[]);
  const outspendsByTxid = new Map<string, Awaited<ReturnType<typeof fetchTransactionOutspends>>>();
  const failures = new Map<string, string>();
  for (let offset = 0; offset < transactionRows.results.length; offset += ELECTRS_REQUEST_BATCH_SIZE) {
    const batch = transactionRows.results.slice(offset, offset + ELECTRS_REQUEST_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((row) => fetchOutspends(env.ELECTRS_API_BASE, row.txid)));
    batch.forEach((row, index) => {
      const result = results[index];
      if (result.status === "fulfilled") outspendsByTxid.set(row.txid, result.value);
      else failures.set(row.txid, result.reason instanceof Error ? result.reason.message : "Electrs lookup failed");
    });
    if (offset + ELECTRS_REQUEST_BATCH_SIZE < transactionRows.results.length && batchIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, batchIntervalMs));
    }
  }

  let spent = 0;
  const update = env.RECOVERY_DB.prepare(
    `UPDATE recovery_outputs SET classification=?,reason=?,spent_by_txid=?,spent_height=?,chain_checked_at=?
      WHERE txid=? AND vout=?`,
  );
  const successfulTxids = new Set(transactionRows.results.map((row) => row.txid).filter((txid) => !failures.has(txid)));
  for (const identity of identities) {
    if (!successfulTxids.has(identity.txid)) continue;
    const result = outspendsByTxid.get(identity.txid)?.[identity.vout];
    if (!result) {
      successfulTxids.delete(identity.txid);
      failures.set(identity.txid, `Electrs omitted output ${identity.vout}`);
    }
  }
  const updates = identities
    .filter((identity) => successfulTxids.has(identity.txid))
    .map((identity) => {
      const result = outspendsByTxid.get(identity.txid)![identity.vout];
      if (result.spent) spent++;
      const sourceVerified = identity.classification === "recoverable" || identity.classification === "spent";
      return update.bind(
        sourceVerified ? (result.spent ? "spent" : "recoverable") : identity.classification,
        sourceVerified
          ? result.spent
            ? "verified-output-already-spent"
            : "verified-counterparty-recovery-output"
          : "counterparty-provenance-not-verified",
        result.spent ? result.txid : null,
        result.spent ? result.block_height : null,
        now,
        identity.txid,
        identity.vout,
      );
    });
  for (const batch of chunks(updates, 100)) await env.RECOVERY_DB.batch(batch);
  const bookkeeping = [
    ...[...successfulTxids].map((txid) =>
      env.RECOVERY_DB.prepare(`DELETE FROM recovery_verification_failures WHERE txid=?`).bind(txid),
    ),
    ...[...failures].map(([txid, message]) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_verification_failures
           (txid,attempts,first_failed_at,last_failed_at,next_retry_at,last_error)
         VALUES (?,1,?,?,?,?)
         ON CONFLICT(txid) DO UPDATE SET
           attempts=attempts+1,last_failed_at=excluded.last_failed_at,
           next_retry_at=excluded.last_failed_at + MIN(21600,30 * (1 << MIN(10,attempts))),
           last_error=excluded.last_error`,
      ).bind(txid, now, now, now + verificationRetryDelay(1), message.slice(0, 500)),
    ),
  ];
  for (const batch of chunks(bookkeeping, 100)) await env.RECOVERY_DB.batch(batch);
  return {
    transactions: successfulTxids.size,
    outputs: updates.length,
    spent,
    failed: failures.size,
  };
}
