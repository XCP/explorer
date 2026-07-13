import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const base = process.env.CORE_SNAPSHOT_BASE ?? "http://127.0.0.1:8793";
const output = process.env.CORE_SNAPSHOT_PATH;
const pageRows = Math.max(1, Math.min(Number(process.env.CORE_SNAPSHOT_ROWS ?? 1_000), 2_000));
const maxPages = Math.max(0, Number(process.env.CORE_SNAPSHOT_MAX_PAGES ?? 0));
const pageDelayMs = Math.max(0, Number(process.env.CORE_SNAPSHOT_DELAY_MS ?? 100));
const maxAttempts = Math.max(1, Number(process.env.CORE_SNAPSHOT_MAX_ATTEMPTS ?? 8));
const tableFilter = new Set(
  (process.env.CORE_SNAPSHOT_TABLES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (!output) throw new Error("CORE_SNAPSHOT_PATH is required");

const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const tokenLine = vars.split(/\r?\n/).find((line) => line.startsWith("ADMIN_TOKEN="));
if (!tokenLine) throw new Error("ADMIN_TOKEN is missing from apps/api/.dev.vars");
const token = tokenLine
  .slice("ADMIN_TOKEN=".length)
  .trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function get(path) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
      if (response.ok) return response.json();
      const detail = await response.text();
      const d1Reset = detail.includes("D1 DB exceeded its CPU time limit") || detail.includes("D1_ERROR");
      if (response.status < 500 && response.status !== 429 && !d1Reset) {
        const error = new Error(`${path} failed: ${response.status} ${detail}`);
        error.retryable = false;
        throw error;
      }
      if (attempt === maxAttempts) throw new Error(`${path} failed: ${response.status} ${detail}`);
    } catch (error) {
      if (error.retryable === false) throw error;
      if (attempt === maxAttempts) throw error;
    }
    const retryMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
    process.stderr.write(`${JSON.stringify({ path, attempt, retry_ms: retryMs })}\n`);
    await sleep(retryMs);
  }
  throw new Error(`${path} exhausted retries`);
}

const schema = await get("/admin/core-snapshot/schema");
const tables = schema.tables.filter((table) => tableFilter.size === 0 || tableFilter.has(table.name));
const db = new DatabaseSync(output);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS snapshot_state (
    table_name TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0,
    rows_copied INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS snapshot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
db.prepare(
  `INSERT INTO snapshot_meta(key,value) VALUES('snapshot_mode','http_live_baseline')
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
).run();
db.prepare(
  `INSERT INTO snapshot_meta(key,value) VALUES('snapshot_consistent','0')
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
).run();
for (const [key, value] of Object.entries(schema.source_state)) {
  db.prepare(`INSERT INTO snapshot_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING`).run(
    `source_${key}`,
    String(value),
  );
}

for (const table of tables) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?`).get(table.name);
  if (!exists) db.exec(table.sql);
  db.prepare(`INSERT INTO snapshot_state(table_name) VALUES(?) ON CONFLICT(table_name) DO NOTHING`).run(table.name);
  let state = db.prepare(`SELECT cursor,complete,rows_copied FROM snapshot_state WHERE table_name=?`).get(table.name);
  if (state.complete === 1) continue;
  const columns = db
    .prepare(`PRAGMA table_xinfo(${JSON.stringify(table.name)})`)
    .all()
    .filter((column) => column.hidden === 0)
    .map((column) => column.name);
  const quoted = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(",");
  const placeholders = columns.map(() => "?").join(",");
  const insert = db.prepare(`INSERT INTO "${table.name}" (${quoted}) VALUES (${placeholders})`);

  let pages = 0;
  for (;;) {
    const page = await get(
      `/admin/core-snapshot/${encodeURIComponent(table.name)}?after=${state.cursor}&rows=${pageRows}`,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of page.rows) insert.run(...columns.map((column) => row[column] ?? null));
      db.prepare(
        `UPDATE snapshot_state
            SET cursor=?,complete=?,rows_copied=rows_copied+?
          WHERE table_name=?`,
      ).run(page.cursor, page.caught_up ? 1 : 0, page.rows.length, table.name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    state = {
      cursor: page.cursor,
      complete: page.caught_up ? 1 : 0,
      rows_copied: state.rows_copied + page.rows.length,
    };
    pages++;
    if (page.caught_up) break;
    if (maxPages > 0 && pages >= maxPages) break;
    if (pageDelayMs > 0) await sleep(pageDelayMs);
    if (state.rows_copied % (pageRows * 100) === 0) {
      process.stdout.write(`${JSON.stringify({ table: table.name, rows: state.rows_copied, cursor: state.cursor })}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ table: table.name, rows: state.rows_copied, complete: state.complete === 1 })}\n`,
  );
}

db.close();
