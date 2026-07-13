import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const sourcePath = process.env.CORE_SNAPSHOT_PATH;
const outputPath = process.env.CORE_COMPACT_PATH;
const allowIncomplete = process.env.CORE_BUILD_ALLOW_INCOMPLETE === "1";
const allowInconsistent = process.env.CORE_BUILD_ALLOW_INCONSISTENT === "1";
if (!sourcePath) throw new Error("CORE_SNAPSHOT_PATH is required");
if (!outputPath) throw new Error("CORE_COMPACT_PATH is required");
if (existsSync(outputPath)) throw new Error(`compact output already exists: ${outputPath}`);

const db = new DatabaseSync(outputPath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF;");
db.prepare("ATTACH DATABASE ? AS source").run(`file:${resolve(sourcePath)}?mode=ro`);

const incomplete = db
  .prepare(`SELECT table_name FROM source.snapshot_state WHERE complete<>1 ORDER BY table_name`)
  .all();
if (!allowIncomplete && incomplete.length > 0) {
  throw new Error(`source snapshot is incomplete: ${incomplete.map((row) => row.table_name).join(", ")}`);
}
const consistency = db.prepare(`SELECT value FROM source.snapshot_meta WHERE key='snapshot_consistent'`).get();
if (incomplete.length === 0 && !allowInconsistent && consistency?.value !== "1") {
  throw new Error("source snapshot is not a consistent D1 export");
}

const migrationSql = ["0001_core.sql", "0002_protocol.sql", "0003_projections.sql"].map((migration) =>
  readFileSync(new URL(`../migrations-core/${migration}`, import.meta.url), "utf8"),
);
const secondaryIndexes = migrationSql.flatMap((sql) => sql.match(/\bCREATE INDEX\b[\s\S]*?;/g) ?? []);
for (const sql of migrationSql) db.exec(sql.replaceAll(/\bCREATE INDEX\b[\s\S]*?;/g, ""));
db.prepare(
  `INSERT INTO core_state(key,value) VALUES('build_complete','0')
   ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
).run();

const transformDirectory = new URL("./core-transform/", import.meta.url);
const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const remappedSources = new Set(["credits", "debits", "indexer_state", "pr_edges"]);
const count = (relation) => Number(db.prepare(`SELECT COUNT(*) count FROM ${relation}`).get().count);
let directTables;
let sourceCounts;
let snapshotIncomplete;
let hashMismatches;
let nonNullTransactionData;
db.exec("BEGIN IMMEDIATE");
try {
  const snapshotTables = db
    .prepare(`SELECT table_name FROM source.snapshot_state ORDER BY table_name`)
    .all()
    .map((row) => row.table_name);
  directTables = snapshotTables.filter((table) => !remappedSources.has(table));
  snapshotIncomplete = db
    .prepare(`SELECT table_name FROM source.snapshot_state WHERE complete<>1 ORDER BY table_name`)
    .all();
  for (const file of readdirSync(transformDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const started = performance.now();
    const sql = readFileSync(new URL(file, transformDirectory), "utf8")
      .replace(/^\s*BEGIN IMMEDIATE;\s*/i, "")
      .replace(/\s*COMMIT;\s*$/i, "");
    db.exec(sql);
    process.stdout.write(`${JSON.stringify({ transform: file, ms: Math.round(performance.now() - started) })}\n`);
  }
  sourceCounts = Object.fromEntries(directTables.map((table) => [table, count(`source.${quoteIdentifier(table)}`)]));
  sourceCounts.ledger_events = count("source.credits") + count("source.debits");
  sourceCounts.indexer_state = count("source.indexer_state");
  sourceCounts.pr_edges = count("source.pr_edges");
  hashMismatches = Number(
    db
      .prepare(
        `SELECT COUNT(*) mismatches
           FROM source.transactions s
           JOIN transactions c ON c.tx_index=s.tx_index
          WHERE lower(hex(c.tx_hash))<>lower(s.tx_hash)`,
      )
      .get().mismatches,
  );
  nonNullTransactionData = Number(
    db.prepare(`SELECT COUNT(*) count FROM source.transactions WHERE data IS NOT NULL`).get().count,
  );
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const indexStarted = performance.now();
for (const sql of secondaryIndexes) db.exec(sql.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"));
process.stdout.write(`${JSON.stringify({ indexes_ms: Math.round(performance.now() - indexStarted) })}\n`);

db.exec("PRAGMA main.optimize;");
const page = db.prepare("PRAGMA page_count").get();
const size = db.prepare("PRAGMA page_size").get();
const allocatedBytes = Number(page.page_count) * Number(size.page_size);
const storageObjects = db
  .prepare(
    `SELECT d.name,coalesce(s.tbl_name,d.name) table_name,
            CASE WHEN s.type='index' THEN 'index' ELSE 'table' END kind,d.bytes
       FROM (SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name) d
       LEFT JOIN sqlite_schema s ON s.name=d.name
      ORDER BY d.bytes DESC,d.name`,
  )
  .all()
  .map((row) => ({ ...row, bytes: Number(row.bytes) }));
const tableStorage = new Map();
for (const object of storageObjects) {
  tableStorage.set(object.table_name, (tableStorage.get(object.table_name) ?? 0) + object.bytes);
}
const storage = {
  allocated_bytes: allocatedBytes,
  used_object_bytes: storageObjects.reduce((sum, object) => sum + object.bytes, 0),
  index_bytes: storageObjects
    .filter((object) => object.kind === "index")
    .reduce((sum, object) => sum + object.bytes, 0),
  top_tables: [...tableStorage]
    .map(([table, bytes]) => ({ table, bytes }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 20),
  top_objects: storageObjects.slice(0, 20),
};
const counts = Object.fromEntries(directTables.map((table) => [table, count(quoteIdentifier(table))]));
counts.ledger_events = count("ledger_events");
counts.indexer_state = Number(
  db.prepare(`SELECT COUNT(*) count FROM core_state WHERE key LIKE 'source_indexer:%'`).get().count,
);
counts.pr_edges = Number(db.prepare(`SELECT coalesce(sum(multiplicity),0) count FROM pr_edges`).get().count);
const complete = snapshotIncomplete.length === 0;
if (complete) {
  const mismatches = Object.keys(sourceCounts).filter((table) => Number(sourceCounts[table]) !== Number(counts[table]));
  if (mismatches.length > 0) {
    throw new Error(
      `core count parity failed: ${mismatches
        .map((table) => `${table} ${sourceCounts[table]}!=${counts[table]}`)
        .join(", ")}`,
    );
  }
  if (hashMismatches !== 0) throw new Error("transaction hash decoding parity failed");
  if (nonNullTransactionData !== 0) {
    throw new Error("source transaction data is no longer null-only and needs a compact representation");
  }
  db.prepare(
    `INSERT INTO core_state(key,value) VALUES('build_complete','1')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run();
}
process.stdout.write(
  `${JSON.stringify({ complete, bytes: allocatedBytes, storage, counts, source_counts: sourceCounts, semantic_checks: { transaction_hash_mismatches: hashMismatches, non_null_transaction_data: nonNullTransactionData } })}\n`,
);
db.close();
