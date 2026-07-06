/**
 * Typed D1 helpers — the one place query results acquire a type. Row/DTO shapes live in
 * @xcp/shared (wire contract) or next to the query that owns them; handlers should never
 * see an untyped `any` result again.
 */
export const q = <T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> =>
  db.prepare(sql).bind(...binds).all<T>().then((r) => r.results);

export const one = <T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> =>
  db.prepare(sql).bind(...binds).first<T>();
