import { getCoreStateInt } from "#api/indexer/core-state";
import { coreQualityNetworkStats } from "#api/queries/core-stats";
import { networkStatsCacheKey } from "#api/http/cache-keys";

const REFRESH_INTERVAL_SECONDS = 6 * 60 * 60;
const CACHE_LIFETIME_SECONDS = 12 * 60 * 60;

export const qualityStatsRefreshDue = (now: number, updatedAt: number): boolean =>
  updatedAt <= 0 || now - updatedAt >= REFRESH_INTERVAL_SECONDS;

/** Refresh the expensive quality-filtered lifetime row before readers can encounter a cold cache. */
export async function refreshQualityNetworkStats(db: D1Database): Promise<{ refreshed: true; updatedAt: number }> {
  const result = await coreQualityNetworkStats(db);
  const updatedAt = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare(
        `INSERT INTO cache(key,body,ctype,expires_at,refreshing_until)
         VALUES(?1,?2,'application/json',?3,0)
         ON CONFLICT(key) DO UPDATE SET body=excluded.body,ctype=excluded.ctype,
           expires_at=excluded.expires_at,refreshing_until=0`,
      )
      .bind(networkStatsCacheKey(false), JSON.stringify({ result }), updatedAt + CACHE_LIFETIME_SECONDS),
    db
      .prepare(
        `INSERT INTO core_state(key,value) VALUES('quality_stats_refreshed_at',?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .bind(String(updatedAt)),
  ]);
  return { refreshed: true, updatedAt };
}

export async function maybeRefreshQualityNetworkStats(
  db: D1Database,
): Promise<{ refreshed: false; updatedAt: number } | { refreshed: true; updatedAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const updatedAt = await getCoreStateInt(db, "quality_stats_refreshed_at");
  if (!qualityStatsRefreshDue(now, updatedAt)) return { refreshed: false, updatedAt };
  return refreshQualityNetworkStats(db);
}
