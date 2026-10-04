/** Exact, bounded before-images. A batch's context and writes commit together;
 * concurrent readers/writers never observe an active journal context. */
export async function initializeUndo(db: D1Database, height: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO reorg_undo_state(singleton,floor) VALUES(1,?)").bind(height).run();
}

export async function pruneUndo(db: D1Database, height: number): Promise<void> {
  const floor = Math.max(0, height - 24);
  await db.batch([
    db.prepare("DELETE FROM reorg_undo WHERE block_index<=?").bind(floor),
    db.prepare("UPDATE reorg_undo_state SET floor=max(floor,?) WHERE singleton=1").bind(floor),
  ]);
}

export async function writeWithUndo(
  db: D1Database,
  writes: { statement: D1PreparedStatement; block?: number }[],
): Promise<void> {
  // At most two statements per write plus context cleanup, below D1's batch bound.
  for (let offset = 0; offset < writes.length; offset += 40) {
    const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM reorg_undo_context")];
    let active: number | undefined;
    for (const write of writes.slice(offset, offset + 40)) {
      if (write.block !== active) {
        statements.push(
          write.block === undefined
            ? db.prepare("DELETE FROM reorg_undo_context")
            : db
                .prepare(
                  "INSERT INTO reorg_undo_context(singleton,block_index) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET block_index=excluded.block_index",
                )
                .bind(write.block),
        );
        active = write.block;
      }
      statements.push(write.statement);
    }
    statements.push(db.prepare("DELETE FROM reorg_undo_context"));
    await db.batch(statements);
  }
}

const TABLES = new Set([
  "assets",
  "orders",
  "order_matches",
  "dispensers",
  "fairminters",
  "pools",
  "bets",
  "bet_matches",
  "rps",
  "rps_matches",
]);
interface Column {
  name: string;
  type: string;
  pk: number;
}
interface Undo {
  seq: number;
  table_name: string;
  row_key: string;
  before_row: string | null;
}
type StoredRow = Record<string, string | number | null>;

/** The sync entry point initializes the floor before checking for reorgs,
 * so pre-deployment history fails closed.
 * Each inverse and deletion of its journal row share one transaction, making
 * interrupted rollback resumable without double undo. */
export async function restoreUndo(db: D1Database, height: number): Promise<boolean> {
  const state = await db.prepare("SELECT floor FROM reorg_undo_state WHERE singleton=1").first<{ floor: number }>();
  if (!state) throw new Error("Undo history is not initialized; rebuild required");
  if (height < state.floor) throw new Error("Reorg predates exact undo history; rebuild required");
  const schemas = new Map<string, Column[]>();
  for (;;) {
    const rows = await db
      .prepare(
        "SELECT seq,table_name,row_key,before_row FROM reorg_undo WHERE block_index>? ORDER BY seq DESC LIMIT 40",
      )
      .bind(height)
      .all<Undo>();
    if (!rows.results.length) return true;
    const statements = [db.prepare("DELETE FROM reorg_undo_context")];
    for (const row of rows.results) {
      if (!TABLES.has(row.table_name)) throw new Error("Unknown undo table");
      let columns = schemas.get(row.table_name);
      if (!columns) {
        columns = (await db.prepare(`PRAGMA table_info(${row.table_name})`).all<Column>()).results;
        schemas.set(row.table_name, columns);
      }
      const keys = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
      const decode = (column: Column, value: string | number | null) => {
        if (column.type.toUpperCase() !== "BLOB" || value === null) return value;
        if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error("Invalid undo blob");
        return Uint8Array.from(value.match(/../g) ?? [], (byte) => parseInt(byte, 16));
      };
      if (row.before_row === null) {
        const key = JSON.parse(row.row_key) as StoredRow;
        statements.push(
          db
            .prepare(
              `DELETE FROM ${row.table_name} WHERE ${keys.map((column) => `"${column.name}" IS ?`).join(" AND ")}`,
            )
            .bind(...keys.map((column) => decode(column, key[column.name]))),
        );
      } else {
        const before = JSON.parse(row.before_row) as StoredRow;
        const retained = columns.filter((column) => Object.hasOwn(before, column.name));
        const names = retained.map((column) => `"${column.name}"`);
        const mutable = retained.filter((column) => !column.pk);
        statements.push(
          db
            .prepare(
              `INSERT INTO ${row.table_name}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})
          ON CONFLICT(${keys.map((column) => `"${column.name}"`).join(",")}) DO UPDATE SET ${mutable.map((column) => `"${column.name}"=excluded."${column.name}"`).join(",")}`,
            )
            .bind(...retained.map((column) => decode(column, before[column.name]))),
        );
      }
      statements.push(db.prepare("DELETE FROM reorg_undo WHERE seq=?").bind(row.seq));
    }
    await db.batch(statements);
  }
}
