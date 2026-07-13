import type { Env } from "#api/env";
import { fetchTransactionOutspends } from "#api/integrations/electrs";

interface RecoveryOutputIdentity {
  txid: string;
  vout: number;
  classification: string;
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

export async function verifyRecoveryTransactions(
  env: Env,
  transactionLimit = 25,
): Promise<{ transactions: number; outputs: number; spent: number }> {
  const limit = Math.min(100, Math.max(1, Math.trunc(transactionLimit)));
  const transactionRows = await env.RECOVERY_DB.prepare(
    `SELECT txid FROM recovery_outputs WHERE chain_checked_at IS NULL
      GROUP BY txid ORDER BY txid LIMIT ?`,
  )
    .bind(limit)
    .all<{ txid: string }>();
  if (transactionRows.results.length === 0) return { transactions: 0, outputs: 0, spent: 0 };

  const identities = (
    await env.RECOVERY_DB.batch(
      transactionRows.results.map((row) =>
        env.RECOVERY_DB.prepare(`SELECT txid,vout,classification FROM recovery_outputs WHERE txid=?`).bind(row.txid),
      ),
    )
  ).flatMap((result) => result.results as unknown as RecoveryOutputIdentity[]);
  const outspendsByTxid = new Map<string, Awaited<ReturnType<typeof fetchTransactionOutspends>>>();
  for (let offset = 0; offset < transactionRows.results.length; offset += 10) {
    const batch = transactionRows.results.slice(offset, offset + 10);
    const results = await Promise.all(batch.map((row) => fetchTransactionOutspends(env.ELECTRS_API_BASE, row.txid)));
    batch.forEach((row, index) => outspendsByTxid.set(row.txid, results[index]));
  }

  const now = Math.floor(Date.now() / 1000);
  let spent = 0;
  const update = env.RECOVERY_DB.prepare(
    `UPDATE recovery_outputs SET classification=?,reason=?,spent_by_txid=?,spent_height=?,chain_checked_at=?
      WHERE txid=? AND vout=?`,
  );
  const updates = identities.map((identity) => {
    const result = outspendsByTxid.get(identity.txid)?.[identity.vout];
    if (!result) throw new Error(`Electrs omitted output ${identity.txid}:${identity.vout}`);
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
  return { transactions: transactionRows.results.length, outputs: identities.length, spent };
}
