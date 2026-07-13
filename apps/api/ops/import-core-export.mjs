import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readSqlStatements } from "./lib/sql-statements.mjs";

const exportPath = process.env.CORE_EXPORT_PATH;
const outputPath = process.env.CORE_SNAPSHOT_PATH;
if (!exportPath) throw new Error("CORE_EXPORT_PATH is required");
if (!outputPath) throw new Error("CORE_SNAPSHOT_PATH is required");
if (!existsSync(exportPath)) throw new Error(`D1 export does not exist: ${exportPath}`);
if (existsSync(outputPath)) throw new Error(`snapshot output already exists: ${outputPath}`);

const db = new DatabaseSync(resolve(outputPath));
db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
let imported = 0;
const started = performance.now();
try {
  for await (const statement of readSqlStatements(resolve(exportPath))) {
    db.exec(statement);
    imported++;
    if (imported % 100_000 === 0) {
      process.stdout.write(
        `${JSON.stringify({ statements: imported, seconds: Math.round((performance.now() - started) / 1000) })}\n`,
      );
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  throw error;
}

db.exec(`
  CREATE TABLE snapshot_state (
    table_name TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 1,
    rows_copied INTEGER NOT NULL DEFAULT 0,
    high_water INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE snapshot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const excluded = new Set(["_cf_KV", "cache", "d1_migrations", "snapshot_meta", "snapshot_state", "sqlite_sequence"]);
const tables = db
  .prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  .all()
  .map((row) => row.name)
  .filter((table) => !excluded.has(table));
const insertState = db.prepare(`INSERT INTO snapshot_state(table_name,complete,rows_copied) VALUES(?,1,?)`);
db.exec("BEGIN IMMEDIATE");
for (const table of tables) {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  const count = Number(db.prepare(`SELECT COUNT(*) count FROM ${quoted}`).get().count);
  insertState.run(table, count);
}
db.prepare(`INSERT INTO snapshot_meta(key,value) VALUES('snapshot_mode','d1_export')`).run();
db.prepare(`INSERT INTO snapshot_meta(key,value) VALUES('snapshot_consistent','1')`).run();
const hasIndexerState = db.prepare(`SELECT 1 FROM sqlite_schema WHERE type='table' AND name='indexer_state'`).get();
const sourceState = hasIndexerState
  ? db
      .prepare(
        `SELECT key,value FROM indexer_state
          WHERE key IN ('last_event_index','last_block_index','last_block_hash')`,
      )
      .all()
  : [];
for (const row of sourceState) {
  db.prepare(`INSERT INTO snapshot_meta(key,value) VALUES(?,?)`).run(`source_${row.key}`, String(row.value));
}
db.exec("COMMIT; PRAGMA optimize;");
const check = db.prepare("PRAGMA quick_check").get();
if (check.quick_check !== "ok") throw new Error(`imported snapshot failed quick_check: ${check.quick_check}`);
process.stdout.write(
  `${JSON.stringify({ complete: true, consistent: true, statements: imported, tables: tables.length, seconds: Math.round((performance.now() - started) / 1000) })}\n`,
);
db.close();
