/**
 * Typed D1 helpers — the one place query results acquire a type. Row/DTO shapes live in
 * @xcp/shared (wire contract) or next to the query that owns them; handlers should never
 * see an untyped `any` result again.
 */
export const q = <T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> =>
  db
    .prepare(sql)
    .bind(...binds)
    .all<T>()
    .then((r) => r.results);

export const one = <T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> =>
  db
    .prepare(sql)
    .bind(...binds)
    .first<T>();

export async function retryOverloadedRead<T>(query: () => Promise<T>): Promise<T> {
  // Large aggregates can fill a D1 resource window. Retry only the rejected read after that window.
  for (let attempt = 0; ; attempt++) {
    try {
      return await query();
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Error) || !error.message.includes("overloaded")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 11000));
    }
  }
}
