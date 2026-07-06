/**
 * Read/write helpers for the `curated` table (migration 0022) — the human-maintained allow/deny/label
 * lists. The signal passes read the table via the `…_SQL` subquery fragments in indexer/curated.ts;
 * these helpers cover the read handlers (exchange-name labelling) and the /admin/curated CRUD.
 */
import { q } from "../db";

export interface CuratedRow { kind: string; key: string; value: string | null; note: string | null }

/** Operator-name map for the exchange wallets: { addr → label }. One query per /v2/exchanges request. */
export async function exchangeNames(db: D1Database): Promise<Record<string, string>> {
  const rows = await q<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM curated WHERE kind='exchange_name' AND value IS NOT NULL`
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** All curated keys of one kind (admin listing). */
export function curatedList(db: D1Database, kind: string): Promise<CuratedRow[]> {
  return q<CuratedRow>(db, `SELECT kind, key, value, note FROM curated WHERE kind=? ORDER BY key`, kind);
}

/** Upsert one curated row (admin). Overwrites value/note on conflict. */
export function curatedUpsert(
  db: D1Database,
  row: { kind: string; key: string; value?: string | null; note?: string | null }
): Promise<D1Result> {
  return db
    .prepare(
      `INSERT INTO curated (kind, key, value, note) VALUES (?,?,?,?)
       ON CONFLICT(kind, key) DO UPDATE SET value=excluded.value, note=excluded.note`
    )
    .bind(row.kind, row.key, row.value ?? null, row.note ?? null)
    .run();
}

/** Delete one curated row (admin). */
export function curatedDelete(db: D1Database, kind: string, key: string): Promise<D1Result> {
  return db.prepare(`DELETE FROM curated WHERE kind=? AND key=?`).bind(kind, key).run();
}
