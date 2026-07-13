import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readSqlStatements } from "./lib/sql-statements.mjs";

const directory = process.env.CORE_SQL_DIRECTORY;
if (!directory) throw new Error("CORE_SQL_DIRECTORY is required");
const resolvedDirectory = resolve(directory);
const manifestPath = join(resolvedDirectory, "manifest.json");
if (!existsSync(manifestPath)) throw new Error(`SQL manifest does not exist: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.format !== 2 || !Array.isArray(manifest.files) || typeof manifest.schema !== "object") {
  throw new Error("unsupported compact SQL manifest");
}
if (manifest.finalization !== "import_complete") throw new Error("compact SQL manifest has no final import gate");
const expectedFiles = manifest.files.map((file) => file.file);
const actualFiles = readdirSync(resolvedDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())) {
  throw new Error("SQL chunk files do not exactly match the manifest");
}

for (const expected of manifest.files) {
  const path = join(resolvedDirectory, expected.file);
  const bytes = statSync(path).size;
  if (bytes !== expected.bytes) throw new Error(`${expected.file} size mismatch: ${bytes} != ${expected.bytes}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const digest = hash.digest("hex");
  if (digest !== expected.sha256) throw new Error(`${expected.file} SHA-256 mismatch`);

  let statements = 0;
  let largestStatement = 0;
  for await (const statement of readSqlStatements(path)) {
    const statementBytes = Buffer.byteLength(statement);
    if (statementBytes > manifest.max_statement_bytes) {
      throw new Error(`${expected.file} contains a ${statementBytes}-byte statement`);
    }
    statements++;
    largestStatement = Math.max(largestStatement, statementBytes);
  }
  if (statements !== expected.statements + 1) {
    throw new Error(`${expected.file} statement mismatch: ${statements - 1} != ${expected.statements}`);
  }
  process.stdout.write(
    `${JSON.stringify({ file: basename(path), bytes, statements, largest_statement: largestStatement })}\n`,
  );
}

process.stdout.write(
  `${JSON.stringify({ verified: true, files: manifest.files.length, rows: Object.values(manifest.tables).reduce((sum, rows) => sum + rows, 0) })}\n`,
);
