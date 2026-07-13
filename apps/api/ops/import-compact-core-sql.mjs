import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
if (
  manifest.format !== 2 ||
  manifest.finalization !== "import_complete" ||
  !Array.isArray(manifest.files) ||
  typeof manifest.schema !== "object"
) {
  throw new Error("unsupported or incomplete compact SQL manifest");
}

const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const defaultStatePath = join(dirname(resolvedDirectory), `${basename(resolvedDirectory)}-${database}-import.json`);
const statePath = resolve(process.env.CORE_IMPORT_STATE ?? defaultStatePath);
const wranglerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = createRequire(import.meta.url).resolve("wrangler");
const windowsWranglerLauncher = resolve(dirname(fileURLToPath(import.meta.url)), "run-wrangler.ps1");

function wrangler(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const windows = process.platform === "win32";
    const executable = windows ? "powershell.exe" : process.execPath;
    const childArgs = windows
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          windowsWranglerLauncher,
          wranglerCli,
          ...args,
        ]
      : [wranglerCli, ...args];
    const child = spawn(executable, childArgs, {
      cwd: wranglerDirectory,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
    }
    child.once("error", reject);
    child.once("close", (status) => {
      if (status !== 0) {
        const detail = options.capture ? `: ${(stderr || stdout).trim()}` : "";
        reject(new Error(`wrangler exited with status ${status}${detail}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function remoteRows(sql) {
  const output = await wrangler(["d1", "execute", database, "--remote", "--command", sql, "--json"], {
    capture: true,
  });
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

const expectedTables = Object.keys(manifest.tables).sort();
const remoteTables = (
  await remoteRows(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV') ORDER BY name",
  )
).map((row) => String(row.name));
if (JSON.stringify(remoteTables) !== JSON.stringify(expectedTables)) {
  const expected = new Set(expectedTables);
  const actual = new Set(remoteTables);
  const missing = expectedTables.filter((table) => !actual.has(table));
  const unexpected = remoteTables.filter((table) => !expected.has(table));
  throw new Error(
    `remote compact schema does not match the artifact (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
  );
}
const schemaSql = expectedTables
  .map(
    (table) =>
      `SELECT '${table.replaceAll("'", "''")}' table_name,cid,name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo('${table.replaceAll("'", "''")}')`,
  )
  .join(" UNION ALL ");
const remoteSchemaRows = await remoteRows(`${schemaSql} ORDER BY table_name,cid`);
const remoteSchema = Object.fromEntries(expectedTables.map((table) => [table, []]));
for (const row of remoteSchemaRows) {
  remoteSchema[row.table_name].push({
    cid: Number(row.cid),
    name: row.name,
    type: row.type,
    notnull: Number(row.notnull),
    dflt_value: row.dflt_value,
    pk: Number(row.pk),
    hidden: Number(row.hidden),
  });
}
if (JSON.stringify(remoteSchema) !== JSON.stringify(manifest.schema)) {
  throw new Error("remote compact columns or identities do not match the artifact");
}

let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.database !== database || state.manifest_sha256 !== manifestSha256 || !Array.isArray(state.completed)) {
    throw new Error(`import checkpoint does not match this database and manifest: ${statePath}`);
  }
} else {
  const rows = await remoteRows("SELECT COUNT(*) AS state_rows FROM core_state");
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
  await wrangler(["d1", "execute", database, "--remote", "--yes", "--file", path]);
  completed.add(file.sha256);
  state.completed = [...completed];
  const temporaryStatePath = `${statePath}.tmp`;
  writeFileSync(temporaryStatePath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporaryStatePath, statePath);
}

const readiness = Object.fromEntries(
  (
    await remoteRows(
      "SELECT key,value FROM core_state WHERE key IN ('build_complete','import_complete','seed_event_index','last_event_index')",
    )
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
