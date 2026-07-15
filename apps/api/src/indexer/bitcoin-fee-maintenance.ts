import type { Env } from "#api/env";
import { fetchTransactionFee } from "#api/integrations/electrs";
import { hashToBytes } from "#api/indexer/identities";

interface MissingFee {
  tx_index: number;
  tx_hash: string;
}

export async function reconcileBitcoinFees(
  env: Pick<Env, "CORE_DB" | "ELECTRS_API_BASE">,
  limit = 100,
): Promise<{ requested: number; updated: number }> {
  const missing = await env.CORE_DB.prepare(
    `SELECT tx_index,LOWER(HEX(tx_hash)) tx_hash FROM transactions
     WHERE fee IS NULL ORDER BY tx_index DESC LIMIT ?`,
  )
    .bind(limit)
    .all<MissingFee>();
  if (missing.results.length === 0) return { requested: 0, updated: 0 };

  const settled = await Promise.allSettled(
    missing.results.map(async (row) => ({ row, fee: await fetchTransactionFee(env.ELECTRS_API_BASE, row.tx_hash) })),
  );
  const statements = settled.flatMap((result) => {
    if (result.status === "rejected" || result.value.fee === null) return [];
    return [
      env.CORE_DB.prepare(`UPDATE transactions SET fee=? WHERE tx_hash=? AND fee IS NULL`).bind(
        String(result.value.fee),
        hashToBytes(result.value.row.tx_hash),
      ),
    ];
  });
  const results = statements.length > 0 ? await env.CORE_DB.batch(statements) : [];
  return {
    requested: missing.results.length,
    updated: results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0),
  };
}
