import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { readSqlStatements } from "./lib/sql-statements.mjs";

const sourceDirectory = resolve(process.env.CORE_SQL_DIRECTORY ?? "");
const outputDirectory = resolve(process.env.CORE_SQL_OUTPUT_DIRECTORY ?? "");
const maxFileBytes = Number(process.env.CORE_SQL_FILE_BYTES ?? 16 * 1024 * 1024);
if (!process.env.CORE_SQL_DIRECTORY) throw new Error("CORE_SQL_DIRECTORY is required");
if (!process.env.CORE_SQL_OUTPUT_DIRECTORY) throw new Error("CORE_SQL_OUTPUT_DIRECTORY is required");
if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1_000_000) throw new Error("invalid CORE_SQL_FILE_BYTES");
if (existsSync(outputDirectory)) throw new Error(`SQL output directory already exists: ${outputDirectory}`);

const sourceManifest = JSON.parse(readFileSync(join(sourceDirectory, "manifest.json"), "utf8"));
if (sourceManifest.format !== 2 || !Array.isArray(sourceManifest.files)) throw new Error("unsupported SQL manifest");

const preamble = "PRAGMA defer_foreign_keys=TRUE;\n";
const files = [];
let fileNumber = 0;
let file = null;

function openFile() {
  fileNumber++;
  const path = join(outputDirectory, `data-${String(fileNumber).padStart(4, "0")}.sql`);
  file = { path, descriptor: openSync(path, "wx"), bytes: 0, statements: 0, hash: createHash("sha256") };
  write(preamble);
}

function write(value) {
  const bytes = Buffer.byteLength(value);
  writeSync(file.descriptor, value);
  file.hash.update(value);
  file.bytes += bytes;
}

function closeFile() {
  if (!file) return;
  closeSync(file.descriptor);
  files.push({
    file: basename(file.path),
    bytes: file.bytes,
    statements: file.statements,
    rows: 0,
    sha256: file.hash.digest("hex"),
  });
  file = null;
}

try {
  mkdirSync(outputDirectory);
  for (const sourceFile of sourceManifest.files) {
    for await (const statement of readSqlStatements(join(sourceDirectory, sourceFile.file))) {
      if (statement.trim().toUpperCase() === "PRAGMA DEFER_FOREIGN_KEYS=TRUE;") continue;
      const sql = statement;
      const bytes = Buffer.byteLength(sql);
      if (bytes + Buffer.byteLength(preamble) > maxFileBytes) throw new Error("statement exceeds target file size");
      if (!file) openFile();
      if (file.statements > 0 && file.bytes + bytes > maxFileBytes) {
        closeFile();
        openFile();
      }
      write(sql);
      file.statements++;
    }
  }
  closeFile();
  const manifest = { ...sourceManifest, max_file_bytes: maxFileBytes, files };
  const temporaryManifest = join(outputDirectory, "manifest.json.tmp");
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryManifest, join(outputDirectory, "manifest.json"));
  process.stdout.write(
    `${JSON.stringify({ complete: true, files: files.length, bytes: files.reduce((sum, item) => sum + item.bytes, 0) })}\n`,
  );
} catch (error) {
  closeFile();
  rmSync(outputDirectory, { recursive: true, force: true });
  throw error;
}
