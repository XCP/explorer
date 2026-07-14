import type { Env } from "#api/env";
import { getCoreState, setCoreStateStatement } from "#api/indexer/core-state";

const STATE_GENERATION = "exchange_top_assets_generation";
const STATE_REFRESH_BLOCK = "exchange_top_assets_refreshed_block";
const REFRESH_BLOCK_INTERVAL = 144;

export const BUILD_EXCHANGE_TOP_ASSETS_SQL = `
  INSERT INTO exchange_top_assets (generation, asset_id, depositors)
  SELECT ?, ranked.asset_id, ranked.depositors
  FROM (
    SELECT s.asset_id, COUNT(DISTINCT s.source_address_id) AS depositors
    FROM sends s
    JOIN address_signals e ON e.address_id=s.destination_address_id AND e.is_exchange=1
    WHERE s.asset_id IS NOT NULL AND s.source_address_id IS NOT NULL
    GROUP BY s.asset_id
    ORDER BY depositors DESC, s.asset_id ASC
    LIMIT 15
  ) ranked
  WHERE 1
  ON CONFLICT(generation, asset_id) DO UPDATE SET
    depositors=excluded.depositors`;

export interface ExchangeTopAssetsRefresh {
  refreshed: boolean;
  generation: number;
  rows: number;
  block: number;
}

/** Build a complete staging generation, then atomically publish it. Safe to replay. */
export async function refreshExchangeTopAssets(env: Env): Promise<ExchangeTopAssetsRefresh> {
  const [generationRow, tipRow] = await Promise.all([
    getCoreState(env.CORE_DB, STATE_GENERATION),
    env.CORE_DB.prepare(`SELECT MAX(block_index) AS block FROM blocks`).first<{ block: number | null }>(),
  ]);
  const generation = (Number.parseInt(generationRow ?? "0", 10) || 0) + 1;
  const block = Number(tipRow?.block) || 0;

  const results = await env.CORE_DB.batch([
    env.CORE_DB.prepare(BUILD_EXCHANGE_TOP_ASSETS_SQL).bind(generation),
    setCoreStateStatement(env.CORE_DB, STATE_GENERATION, generation),
    setCoreStateStatement(env.CORE_DB, STATE_REFRESH_BLOCK, block),
    // Retain one prior generation for diagnosis while bounding the table to at most 30 rows.
    env.CORE_DB.prepare(`DELETE FROM exchange_top_assets WHERE generation < ?`).bind(generation - 1),
  ]);
  return { refreshed: true, generation, rows: results[0]?.meta.changes ?? 0, block };
}

/** Daily, block-gated maintenance. A forced admin refresh uses refreshExchangeTopAssets directly. */
export async function maybeRefreshExchangeTopAssets(
  env: Env,
): Promise<ExchangeTopAssetsRefresh | { refreshed: false; block: number }> {
  const [tipRow, lastRow] = await Promise.all([
    env.CORE_DB.prepare(`SELECT MAX(block_index) AS block FROM blocks`).first<{ block: number | null }>(),
    getCoreState(env.CORE_DB, STATE_REFRESH_BLOCK),
  ]);
  const block = Number(tipRow?.block) || 0;
  const last = Number.parseInt(lastRow ?? "0", 10) || 0;
  if (last > 0 && block - last < REFRESH_BLOCK_INTERVAL) return { refreshed: false, block };
  return refreshExchangeTopAssets(env);
}
