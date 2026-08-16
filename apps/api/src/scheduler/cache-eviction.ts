/**
 * Bounded eviction for the D1 response cache.
 *
 * The `cache` table (read/respond.ts) had nothing deleting from it, so every
 * key ever written stayed forever: measured at 1,515 rows / 12.28 MB with
 * 1,327 of them (87.6%) already expired. Small today, but it only grows, and
 * every `SELECT body FROM cache WHERE key=?` pays to read whatever body it
 * finds.
 *
 * Two constraints shape this, and both are easy to get wrong:
 *
 * 1. A DELETE bills every row it TOUCHES, the same as any other statement. An
 *    unbounded `DELETE FROM cache WHERE expires_at < ?` is exactly the sweep
 *    shape this repo's CLAUDE.md exists to prevent. So it is capped per run,
 *    oldest first, and converges over successive maintenance ticks instead of
 *    clearing the backlog in one go. Once caught up it deletes nothing.
 *
 * 2. Expiry is NOT the end of a row's usefulness. `cached()` serves a stale
 *    body for `swr` seconds past `expires_at` (swr defaults to ttl, and the
 *    longest ttl in use is 86,400 — so up to two days), and `staleKey` reads a
 *    PRIOR VERSION's row with no expiry check at all, specifically so a version
 *    bump never opens a cold window. Deleting on `expires_at < now` would take
 *    those fallbacks out from under both paths.
 *
 * Hence the grace period rather than a plain expiry test. Seven days is a
 * 3.5x margin over the longest ttl+swr, and still reclaims the bulk: of the
 * 12.28 MB, 7.79 MB sits in rows expired more than a week (the `years:index:v1`
 * through `v9` chains and stale per-entity keys — the big bodies are the old
 * ones).
 *
 * No index on `expires_at` on purpose. The table is ~1.5k rows, so the scan is
 * trivial, while an index would tax every cache write — and this table is
 * written on every miss and every background refresh.
 */

/** 3.5x the longest ttl+swr in use. See the note above before lowering it. */
const GRACE_SECONDS = 7 * 24 * 60 * 60;

/** Rows per run. Converges across ticks; keeps any single statement small. */
const EVICT_LIMIT = 200;

export async function evictExpiredCache(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown>> {
  const cutoff = now - GRACE_SECONDS;
  const result = await db
    .prepare(
      `DELETE FROM cache WHERE key IN (
         SELECT key FROM cache WHERE expires_at < ?1 ORDER BY expires_at LIMIT ?2
       )`,
    )
    .bind(cutoff, EVICT_LIMIT)
    .run();

  const evicted = result.meta.rows_written ?? 0;
  return { evicted, cutoff, done: evicted < EVICT_LIMIT };
}
