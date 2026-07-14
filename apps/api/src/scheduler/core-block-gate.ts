import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

/** Run a compact maintenance job once per block interval and advance state only after success. */
export async function runCoreBlockGated(
  db: D1Database,
  key: string,
  interval: number,
  job: () => Promise<unknown>,
): Promise<boolean> {
  const tip = Number((await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
  if (tip - (await getCoreStateInt(db, key)) < interval) return false;
  await job();
  await setCoreState(db, key, tip);
  return true;
}
