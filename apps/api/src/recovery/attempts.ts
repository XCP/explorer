import type { Env } from "#api/env";
import {
  ELECTRS_SEQUENTIAL_CONCURRENCY,
  fetchTipHeight,
  fetchTransactionOutspends,
  fetchTransactionStatus,
  type ElectrsOutspend,
  type ElectrsTransactionStatus,
} from "#api/integrations/electrs";

interface AttemptRow {
  txid: string;
  reported_at: number;
}

interface AttemptInputRow {
  recovery_txid: string;
  input_txid: string;
  input_vout: number;
}

export interface AttemptProviders {
  tipHeight(baseUrl: string): Promise<number>;
  transactionStatus(baseUrl: string, txid: string): Promise<ElectrsTransactionStatus | null>;
  transactionOutspends(baseUrl: string, txid: string): Promise<ElectrsOutspend[]>;
}

const DEFAULT_PROVIDERS: AttemptProviders = {
  tipHeight: fetchTipHeight,
  transactionStatus: fetchTransactionStatus,
  transactionOutspends: fetchTransactionOutspends,
};
const PROVIDER_CONCURRENCY = ELECTRS_SEQUENTIAL_CONCURRENCY;
/**
 * Confirmations required before a recovery's spend is written durably into recovery_outputs. The read
 * path withholds an attempt's inputs from the moment it is reported, so waiting costs the owner nothing
 * — but a `spent` verdict is never revisited, so settling at a single confirmation would let a reorg
 * strand an output permanently.
 */
export const RECOVERY_SPEND_CONFIRMATIONS = 6;

/**
 * How long a reported recovery that the network has never seen is believed before its inputs are
 * handed back. Bitcoin Core evicts a transaction from the mempool after 14 days (`mempoolexpiry`), so
 * past that point a transaction absent from both mempool and chain, whose inputs nothing has spent,
 * was never going to land. Waiting is not free: the read path withholds an attempt's inputs from the
 * moment it is reported, so a wallet that signed but never broadcast silently hides its owner's own
 * outputs from them for as long as this window lasts.
 */
export const RECOVERY_ABANDON_AFTER_SECONDS = 14 * 86_400;

/** The reason recorded when {@link RECOVERY_ABANDON_AFTER_SECONDS} elapses with no transaction on the network. */
export const RECOVERY_ABANDONED_REASON = "abandoned-never-broadcast";

/**
 * Attempts stay in a partial work queue until they are confirmed deeply enough and their consumed
 * outputs have been settled in the same atomic batch. The prior query derived that last condition by
 * walking every historical attempt's inputs every two minutes. Even with bounded primary-key probes,
 * completed history made an idle queue read tens of thousands of rows forever.
 *
 * `settlement_pending` alone is the predicate. Spelling it as three disjuncts made an abandoned attempt
 * impossible to retire — `status<>'confirmed'` and `confirmations<${RECOVERY_SPEND_CONFIRMATIONS}` are
 * both true of a failed row, so it re-entered the queue every two minutes forever no matter what the
 * flag said.
 */
export const RECOVERY_ATTEMPT_QUEUE_SQL = `
  SELECT a.txid,a.reported_at FROM recovery_attempts a INDEXED BY recovery_attempts_work_queue
   WHERE a.settlement_pending=1
   ORDER BY a.chain_checked_at,a.reported_at,a.txid LIMIT ?`;

export interface AttemptEvidence {
  status: "pending" | "confirmed" | "replaced" | "failed";
  replacementTxid: string | null;
  blockHeight: number | null;
  blockHash: string | null;
  blockTime: number | null;
  confirmations: number;
  reason: string;
  /**
   * Whether this outcome hands the attempt's inputs back to their owner. True only for abandonment,
   * which is the one outcome that proves nothing consumed them; every other terminal status means some
   * transaction did.
   */
  releasesInputs: boolean;
}

/**
 * @param unbroadcastFor seconds since the attempt was reported, which is how long the network has had
 *   to show us the transaction. Only consulted when there is no transaction and no conflicting spend.
 */
export function classifyAttemptEvidence(
  txid: string,
  transaction: ElectrsTransactionStatus | null,
  inputOutspends: ElectrsOutspend[],
  tipHeight: number,
  unbroadcastFor: number,
): AttemptEvidence {
  if (transaction) {
    const confirmations =
      transaction.confirmed && transaction.blockHeight != null
        ? Math.max(1, tipHeight - transaction.blockHeight + 1)
        : 0;
    return {
      status: transaction.confirmed ? "confirmed" : "pending",
      replacementTxid: null,
      blockHeight: transaction.blockHeight,
      blockHash: transaction.blockHash,
      blockTime: transaction.blockTime,
      confirmations,
      reason: transaction.confirmed ? "transaction-confirmed" : "transaction-in-mempool",
      releasesInputs: false,
    };
  }

  const conflicts = [
    ...new Set(inputOutspends.filter((row) => row.spent && row.txid && row.txid !== txid).map((row) => row.txid!)),
  ].sort();
  if (conflicts.length === 1) {
    return {
      status: "replaced",
      replacementTxid: conflicts[0],
      blockHeight: null,
      blockHash: null,
      blockTime: null,
      confirmations: 0,
      reason: "input-spent-by-replacement",
      releasesInputs: false,
    };
  }
  if (conflicts.length > 1) {
    return {
      status: "failed",
      replacementTxid: null,
      blockHeight: null,
      blockHash: null,
      blockTime: null,
      confirmations: 0,
      reason: "inputs-spent-by-multiple-transactions",
      releasesInputs: false,
    };
  }
  // Nothing on the network claims these inputs, and nothing ever did. Before the abandonment window
  // that is ordinary — a wallet can broadcast slowly, and re-offering the inputs early risks the owner
  // signing a second spend that conflicts with the first. After it, holding them is the greater harm.
  const abandoned = unbroadcastFor >= RECOVERY_ABANDON_AFTER_SECONDS;
  return {
    status: abandoned ? "failed" : "pending",
    replacementTxid: null,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
    confirmations: 0,
    reason: abandoned ? RECOVERY_ABANDONED_REASON : "transaction-not-seen-inputs-unspent",
    releasesInputs: abandoned,
  };
}

export async function reconcileRecoveryAttempts(
  env: Env,
  limit: number,
  providers: AttemptProviders = DEFAULT_PROVIDERS,
): Promise<{ checked: number; failed: number }> {
  const attempts = await env.RECOVERY_DB.prepare(RECOVERY_ATTEMPT_QUEUE_SQL).bind(limit).all<AttemptRow>();
  if (attempts.results.length === 0) return { checked: 0, failed: 0 };

  const placeholders = attempts.results.map(() => "?").join(",");
  const inputs = await env.RECOVERY_DB.prepare(
    `SELECT recovery_txid,input_txid,input_vout FROM recovery_attempt_inputs
      WHERE recovery_txid IN (${placeholders}) ORDER BY recovery_txid,input_txid,input_vout`,
  )
    .bind(...attempts.results.map((row) => row.txid))
    .all<AttemptInputRow>();
  const tipHeight = await providers.tipHeight(env.ELECTRS_API_BASE);
  const now = Math.floor(Date.now() / 1000);
  const reconcileAttempt = async (attempt: AttemptRow) => {
    const attemptInputs = inputs.results.filter((input) => input.recovery_txid === attempt.txid);
    const unbroadcastFor = now - attempt.reported_at;
    const transaction = await providers.transactionStatus(env.ELECTRS_API_BASE, attempt.txid);
    if (transaction) {
      const evidence = classifyAttemptEvidence(attempt.txid, transaction, [], tipHeight, unbroadcastFor);
      return recoveryAttemptStatements(env.RECOVERY_DB, attempt.txid, evidence, now, attemptInputs);
    }
    const parentTxids = [...new Set(attemptInputs.map((row) => row.input_txid))];
    const parentOutspends = [] as ElectrsOutspend[][];
    for (const txid of parentTxids) {
      parentOutspends.push(await providers.transactionOutspends(env.ELECTRS_API_BASE, txid));
    }
    const outspends = new Map(parentTxids.map((txid, index) => [txid, parentOutspends[index]]));
    const evidence = classifyAttemptEvidence(
      attempt.txid,
      transaction,
      attemptInputs.map((input) => {
        const output = outspends.get(input.input_txid)?.[input.input_vout];
        if (!output) throw new Error(`Electrs omitted recovery input ${input.input_txid}:${input.input_vout}`);
        return output;
      }),
      tipHeight,
      unbroadcastFor,
    );
    return recoveryAttemptStatements(env.RECOVERY_DB, attempt.txid, evidence, now, attemptInputs);
  };
  const settled: PromiseSettledResult<D1PreparedStatement[]>[] = [];
  for (let index = 0; index < attempts.results.length; index += PROVIDER_CONCURRENCY) {
    settled.push(
      ...(await Promise.allSettled(attempts.results.slice(index, index + PROVIDER_CONCURRENCY).map(reconcileAttempt))),
    );
  }
  const checked = settled.filter((result) => result.status === "fulfilled").length;
  const updates = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (updates.length > 0) await env.RECOVERY_DB.batch(updates);
  return { checked, failed: settled.length - checked };
}

/**
 * The transaction that durably consumed an attempt's inputs, once the chain is deep enough to trust.
 *
 * A replacement is deliberately never settled here. Its own depth is unknown — `classifyAttemptEvidence`
 * reports a replacement without a block — and the read path already withholds the inputs of any reported
 * attempt, so nothing is handed back out while the verification sweep resolves it from the chain.
 */
export function settledSpendTxid(txid: string, evidence: AttemptEvidence): string | null {
  const trustworthy = evidence.status === "confirmed" && evidence.confirmations >= RECOVERY_SPEND_CONFIRMATIONS;
  return trustworthy ? txid : null;
}

/**
 * Settle one output an attempt consumed, by primary key. This was a single set-based statement
 * driven by a row-value subquery, and the planner chose the classification index for it — a walk
 * of the entire `recoverable` slice of a gigabyte table per attempt, which blew D1's CPU budget
 * the moment the first large recovery reached settlement depth. The batch rolled back, the queue
 * re-selected the same attempt, and the maintenance lane re-died every two minutes, taking every
 * recovery endpoint down with it. The attempt's input list is at most 420 outpoints and already
 * in hand, so point updates are bounded by construction rather than by the planner's mood.
 * `classification='recoverable'` keeps each one idempotent and never overwrites a richer verdict.
 */
export const RECOVERY_MARK_SPENT_SQL = `
  UPDATE recovery_outputs SET classification='spent',reason=?,spent_by_txid=?,spent_height=?,chain_checked_at=?
   WHERE txid=? AND vout=? AND classification='recoverable'`;

/**
 * An attempt is the one place that knows, for free and for certain, which tracked outputs a recovery
 * consumed. Writing that through to recovery_outputs is what keeps a completed recovery from being
 * offered back to the owner on their next page load.
 */
export function recoveryAttemptStatements(
  db: D1Database,
  txid: string,
  evidence: AttemptEvidence,
  now: number,
  inputs: readonly { input_txid: string; input_vout: number }[],
): D1PreparedStatement[] {
  const spentBy = settledSpendTxid(txid, evidence);
  const statements = [recoveryAttemptUpdate(db, txid, evidence, now, spentBy !== null)];
  if (!spentBy) return statements;
  const marker = db.prepare(RECOVERY_MARK_SPENT_SQL);
  for (const input of inputs) {
    statements.push(
      marker.bind(
        "spent-by-confirmed-recovery",
        spentBy,
        evidence.blockHeight,
        now,
        input.input_txid,
        input.input_vout,
      ),
    );
  }
  return statements;
}

/**
 * Abandonment is terminal alongside settlement: there is no transaction left to watch and no spend to
 * write, so leaving it queued would re-check a dead attempt every two minutes for the life of the
 * database. If the owner ever does broadcast that signed transaction, the verification sweep still
 * settles its outputs from the chain — reader-triggered on the page they load, monthly otherwise.
 */
function recoveryAttemptUpdate(db: D1Database, txid: string, evidence: AttemptEvidence, now: number, settled: boolean) {
  return db
    .prepare(
      `UPDATE recovery_attempts SET status=?,replacement_txid=?,block_height=?,block_hash=?,block_time=?,
        confirmations=?,settlement_pending=?,inputs_released=?,status_reason=?,chain_checked_at=?,updated_at=?
       WHERE txid=?`,
    )
    .bind(
      evidence.status,
      evidence.replacementTxid,
      evidence.blockHeight,
      evidence.blockHash,
      evidence.blockTime,
      evidence.confirmations,
      settled || evidence.releasesInputs ? 0 : 1,
      evidence.releasesInputs ? 1 : 0,
      evidence.reason,
      now,
      now,
      txid,
    );
}
