import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const compactPath = process.env.CORE_COMPACT_PATH;
const outputDirectory = process.env.CORE_SQL_DIRECTORY;
const maxStatementBytes = Math.min(95_000, Math.max(10_000, Number(process.env.CORE_SQL_STATEMENT_BYTES ?? 90_000)));
const maxFileBytes = Math.min(
  4_500_000_000,
  Math.max(maxStatementBytes, Number(process.env.CORE_SQL_FILE_BYTES ?? 256 * 1024 * 1024)),
);
if (!compactPath) throw new Error("CORE_COMPACT_PATH is required");
if (!outputDirectory) throw new Error("CORE_SQL_DIRECTORY is required");
if (!existsSync(compactPath)) throw new Error(`compact database does not exist: ${compactPath}`);
if (existsSync(outputDirectory)) throw new Error(`SQL output directory already exists: ${outputDirectory}`);

const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const sqlLiteral = (value) => {
  if (value == null) return "NULL";
  if (typeof value === "bigint") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot serialize non-finite number: ${value}`);
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\0")) return `CAST(X'${Buffer.from(value).toString("hex")}' AS TEXT)`;
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  throw new Error(`cannot serialize SQLite value of type ${typeof value}`);
};

const database = new DatabaseSync(resolve(compactPath), { readOnly: true });
const integrity = database.prepare("PRAGMA quick_check").get();
if (integrity.quick_check !== "ok") throw new Error(`compact database failed quick_check: ${integrity.quick_check}`);

const tables = database
  .prepare(
    `SELECT name FROM sqlite_schema
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV')
      ORDER BY name`,
  )
  .all()
  .map((row) => row.name);

mkdirSync(outputDirectory, { recursive: false });
let fileNumber = 0;
let file = null;
const files = [];
const tableRows = {};

function closeFile() {
  if (!file) return;
  closeSync(file.descriptor);
  files.push({
    file: basename(file.path),
    bytes: file.bytes,
    statements: file.statements,
    rows: file.rows,
    sha256: file.hash.digest("hex"),
  });
  file = null;
}

function openFile() {
  fileNumber++;
  const path = join(outputDirectory, `data-${String(fileNumber).padStart(4, "0")}.sql`);
  file = { path, descriptor: openSync(path, "wx"), bytes: 0, statements: 0, rows: 0, hash: createHash("sha256") };
  writeToFile("PRAGMA defer_foreign_keys=TRUE;\n", 0, false);
}

function writeToFile(sql, rows, countStatement = true) {
  const bytes = Buffer.byteLength(sql);
  writeSync(file.descriptor, sql);
  file.hash.update(sql);
  file.bytes += bytes;
  file.rows += rows;
  if (countStatement) file.statements++;
}

try {
  for (const table of tables) {
    const columns = database
      .prepare(`PRAGMA table_xinfo(${quoteIdentifier(table)})`)
      .all()
      .filter((column) => Number(column.hidden) === 0);
    const primaryColumns = new Set(columns.filter((column) => Number(column.pk) > 0).map((column) => column.name));
    const hasUniqueIdentity =
      primaryColumns.size > 0 ||
      database
        .prepare(`PRAGMA index_list(${quoteIdentifier(table)})`)
        .all()
        .some((index) => Number(index.unique) === 1);
    if (!hasUniqueIdentity) throw new Error(`target table has no primary or unique identity: ${table}`);

    const names = columns.map((column) => column.name);
    const updateColumns = names.filter((name) => !primaryColumns.has(name));
    const prefix = `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(",")}) VALUES `;
    const suffix = updateColumns.length
      ? ` ON CONFLICT DO UPDATE SET ${updateColumns
          .map((name) => `${quoteIdentifier(name)}=excluded.${quoteIdentifier(name)}`)
          .join(",")};\n`
      : " ON CONFLICT DO NOTHING;\n";
    const query = database.prepare(`SELECT ${names.map(quoteIdentifier).join(",")} FROM ${quoteIdentifier(table)}`);
    query.setReadBigInts(true);

    let tuples = [];
    let tupleBytes = 0;
    let rows = 0;
    const flush = () => {
      if (tuples.length === 0) return;
      const sql = `${prefix}${tuples.join(",")}${suffix}`;
      const bytes = Buffer.byteLength(sql);
      if (bytes > maxStatementBytes) throw new Error(`${table} generated a ${bytes}-byte SQL statement`);
      if (!file) openFile();
      if (file.statements > 0 && file.bytes + bytes > maxFileBytes) {
        closeFile();
        openFile();
      }
      writeToFile(sql, tuples.length);
      tuples = [];
      tupleBytes = 0;
    };

    for (const row of query.iterate()) {
      const tuple = `(${names.map((name) => sqlLiteral(row[name])).join(",")})`;
      const bytes = Buffer.byteLength(tuple);
      if (Buffer.byteLength(prefix) + bytes + Buffer.byteLength(suffix) > maxStatementBytes) {
        throw new Error(`row ${rows + 1} in ${table} exceeds D1's SQL statement limit`);
      }
      const separatorBytes = tuples.length === 0 ? 0 : 1;
      if (
        Buffer.byteLength(prefix) + tupleBytes + separatorBytes + bytes + Buffer.byteLength(suffix) >
        maxStatementBytes
      )
        flush();
      tuples.push(tuple);
      tupleBytes += separatorBytes + bytes;
      rows++;
    }
    flush();
    tableRows[table] = rows;
    process.stdout.write(`${JSON.stringify({ table, rows })}\n`);
  }
  closeFile();
  const manifest = {
    format: 1,
    source: basename(compactPath),
    max_statement_bytes: maxStatementBytes,
    max_file_bytes: maxFileBytes,
    tables: tableRows,
    files,
  };
  const temporaryManifest = join(outputDirectory, "manifest.json.tmp");
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryManifest, join(outputDirectory, "manifest.json"));
  process.stdout.write(
    `${JSON.stringify({ complete: true, files: files.length, rows: Object.values(tableRows).reduce((sum, rows) => sum + rows, 0), bytes: files.reduce((sum, item) => sum + item.bytes, 0) })}\n`,
  );
} catch (error) {
  closeFile();
  rmSync(outputDirectory, { recursive: true, force: true });
  throw error;
} finally {
  database.close();
}
