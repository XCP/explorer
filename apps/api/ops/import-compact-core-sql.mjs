import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.env.CORE_SQL_DIRECTORY;
const database = process.env.CORE_D1_DATABASE;
if (!directory) throw new Error("CORE_SQL_DIRECTORY is required");
if (!database) throw new Error("CORE_D1_DATABASE is required");

const resolvedDirectory = resolve(directory);
const manifestPath = join(resolvedDirectory, "manifest.json");
if (!existsSync(manifestPath)) throw new Error(`SQL manifest does not exist: ${manifestPath}`);
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.format !== 1 || manifest.finalization !== "import_complete" || !Array.isArray(manifest.files)) {
  throw new Error("unsupported or incomplete compact SQL manifest");
}

const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const defaultStatePath = join(dirname(resolvedDirectory), `${basename(resolvedDirectory)}-${database}-import.json`);
const statePath = resolve(process.env.CORE_IMPORT_STATE ?? defaultStatePath);
const wranglerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";

function wrangler(args, options = {}) {
  const result = spawnSync(executable, ["wrangler", ...args], {
    cwd: wranglerDirectory,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `: ${(result.stderr || result.stdout).trim()}` : "";
    throw new Error(`wrangler exited with status ${result.status}${detail}`);
  }
  return result.stdout;
}

function remoteRows(sql) {
  const output = wrangler(["d1", "execute", database, "--remote", "--command", sql, "--json"], { capture: true });
  const response = JSON.parse(output);
  if (!Array.isArray(response) || response.some((entry) => entry.success !== true)) {
    throw new Error("unexpected D1 query response");
  }
  return response.flatMap((entry) => entry.results ?? []);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

for (const file of manifest.files) {
  const path = join(resolvedDirectory, file.file);
  if (!existsSync(path) || statSync(path).size !== file.bytes) throw new Error(`${file.file} size mismatch`);
  const digest = await hashFile(path);
  if (digest !== file.sha256) throw new Error(`${file.file} SHA-256 mismatch`);
}

let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.database !== database || state.manifest_sha256 !== manifestSha256 || !Array.isArray(state.completed)) {
    throw new Error(`import checkpoint does not match this database and manifest: ${statePath}`);
  }
} else {
  const rows = remoteRows("SELECT COUNT(*) AS state_rows FROM core_state");
  if (Number(rows[0]?.state_rows) !== 0) {
    throw new Error("target core database is not empty; use a fresh migrated database or the matching checkpoint");
  }
  state = { database, manifest_sha256: manifestSha256, completed: [] };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
}

const completed = new Set(state.completed);
for (const file of manifest.files) {
  if (completed.has(file.sha256)) continue;
  const path = join(resolvedDirectory, file.file);
  process.stdout.write(`${JSON.stringify({ importing: file.file, bytes: file.bytes })}\n`);
  wrangler(["d1", "execute", database, "--remote", "--yes", "--file", path]);
  completed.add(file.sha256);
  state.completed = [...completed];
  const temporaryStatePath = `${statePath}.tmp`;
  writeFileSync(temporaryStatePath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporaryStatePath, statePath);
}

const readiness = Object.fromEntries(
  remoteRows(
    "SELECT key,value FROM core_state WHERE key IN ('build_complete','import_complete','seed_event_index','last_event_index')",
  ).map((row) => [row.key, row.value]),
);
if (
  readiness.build_complete !== "1" ||
  readiness.import_complete !== "1" ||
  readiness.seed_event_index == null ||
  readiness.last_event_index == null
) {
  throw new Error("remote core database did not complete the seed import");
}
process.stdout.write(
  `${JSON.stringify({ complete: true, database, files: manifest.files.length, manifest_sha256: manifestSha256 })}\n`,
);
