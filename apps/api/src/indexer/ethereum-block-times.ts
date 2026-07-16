/** Authoritative Ethereum timestamps for Emblem sales. Bounded, resumable, and replay-safe. */
import type { Env } from "#api/env";
import { fetchEthereumBlockTimes } from "#api/integrations/alchemy-rpc";

const BLOCKS_PER_RUN = 500;
// Alchemy's JSON-RPC batch limit is lower than the NFT page size; stay at its accepted ceiling.
const RPC_BATCH = 100;
const D1_BATCH = 100;

export async function backfillEthereumBlockTimes(env: Env): Promise<Record<string, unknown>> {
  if (!env.ALCHEMY_KEY) return { skipped: "no ALCHEMY_KEY" };
  const rows = await env.CORE_DB.prepare(
    `SELECT DISTINCT sale.block_number
       FROM emblem_sales sale LEFT JOIN ethereum_blocks block
         ON block.block_number=sale.block_number
      WHERE sale.block_number IS NOT NULL AND block.block_number IS NULL
      ORDER BY sale.block_number LIMIT ?`,
  )
    .bind(BLOCKS_PER_RUN)
    .all<{ block_number: number }>();
  const blockNumbers = rows.results.map((row) => row.block_number);
  if (blockNumbers.length === 0) return { requested: 0, stored: 0, done: true };

  let stored = 0;
  // Persist each successful provider page immediately. A later rate limit can then retry only the unfinished
  // suffix on the next cron instead of discarding several hundred authoritative responses.
  for (let index = 0; index < blockNumbers.length; index += RPC_BATCH) {
    const times = await fetchEthereumBlockTimes(env.ALCHEMY_KEY, blockNumbers.slice(index, index + RPC_BATCH));
    for (let writeIndex = 0; writeIndex < times.length; writeIndex += D1_BATCH)
      await env.CORE_DB.batch(
        times.slice(writeIndex, writeIndex + D1_BATCH).map((block) =>
          env.CORE_DB.prepare(
            `INSERT INTO ethereum_blocks(block_number,block_time) VALUES(?,?)
           ON CONFLICT(block_number) DO UPDATE SET block_time=excluded.block_time
           WHERE ethereum_blocks.block_time IS NOT excluded.block_time`,
          ).bind(block.blockNumber, block.blockTime),
        ),
      );
    stored += times.length;
  }
  return {
    requested: blockNumbers.length,
    stored,
    first: blockNumbers[0],
    last: blockNumbers.at(-1),
    done: blockNumbers.length < BLOCKS_PER_RUN,
  };
}
