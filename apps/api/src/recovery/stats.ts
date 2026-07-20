import type { Env } from "#api/env";

const DAY = 86_400;

export async function refreshRecoveryStats(env: Env, force = false): Promise<{ refreshed: boolean }> {
  const current = await env.RECOVERY_DB.prepare(
    `SELECT updated_at FROM recovery_stats_snapshot WHERE singleton=1`,
  ).first<{ updated_at: number }>();
  const now = Math.floor(Date.now() / 1000);
  if (!force && current && now - current.updated_at < DAY) return { refreshed: false };

  const stamp = `EXISTS (SELECT 1 FROM recovery_protected_transactions p
    WHERE p.txid=recovery_outputs.txid AND p.protection_kind='stamp')`;
  const [summary, months, addresses, spentHeights] = await Promise.all([
    env.RECOVERY_DB.prepare(
      `SELECT COUNT(*) recoverable_outputs,COALESCE(SUM(value_sats),0) recoverable_sats,
        SUM(CASE WHEN ${stamp} THEN 1 ELSE 0 END) protected_stamp_outputs,
        COALESCE(SUM(CASE WHEN ${stamp} THEN value_sats ELSE 0 END),0) protected_stamp_sats,
        SUM(CASE WHEN NOT ${stamp} THEN 1 ELSE 0 END) unprotected_outputs,
        COALESCE(SUM(CASE WHEN NOT ${stamp} THEN value_sats ELSE 0 END),0) unprotected_sats,
        COUNT(DISTINCT recovery_address) recovery_addresses
       FROM recovery_outputs WHERE classification='recoverable'`,
    ).first<Record<string, number>>(),
    env.RECOVERY_DB.prepare(
      `SELECT CAST(strftime('%s',block_time,'unixepoch','start of month') AS INTEGER) month,
        SUM(CASE WHEN NOT ${stamp} THEN 1 ELSE 0 END) unprotected_outputs,
        COALESCE(SUM(CASE WHEN NOT ${stamp} THEN value_sats ELSE 0 END),0) unprotected_sats,
        SUM(CASE WHEN ${stamp} THEN 1 ELSE 0 END) protected_stamp_outputs,
        COALESCE(SUM(CASE WHEN ${stamp} THEN value_sats ELSE 0 END),0) protected_stamp_sats
       FROM recovery_outputs WHERE classification='recoverable' AND block_time IS NOT NULL GROUP BY month ORDER BY month`,
    ).all<Record<string, number>>(),
    env.RECOVERY_DB.prepare(
      `SELECT recovery_address address,
        SUM(CASE WHEN NOT ${stamp} THEN 1 ELSE 0 END) unprotected_outputs,
        COALESCE(SUM(CASE WHEN NOT ${stamp} THEN value_sats ELSE 0 END),0) unprotected_sats,
        SUM(CASE WHEN ${stamp} THEN 1 ELSE 0 END) protected_stamp_outputs,
        COALESCE(SUM(CASE WHEN ${stamp} THEN value_sats ELSE 0 END),0) protected_stamp_sats
       FROM recovery_outputs WHERE classification='recoverable' AND recovery_address IS NOT NULL
       GROUP BY recovery_address ORDER BY unprotected_sats DESC LIMIT 100`,
    ).all<Record<string, number | string>>(),
    env.RECOVERY_DB.prepare(
      `SELECT spent_height,COUNT(*) outputs,COUNT(DISTINCT spent_by_txid) spending_transactions,
              COALESCE(SUM(value_sats),0) gross_sats
         FROM recovery_outputs WHERE classification='spent' AND spent_height IS NOT NULL
        GROUP BY spent_height ORDER BY spent_height`,
    ).all<{ spent_height: number; outputs: number; spending_transactions: number; gross_sats: number }>(),
  ]);
  if (!summary) throw new Error("recovery summary query returned no row");

  const blockTimes = new Map<number, number>();
  for (let offset = 0; offset < spentHeights.results.length; offset += 100) {
    const results = await env.CORE_DB.batch(
      spentHeights.results
        .slice(offset, offset + 100)
        .map((row) =>
          env.CORE_DB.prepare(`SELECT block_index,block_time FROM blocks WHERE block_index=?`).bind(row.spent_height),
        ),
    );
    for (const result of results) {
      const row = result.results[0] as { block_index?: number; block_time?: number | null } | undefined;
      if (row?.block_index != null && row.block_time != null)
        blockTimes.set(Number(row.block_index), Number(row.block_time));
    }
  }
  const recovered = new Map<number, { outputs: number; spending_transactions: number; gross_sats: number }>();
  for (const row of spentHeights.results) {
    const blockTime = blockTimes.get(row.spent_height);
    if (blockTime == null) continue;
    const date = new Date(blockTime * 1_000);
    const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1_000;
    const value = recovered.get(month) ?? { outputs: 0, spending_transactions: 0, gross_sats: 0 };
    value.outputs += Number(row.outputs);
    value.spending_transactions += Number(row.spending_transactions);
    value.gross_sats += Number(row.gross_sats);
    recovered.set(month, value);
  }

  const statements: D1PreparedStatement[] = [
    env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_stats_snapshot VALUES (1,?,?,?,?,?,?,?,?)
       ON CONFLICT(singleton) DO UPDATE SET recoverable_outputs=excluded.recoverable_outputs,
       recoverable_sats=excluded.recoverable_sats,protected_stamp_outputs=excluded.protected_stamp_outputs,
       protected_stamp_sats=excluded.protected_stamp_sats,unprotected_outputs=excluded.unprotected_outputs,
       unprotected_sats=excluded.unprotected_sats,recovery_addresses=excluded.recovery_addresses,updated_at=excluded.updated_at`,
    ).bind(
      summary.recoverable_outputs,
      summary.recoverable_sats,
      summary.protected_stamp_outputs,
      summary.protected_stamp_sats,
      summary.unprotected_outputs,
      summary.unprotected_sats,
      summary.recovery_addresses,
      now,
    ),
    ...months.results.map((row) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_monthly_stats VALUES (?,?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET
       unprotected_outputs=excluded.unprotected_outputs,unprotected_sats=excluded.unprotected_sats,
       protected_stamp_outputs=excluded.protected_stamp_outputs,protected_stamp_sats=excluded.protected_stamp_sats,
       updated_at=excluded.updated_at`,
      ).bind(
        row.month,
        row.unprotected_outputs,
        row.unprotected_sats,
        row.protected_stamp_outputs,
        row.protected_stamp_sats,
        now,
      ),
    ),
    ...addresses.results.map((row) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_address_stats VALUES (?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET
       unprotected_outputs=excluded.unprotected_outputs,unprotected_sats=excluded.unprotected_sats,
       protected_stamp_outputs=excluded.protected_stamp_outputs,protected_stamp_sats=excluded.protected_stamp_sats,
       updated_at=excluded.updated_at`,
      ).bind(
        row.address,
        row.unprotected_outputs,
        row.unprotected_sats,
        row.protected_stamp_outputs,
        row.protected_stamp_sats,
        now,
      ),
    ),
    ...[...recovered].map(([month, row]) =>
      env.RECOVERY_DB.prepare(
        `INSERT INTO recovery_monthly_recovered VALUES (?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET
       outputs=excluded.outputs,spending_transactions=excluded.spending_transactions,
       gross_sats=excluded.gross_sats,updated_at=excluded.updated_at`,
      ).bind(month, row.outputs, row.spending_transactions, row.gross_sats, now),
    ),
  ];
  for (let offset = 0; offset < statements.length; offset += 100) {
    await env.RECOVERY_DB.batch(statements.slice(offset, offset + 100));
  }
  // Pruning is reconciliation, not replacement: rows touched by this refresh remain stable upserts.
  await env.RECOVERY_DB.batch([
    env.RECOVERY_DB.prepare(`DELETE FROM recovery_monthly_stats WHERE updated_at<?`).bind(now),
    env.RECOVERY_DB.prepare(`DELETE FROM recovery_address_stats WHERE updated_at<?`).bind(now),
    env.RECOVERY_DB.prepare(`DELETE FROM recovery_monthly_recovered WHERE updated_at<?`).bind(now),
  ]);
  return { refreshed: true };
}
