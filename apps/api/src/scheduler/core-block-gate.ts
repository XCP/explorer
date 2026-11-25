import { claimCoreMaintenance, getCoreStateInt, setCoreStateStatement } from "#api/indexer/core-state";

/** A failed attempt keeps its cooldown. Only completed work advances the block checkpoint. */
export async function runCoreBlockGated<T>(
  db: D1Database,
  key: string,
  interval: number,
  job: (tip: number, previous: number) => Promise<T>,
  complete: (result: T) => boolean = () => true,
): Promise<boolean> {
  const tip = Number((await db.prepare("SELECT MAX(block_index) tip FROM blocks").first<{ tip: number }>())?.tip) || 0;
  const previous = await getCoreStateInt(db, key);
  if (tip - previous < interval) return false;
  const retryKey = key + "_retry_after";
  // A one-block price feed can retry hourly. Daily and weekly scans retry a maximum of four times per day.
  const seconds = interval >= 144 ? 21600 : 3600;
  if (!(await claimCoreMaintenance(db, retryKey, Math.floor(Date.now() / 1000), seconds))) return false;
  // Another invocation may have finished between the first read and the claim.
  if ((await getCoreStateInt(db, key)) !== previous) {
    await setCoreStateStatement(db, retryKey, 0).run();
    return false;
  }
  if (!complete(await job(tip, previous))) return false;
  await db.batch([setCoreStateStatement(db, key, tip), setCoreStateStatement(db, retryKey, 0)]);
  return true;
}
