const LEASE_KEY = "canonical_maintenance_lease_until";

/** Run at most one canonical maintenance chain at a time. The expiring lease self-recovers after eviction. */
export async function withCanonicalMaintenanceLease(
  db: D1Database,
  run: () => Promise<void>,
  ttlSeconds = 5 * 60,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  const claim = await db
    .prepare(
      `INSERT INTO core_state(key,value) VALUES(?1,?2)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value
       WHERE CAST(core_state.value AS INTEGER)<?3`,
    )
    .bind(LEASE_KEY, String(expiresAt), now)
    .run();
  if (Number(claim.meta?.changes ?? claim.meta?.rows_written ?? 0) !== 1) return false;
  try {
    await run();
    return true;
  } finally {
    // A delayed invocation must never release a newer owner's lease.
    await db.prepare(`DELETE FROM core_state WHERE key=? AND value=?`).bind(LEASE_KEY, String(expiresAt)).run();
  }
}
