/** Invalidate every global read derived from collection membership after a successful projection run. */
export function invalidateCollectionReads(db: D1Database): Promise<D1Result> {
  return db
    .prepare(`DELETE FROM cache WHERE key IN ('tags:all','collections:profiles:v3','collection-candidates:core:2')`)
    .run();
}
