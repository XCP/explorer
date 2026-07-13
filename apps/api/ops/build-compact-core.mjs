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
if (!hasSchema) {
  for (const migration of ["0001_core.sql", "0002_protocol.sql", "0003_projections.sql"]) {
    db.exec(readFileSync(new URL(`../migrations-core/${migration}`, import.meta.url), "utf8"));
  }
}

const transformDirectory = new URL("./core-transform/", import.meta.url);
for (const file of readdirSync(transformDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const started = performance.now();
  db.exec(readFileSync(new URL(file, transformDirectory), "utf8"));
  process.stdout.write(`${JSON.stringify({ transform: file, ms: Math.round(performance.now() - started) })}\n`);
}

db.exec("PRAGMA main.optimize;");
const page = db.prepare("PRAGMA page_count").get();
const size = db.prepare("PRAGMA page_size").get();
const counts = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM transactions) transactions,
       (SELECT COUNT(*) FROM balances) balances,
       (SELECT COUNT(*) FROM sends) sends,
       (SELECT COUNT(*) FROM issuances) issuances,
       (SELECT COUNT(*) FROM orders) orders,
       (SELECT COUNT(*) FROM order_matches) order_matches`,
  )
  .get();
const sourceCounts = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM source.transactions) transactions,
       (SELECT COUNT(*) FROM source.balances) balances,
       (SELECT COUNT(*) FROM source.sends) sends,
       (SELECT COUNT(*) FROM source.issuances) issuances,
       (SELECT COUNT(*) FROM source.orders) orders,
       (SELECT COUNT(*) FROM source.order_matches) order_matches`,
  )
  .get();
const complete = incomplete.length === 0;
if (complete) {
  const mismatches = Object.keys(sourceCounts).filter((table) => Number(sourceCounts[table]) !== Number(counts[table]));
  if (mismatches.length > 0) {
    throw new Error(
      `foundational count parity failed: ${mismatches
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
