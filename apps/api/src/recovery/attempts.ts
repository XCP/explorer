import type { Env } from "#api/env";
import {
  fetchTipHeight,
  fetchTransactionOutspends,
  fetchTransactionStatus,
  type ElectrsOutspend,
  type ElectrsTransactionStatus,
} from "#api/integrations/electrs";

interface AttemptRow {
  txid: string;
}

interface AttemptInputRow {
  recovery_txid: string;
  input_txid: string;
  input_vout: number;
}

export interface AttemptEvidence {
  status: "pending" | "confirmed" | "replaced" | "failed";
  replacementTxid: string | null;
  blockHeight: number | null;
  blockHash: string | null;
  blockTime: number | null;
  confirmations: number;
  reason: string;
}

export function classifyAttemptEvidence(
  txid: string,
  transaction: ElectrsTransactionStatus | null,
  inputOutspends: ElectrsOutspend[],
  tipHeight: number,
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
    };
  }
  return {
    status: "pending",
    replacementTxid: null,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
    confirmations: 0,
    reason: "transaction-not-seen-inputs-unspent",
  };
}

export async function reconcileRecoveryAttempts(env: Env, limit: number): Promise<{ checked: number }> {
  const attempts = await env.RECOVERY_DB.prepare(
    `SELECT txid FROM recovery_attempts ORDER BY chain_checked_at,reported_at,txid LIMIT ?`,
  )
    .bind(limit)
    .all<AttemptRow>();
  if (attempts.results.length === 0) return { checked: 0 };

  const placeholders = attempts.results.map(() => "?").join(",");
  const inputs = await env.RECOVERY_DB.prepare(
    `SELECT recovery_txid,input_txid,input_vout FROM recovery_attempt_inputs
      WHERE recovery_txid IN (${placeholders}) ORDER BY recovery_txid,input_txid,input_vout`,
  )
    .bind(...attempts.results.map((row) => row.txid))
    .all<AttemptInputRow>();
  const parentTxids = [...new Set(inputs.results.map((row) => row.input_txid))];
  const [tipHeight, statuses, parentOutspends] = await Promise.all([
    fetchTipHeight(env.ELECTRS_API_BASE),
    Promise.all(attempts.results.map((row) => fetchTransactionStatus(env.ELECTRS_API_BASE, row.txid))),
    Promise.all(parentTxids.map((txid) => fetchTransactionOutspends(env.ELECTRS_API_BASE, txid))),
  ]);
  const outspends = new Map(parentTxids.map((txid, index) => [txid, parentOutspends[index]]));
  const now = Math.floor(Date.now() / 1000);
  const updates = attempts.results.map((attempt, index) => {
    const evidence = classifyAttemptEvidence(
      attempt.txid,
      statuses[index],
      inputs.results
        .filter((input) => input.recovery_txid === attempt.txid)
        .map((input) => {
          const output = outspends.get(input.input_txid)?.[input.input_vout];
          if (!output) throw new Error(`Electrs omitted recovery input ${input.input_txid}:${input.input_vout}`);
          return output;
        }),
      tipHeight,
    );
    return env.RECOVERY_DB.prepare(
      `UPDATE recovery_attempts SET status=?,replacement_txid=?,block_height=?,block_hash=?,block_time=?,
          confirmations=?,status_reason=?,chain_checked_at=?,updated_at=? WHERE txid=?`,
    ).bind(
      evidence.status,
      evidence.replacementTxid,
      evidence.blockHeight,
      evidence.blockHash,
      evidence.blockTime,
      evidence.confirmations,
      evidence.reason,
      now,
      now,
      attempt.txid,
    );
  });
  await env.RECOVERY_DB.batch(updates);
  return { checked: attempts.results.length };
}
