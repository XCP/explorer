import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const sourcePath = process.env.CORE_SNAPSHOT_PATH;
const outputPath = process.env.CORE_COMPACT_PATH;
const allowIncomplete = process.env.CORE_BUILD_ALLOW_INCOMPLETE === "1";
if (!sourcePath) throw new Error("CORE_SNAPSHOT_PATH is required");
if (!outputPath) throw new Error("CORE_COMPACT_PATH is required");

const db = new DatabaseSync(outputPath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF;");
db.prepare("ATTACH DATABASE ? AS source").run(`file:${resolve(sourcePath)}?mode=ro`);

const incomplete = db
  .prepare(`SELECT table_name FROM source.snapshot_state WHERE complete<>1 ORDER BY table_name`)
  .all();
if (!allowIncomplete && incomplete.length > 0) {
  throw new Error(`source snapshot is incomplete: ${incomplete.map((row) => row.table_name).join(", ")}`);
}

const hasSchema = db.prepare(`SELECT 1 FROM sqlite_schema WHERE type='table' AND name='core_state'`).get();
const migrationSql = ["0001_core.sql", "0002_protocol.sql", "0003_projections.sql"].map((migration) =>
  readFileSync(new URL(`../migrations-core/${migration}`, import.meta.url), "utf8"),
);
const secondaryIndexes = migrationSql.flatMap((sql) => sql.match(/\bCREATE INDEX\b[\s\S]*?;/g) ?? []);
if (!hasSchema) {
  for (const sql of migrationSql) db.exec(sql.replaceAll(/\bCREATE INDEX\b[\s\S]*?;/g, ""));
}

const transformDirectory = new URL("./core-transform/", import.meta.url);
for (const file of readdirSync(transformDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const started = performance.now();
  db.exec(readFileSync(new URL(file, transformDirectory), "utf8"));
  process.stdout.write(`${JSON.stringify({ transform: file, ms: Math.round(performance.now() - started) })}\n`);
}

const indexStarted = performance.now();
for (const sql of secondaryIndexes) db.exec(sql.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"));
process.stdout.write(`${JSON.stringify({ indexes_ms: Math.round(performance.now() - indexStarted) })}\n`);

db.exec("PRAGMA main.optimize;");
const page = db.prepare("PRAGMA page_count").get();
const size = db.prepare("PRAGMA page_size").get();
const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const snapshotTables = db
  .prepare(`SELECT table_name FROM source.snapshot_state ORDER BY table_name`)
  .all()
  .map((row) => row.table_name);
const remappedSources = new Set(["credits", "debits", "indexer_state", "pr_edges"]);
const directTables = snapshotTables.filter((table) => !remappedSources.has(table));
const count = (relation) => Number(db.prepare(`SELECT COUNT(*) count FROM ${relation}`).get().count);
const counts = Object.fromEntries(directTables.map((table) => [table, count(quoteIdentifier(table))]));
const sourceCounts = Object.fromEntries(
  directTables.map((table) => [table, count(`source.${quoteIdentifier(table)}`)]),
);
sourceCounts.ledger_events = count("source.credits") + count("source.debits");
counts.ledger_events = count("ledger_events");
sourceCounts.indexer_state = count("source.indexer_state");
counts.indexer_state = Number(
  db.prepare(`SELECT COUNT(*) count FROM core_state WHERE key LIKE 'source_indexer:%'`).get().count,
);
sourceCounts.pr_edges = count("source.pr_edges");
counts.pr_edges = Number(db.prepare(`SELECT coalesce(sum(multiplicity),0) count FROM pr_edges`).get().count);
const complete = incomplete.length === 0;
if (complete) {
  const mismatches = Object.keys(sourceCounts).filter((table) => Number(sourceCounts[table]) !== Number(counts[table]));
  if (mismatches.length > 0) {
    throw new Error(
      `core count parity failed: ${mismatches
        .map((table) => `${table} ${sourceCounts[table]}!=${counts[table]}`)
        .join(", ")}`,
    );
  }
  const hashMismatch = db
    .prepare(
      `SELECT COUNT(*) mismatches
         FROM source.transactions s
         JOIN transactions c ON c.tx_index=s.tx_index
        WHERE lower(hex(c.tx_hash))<>lower(s.tx_hash)`,
    )
    .get();
  if (Number(hashMismatch.mismatches) !== 0) throw new Error("transaction hash decoding parity failed");
}
process.stdout.write(
  `${JSON.stringify({ complete, bytes: Number(page.page_count) * Number(size.page_size), counts, source_counts: sourceCounts })}\n`,
);
db.close();
