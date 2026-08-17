/**
 * Keeps xcp_supply_daily current.
 *
 * The curve is a running credit-minus-debit sum over ledger_events. Deriving
 * it costs ~3.3M rows read, which is fine once a day and was not fine on every
 * cache miss of /v2/price -- that came to 271,717,710 rows/day, 11% of the
 * account, for ~4,600 rows that move once.
 *
 * RECOMPUTE-AND-STORE, not incremental. Supply could be carried forward from
 * the last stored day for a fraction of the cost, and that is exactly the
 * shape that drifts: an arithmetic slip or a reorg leaves a wrong number that
 * nothing detects, because detecting it means recomputing anyway. Running the
 * same aggregate the read path used to run and storing its result cannot
 * disagree with itself.
 *
 * The upsert is delta-guarded. Only the newest day or two actually change
 * between runs; rewriting all ~4,600 rows daily would bill 4,600 writes to
 * change two. `WHERE supply IS NOT excluded.supply` makes the steady state
 * cost only the rows that moved.
 */
import type { Env } from "#api/env";
import { runCoreBlockGated } from "#api/scheduler/core-block-gate";

/** The same aggregate the read path ran, so the stored answer cannot differ. */
const REFRESH_SQL = `
  INSERT INTO xcp_supply_daily (day, supply)
  SELECT day, SUM(delta) OVER (ORDER BY day) / 1e8 AS supply
    FROM (
      SELECT date(block.block_time, 'unixepoch') day,
             SUM(CASE WHEN ledger.direction = 1 THEN CAST(ledger.quantity AS REAL)
                      ELSE -CAST(ledger.quantity AS REAL) END) delta
        FROM ledger_events ledger
        JOIN blocks block ON block.block_index = ledger.block_index
       WHERE ledger.asset_id = (SELECT asset_id FROM asset_dictionary WHERE asset = 'XCP')
       GROUP BY day
    )
   ORDER BY day
  ON CONFLICT(day) DO UPDATE SET supply = excluded.supply
   WHERE xcp_supply_daily.supply IS NOT excluded.supply`;

export async function refreshXcpSupplyDaily(db: D1Database): Promise<Record<string, unknown>> {
  const result = await db.prepare(REFRESH_SQL).run();
  return { rows_written: result.meta.rows_written ?? 0 };
}

/**
 * Daily. The curve only gains a point when the date rolls over, and the last
 * day's value only moves when XCP is burned or destroyed — neither is worth
 * more than one recompute a day. 144 blocks is ~24h.
 */
export const maybeRefreshXcpSupply = (env: Env) =>
  runCoreBlockGated(env.CORE_DB, "xcp_supply_daily_blk", 144, () => refreshXcpSupplyDaily(env.CORE_DB));
