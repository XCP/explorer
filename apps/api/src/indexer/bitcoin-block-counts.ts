import type { Env } from "#api/env";
import { fetchBlockPage, type ElectrsBlockSummary } from "#api/integrations/electrs";
import { getCoreState, getCoreStateInt, setCoreState } from "#api/indexer/core-state";

// One Electrs page covers ten consecutive blocks. At one request at a time with a 100 ms inter-page delay,
// 100 pages remains a gentle provider load (~10 seconds/tick) while halving the historical catch-up window.
const PAGES_PER_STEP = 100;
const PAGE_CONCURRENCY = 1;
const PAGE_DELAY_MS = 100;
const CURSOR_KEY = "bitcoin_block_counts_cursor";
const REMAINING_KEY = "bitcoin_block_counts_remaining";
const FRONTIER_KEY = "bitcoin_block_counts_frontier";

/** Backfill newest-first in ten-block Esplora pages. A durable descending cursor avoids scanning the
 * blocks table for the same missing-row COUNT/MAX on every cron tick. The cursor advances only when every
 * requested page succeeds, so a transient provider failure cannot leave a historical hole behind it. */
export async function backfillBitcoinBlockCounts(
  env: Pick<Env, "CORE_DB" | "ELECTRS_API_BASE">,
  pages = PAGES_PER_STEP,
): Promise<{ blocks: number; remaining: number; next_height: number | null }> {
  const savedCursor = await getCoreState(env.CORE_DB, CURSOR_KEY);
  let remaining = await getCoreStateInt(env.CORE_DB, REMAINING_KEY);
  let nextHeight: number | null;
  if (savedCursor == null) {
    // One discovery scan initializes progress for an existing database. Subsequent ticks are O(1).
    const missing = await env.CORE_DB.prepare(
      `SELECT MAX(block_index) next_height,COUNT(*) remaining FROM blocks WHERE bitcoin_transaction_count IS NULL`,
    ).first<{ next_height: number | null; remaining: number }>();
    nextHeight = missing?.next_height == null ? null : Number(missing.next_height);
    remaining = Number(missing?.remaining ?? 0);
    await setCoreState(env.CORE_DB, REMAINING_KEY, remaining);
    if (nextHeight != null) {
      await setCoreState(env.CORE_DB, CURSOR_KEY, nextHeight);
      await setCoreState(env.CORE_DB, FRONTIER_KEY, nextHeight);
    }
  } else {
    nextHeight = Number.parseInt(savedCursor, 10);
  }
  if (nextHeight == null) return { blocks: 0, remaining: 0, next_height: null };

  const firstHeight = Number(
    (await env.CORE_DB.prepare(`SELECT MIN(block_index) height FROM blocks`).first<{ height: number }>())?.height ?? 0,
  );
  let maintenanceFrontier: number | null = null;
  if (nextHeight < firstHeight) {
    // The historical sweep is complete. Inspect only the newly ingested primary-key range, never the full table.
    maintenanceFrontier = await getCoreStateInt(env.CORE_DB, FRONTIER_KEY, firstHeight - 1);
    const newest = await env.CORE_DB.prepare(
      `SELECT MAX(block_index) height FROM blocks
       WHERE block_index>? AND bitcoin_transaction_count IS NULL`,
    )
      .bind(maintenanceFrontier)
      .first<{ height: number | null }>();
    if (newest?.height == null) {
      const tip = Number(
        (await env.CORE_DB.prepare(`SELECT MAX(block_index) height FROM blocks`).first<{ height: number }>())?.height ??
          maintenanceFrontier,
      );
      await setCoreState(env.CORE_DB, FRONTIER_KEY, tip);
      return { blocks: 0, remaining: 0, next_height: null };
    }
    nextHeight = Number(newest.height);
    remaining = Math.max(remaining, 1);
  }

  const starts = Array.from({ length: pages }, (_, index) => nextHeight - index * 10).filter(
    (height) => height >= firstHeight && (maintenanceFrontier == null || height > maintenanceFrontier),
  );
  const settled: PromiseSettledResult<ElectrsBlockSummary[]>[] = [];
  for (let offset = 0; offset < starts.length; offset += PAGE_CONCURRENCY) {
    settled.push(
      ...(await Promise.allSettled(
        starts.slice(offset, offset + PAGE_CONCURRENCY).map((height) => fetchBlockPage(env.ELECTRS_API_BASE, height)),
      )),
    );
    if (offset + PAGE_CONCURRENCY < starts.length) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  }
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
  remaining = Math.max(0, remaining - changed);
  await setCoreState(env.CORE_DB, REMAINING_KEY, remaining);
  const completedPrefix = settled.findIndex((result) => result.status === "rejected");
  const completedPages = completedPrefix === -1 ? settled.length : completedPrefix;
  if (maintenanceFrontier == null && completedPages > 0) {
    await setCoreState(env.CORE_DB, CURSOR_KEY, starts[completedPages - 1]! - 10);
  } else if (maintenanceFrontier != null && completedPages === settled.length) {
    await setCoreState(env.CORE_DB, FRONTIER_KEY, nextHeight);
  }
  return {
    blocks: changed,
    remaining,
    next_height: nextHeight,
  };
}
