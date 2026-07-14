import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
    }),
  );
  return nested.flat();
}

const violations = [];
const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const oldDatabaseBudget = new Map([
  ["admin.ts", 17],
  ["index.ts", 24],
  ["indexer/asset-supply.ts", 18],
  ["indexer/core-manifest.ts", 2],
  ["indexer/core-parity.ts", 3],
  ["indexer/core-projections.ts", 7],
  ["indexer/emblem.ts", 17],
  ["indexer/emblem-listings.ts", 8],
  ["indexer/emblem-meta.ts", 3],
  ["indexer/emblem-sales.ts", 9],
  ["indexer/emblem-scam.ts", 19],
  ["indexer/emblem-transfers.ts", 11],
  ["indexer/graph-eval.ts", 2],
  ["indexer/holder-cohesion.ts", 4],
  ["indexer/ledger-readiness.ts", 2],
  ["indexer/scarce-sales.ts", 8],
  ["indexer/signals.ts", 20],
  ["indexer/sync.ts", 39],
  ["indexer/tags.ts", 12],
  ["indexer/trades.ts", 21],
  ["indexer/vault-contents.ts", 11],
  ["legacy.ts", 3],
  ["recovery/admin.ts", 1],
  ["verify.ts", 6],
]);
const observedOldDatabaseReferences = new Map();

for (const file of await sourceFiles(sourceRoot)) {
  const source = await readFile(file, "utf8");
  if (/\bINSERT\s+OR\s+REPLACE\b/i.test(source) || /\bREPLACE\s+INTO\b/i.test(source))
    violations.push(path.relative(process.cwd(), file));
  const relative = path.relative(sourceRoot, file).replaceAll(path.sep, "/");
  const references = source.match(/(?:(?:c|ctx)\.)?env\.DB/g)?.length ?? 0;
  if (references > 0) observedOldDatabaseReferences.set(relative, references);
}

if (violations.length) {
  console.error(
    `Replace-style SQL is forbidden; use an explicit conflict target and update:\n${violations.join("\n")}`,
  );
  process.exitCode = 1;
}

const oldDatabaseViolations = [];
for (const [file, references] of observedOldDatabaseReferences) {
  const budget = oldDatabaseBudget.get(file) ?? 0;
  if (references > budget) oldDatabaseViolations.push(`${file}: ${references} references (budget ${budget})`);
}
for (const [file] of oldDatabaseBudget) {
  if (!observedOldDatabaseReferences.has(file))
    oldDatabaseViolations.push(`${file}: budget remains after its old-database references were removed`);
}
if (oldDatabaseViolations.length) {
  console.error(
    `Old-database references may only decrease; update the cutover budget when removing them:\n${oldDatabaseViolations.join("\n")}`,
  );
  process.exitCode = 1;
}
