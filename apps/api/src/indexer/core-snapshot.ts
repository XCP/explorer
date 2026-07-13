import type { Env } from "#api/env";
import { CORE_SNAPSHOT_TABLES } from "#api/indexer/core-manifest";

const SNAPSHOT_TABLES = new Set<string>(CORE_SNAPSHOT_TABLES);

interface SchemaRow {
  name: string;
  sql: string;
}

interface SnapshotRow extends Record<string, unknown> {
  _snapshot_rowid?: number;
  _snapshot_high_water?: number;
}

export async function coreSnapshotSchema(db: D1Database) {
  const placeholders = CORE_SNAPSHOT_TABLES.map(() => "?").join(",");
  const [schemas, eventState] = await Promise.all([
    db
      .prepare(
        `SELECT name,sql FROM sqlite_schema
          WHERE type='table' AND name IN (${placeholders})
          ORDER BY name`,
      )
      .bind(...CORE_SNAPSHOT_TABLES)
      .all<SchemaRow>(),
    db
      .prepare(
        `SELECT key,value FROM indexer_state
          WHERE key IN ('last_event_index','last_block_index','last_block_hash')`,
      )
      .all<{ key: string; value: string }>(),
  ]);
  return {
    tables: schemas.results,
    source_state: Object.fromEntries(eventState.results.map((row) => [row.key, row.value])),
  };
}

export async function coreSnapshotPage(db: D1Database, table: string, after: number, rows: number) {
  if (!SNAPSHOT_TABLES.has(table)) throw new Error(`unsupported snapshot table: ${table}`);
  if (table === "exchange_top_assets") {
    const result = await db
      .prepare(`SELECT * FROM exchange_top_assets ORDER BY generation,asset LIMIT ? OFFSET ?`)
      .bind(rows, after)
      .all<SnapshotRow>();
    return {
      table,
      rows: result.results,
      cursor: after + result.results.length,
      high_water: after + result.results.length,
      caught_up: result.results.length < rows,
    };
  }
  const result = await db
    .prepare(
      `SELECT rowid AS _snapshot_rowid,(SELECT max(rowid) FROM ${table}) AS _snapshot_high_water,*
         FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`,
    )
    .bind(after, rows)
    .all<SnapshotRow>();
  const cursor = Number(result.results.at(-1)?._snapshot_rowid ?? after);
  const highWater = Number(result.results.at(0)?._snapshot_high_water ?? cursor);
  return { table, rows: result.results, cursor, high_water: highWater, caught_up: cursor >= highWater };
}
