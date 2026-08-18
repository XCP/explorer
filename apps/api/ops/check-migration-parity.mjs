import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails when the migrations applied to a production database and the migrations
 * committed to this repo are not the same set.
 *
 * Deliberately not built on `wrangler d1 migrations list`, which answers a
 * different question: it reports files in the folder that have NOT been applied
 * yet, so it is structurally blind to the drift that actually bit us -- a
 * migration applied in production with no file in the repo at all. That is how
 * 0084_xcp_supply_daily.sql left a materialized table live in core that nothing
 * read for weeks, and how 0014_reverify_index.sql went missing from recovery.
 * The applied set lives in the d1_migrations table, so ask that instead, and
 * compare both directions.
 *
 * Also flags two files claiming the same migration number, which happened three
 * times in one day: `wrangler d1 migrations apply` orders by name, so a
 * collision silently reorders or skips work depending on which name sorts first.
 */

const wranglerConfig = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const apiRoot = path.dirname(wranglerConfig);

function parseDatabases(toml) {
  const databases = [];
  for (const block of toml.split(/\[\[d1_databases\]\]/).slice(1)) {
    const upToNextSection = block.split(/\n\[/)[0];
    const value = (key) => upToNextSection.match(new RegExp(`^${key} = "([^"]+)"`, "m"))?.[1];
    const name = value("database_name");
    const directory = value("migrations_dir");
    // A binding with no migrations_dir keeps its migrations somewhere else, or
    // has none; either way there is nothing here to compare.
    if (name && directory) databases.push({ name, directory, table: value("migrations_table") ?? "d1_migrations" });
  }
  return databases;
}

// Run wrangler's entry point under this node, rather than through npx: node 22
// on Windows refuses to spawn a .cmd shim without a shell, and going through a
// shell would then need the SQL below quoted by hand. Found by walking up to
// the workspace root, since wrangler's package exports do not expose bin/.
function findWrangler() {
  let directory = apiRoot;
  for (;;) {
    const candidate = path.join(directory, "node_modules", "wrangler", "bin", "wrangler.js");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("wrangler is not installed; run npm install");
    directory = parent;
  }
}

const wranglerEntry = findWrangler();

function appliedMigrations(database, table) {
  const result = spawnSync(
    process.execPath,
    [
      wranglerEntry,
      "d1",
      "execute",
      database,
      "--remote",
      "--json",
      "--command",
      `SELECT name FROM ${table} ORDER BY id`,
    ],
    { cwd: apiRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error) throw new Error(`could not run wrangler: ${result.error.message}`);
  const output = result.stdout ?? "";
  const start = output.indexOf("[");
  if (start < 0)
    throw new Error(
      `wrangler returned no JSON for ${database}; it said:\n${(result.stderr || output).trim().slice(0, 500)}`,
    );
  const parsed = JSON.parse(output.slice(start));
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((r) => r.results ?? []);
  return rows.map((row) => row.name);
}

async function repoMigrations(directory) {
  const entries = await readdir(path.join(apiRoot, directory));
  return entries.filter((entry) => entry.endsWith(".sql")).sort();
}

function duplicateNumbers(files) {
  const byNumber = new Map();
  for (const file of files) {
    const number = file.match(/^(\d+)/)?.[1];
    if (!number) continue;
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
  }
  return [...byNumber.entries()].filter(([, files]) => files.length > 1);
}

const databases = parseDatabases(await readFile(wranglerConfig, "utf8"));
if (databases.length === 0) {
  console.error("No [[d1_databases]] with a migrations_dir found in wrangler.toml.");
  process.exit(1);
}

for (const { name, directory, table } of databases) {
  const files = await repoMigrations(directory);
  const applied = appliedMigrations(name, table);
  const appliedSet = new Set(applied);
  const fileSet = new Set(files);

  const missingFromRepo = applied.filter((migration) => !fileSet.has(migration));
  const notApplied = files.filter((migration) => !appliedSet.has(migration));
  const collisions = duplicateNumbers(files);

  const clean = !missingFromRepo.length && !notApplied.length && !collisions.length;
  console.log(
    `${name} / ${directory}: ${files.length} in repo, ${applied.length} applied${clean ? " -- in sync" : ""}`,
  );

  if (missingFromRepo.length) {
    console.error(
      `  applied in production but absent from the repo -- reconstruct from the deployed schema and commit:\n${missingFromRepo.map((m) => `    ${m}`).join("\n")}`,
    );
    process.exitCode = 1;
  }
  if (notApplied.length) {
    console.error(
      `  committed but never applied -- run the migrate:remote script, or delete the file:\n${notApplied.map((m) => `    ${m}`).join("\n")}`,
    );
    process.exitCode = 1;
  }
  for (const [number, files] of collisions) {
    console.error(`  two migrations numbered ${number}: ${files.join(", ")}`);
    process.exitCode = 1;
  }
}
