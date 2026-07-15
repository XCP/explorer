import type { Env } from "#api/env";
import { fetchBlockPage } from "#api/integrations/electrs";

const PAGES_PER_STEP = 50;

/** Backfill newest-first in ten-block Esplora pages. Re-querying the highest missing height makes the
 * operation resumable without a second cursor or delete/replace bookkeeping. */
export async function backfillBitcoinBlockCounts(
  env: Pick<Env, "CORE_DB" | "ELECTRS_API_BASE">,
  pages = PAGES_PER_STEP,
): Promise<{ blocks: number; remaining: number; next_height: number | null }> {
  const missing = await env.CORE_DB.prepare(
    `SELECT MAX(block_index) next_height,COUNT(*) remaining FROM blocks WHERE bitcoin_transaction_count IS NULL`,
  ).first<{ next_height: number | null; remaining: number }>();
  const nextHeight = missing?.next_height == null ? null : Number(missing.next_height);
  if (nextHeight == null) return { blocks: 0, remaining: 0, next_height: null };

  const starts = Array.from({ length: pages }, (_, index) => nextHeight - index * 10).filter((height) => height >= 0);
  const settled = await Promise.allSettled(starts.map((height) => fetchBlockPage(env.ELECTRS_API_BASE, height)));
  const rows = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  let changed = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows
      .slice(index, index + 100)
      .map((row) =>
        env.CORE_DB.prepare(
          `UPDATE blocks SET bitcoin_transaction_count=? WHERE block_index=? AND bitcoin_transaction_count IS NULL`,
        ).bind(row.transactionCount, row.height),
      );
    const results = await env.CORE_DB.batch(batch);
    changed += results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  }
  return {
    blocks: changed,
    remaining: Math.max(0, Number(missing?.remaining ?? 0) - changed),
    next_height: nextHeight,
  };
}
