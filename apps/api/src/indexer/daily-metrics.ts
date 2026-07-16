/**
 * Repair the recent Counterparty transaction chart from canonical blocks.
 *
 * Triggers keep daily_metrics current during ordinary writes, but a migration,
 * reorg, or interrupted replay can leave a derived bucket out of sync. The
 * block-index window is bounded and indexed; its earliest partial UTC day is
 * deliberately discarded before the remaining complete days are upserted.
 */
export async function reconcileRecentDailyTransactions(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `WITH recent AS MATERIALIZED (
         SELECT block_time/86400 day,transaction_count
         FROM blocks
         WHERE block_index>(SELECT MAX(block_index)-1000 FROM blocks) AND block_time>0
       ), repaired AS (
         SELECT day,SUM(transaction_count) transactions
         FROM recent WHERE day>(SELECT MIN(day) FROM recent) GROUP BY day
       )
       INSERT INTO daily_metrics(day,transactions)
       SELECT day,transactions FROM repaired WHERE 1
       ON CONFLICT(day) DO UPDATE SET transactions=excluded.transactions
       WHERE daily_metrics.transactions IS NOT excluded.transactions`,
    )
    .run();
  return Number(result.meta.rows_written ?? 0);
}
