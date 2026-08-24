import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

/**
 * Efficiency proofs for the /stats leaderboards and the computed-tag rules.
 *
 * Both read address_signals — 442,493 rows — and both depend on partial
 * indexes shaped `(col DESC, address_id) WHERE col > 0`. Those indexes are
 * silent when they stop being used: the answer stays right and only the bill
 * changes, which is why these are pinned by plan rather than by result.
 *
 * Run against the real migrations, so a dropped or renamed index fails here.
 */

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  return db;
}

const plan = (db: DatabaseSync, sql: string): string[] =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail);

/** The leaderboard shape: filter a column above zero, order by it, take a page. */
const board = (column: string) =>
  `SELECT dictionary.address FROM address_signals signal
   JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
   WHERE signal.${column}>0 ORDER BY signal.${column} DESC LIMIT 12`;

test("the /stats address leaderboards seek a partial index instead of scanning", () => {
  const db = migrated();
  // Every board on this table shares one shape, so they share one proof.
  // clean_dispense_btc and assets_hits are the two that lacked an index until
  // 0096 — they were measured at 468,406 and 444,208 rows read per call.
  for (const column of [
    "clean_dispense_btc",
    "assets_hits",
    "survived_assets",
    "assets_held",
    "clean_btc_spent",
    "stamps_created",
    "stamps_collected",
    "src20_deploys",
  ]) {
    const lines = plan(db, board(column));
    assert.equal(
      lines.some((line) => /^SCAN signal\b(?!.*USING (COVERING )?INDEX)/.test(line)),
      false,
      `${column} board scans address_signals:\n${lines.join("\n")}`,
    );
    assert.equal(
      lines.some((line) => /TEMP B-TREE/.test(line)),
      false,
      `${column} board sorts instead of walking its index:\n${lines.join("\n")}`,
    );
  }
});

/**
 * SQLite only uses a partial index when it can prove the query's WHERE
 * implies the index's, and that prover is syntactic: it does not deduce
 * `col >= 20` from `col > 0`. This is the negative control for that claim —
 * if it ever starts passing, SQLite learned the implication and the extra
 * `col > 0` term in indexer/tags.ts can be dropped.
 */
test("a bare >= threshold does NOT reach the > 0 partial index", () => {
  const db = migrated();
  const lines = plan(db, `SELECT address_id FROM address_signals signal WHERE signal.survived_assets>=1`);
  assert.equal(
    lines.some((line) => /^SCAN/.test(line)),
    true,
    `SQLite now proves >=1 implies >0. The paired term in tags.ts is no longer needed:\n${lines.join("\n")}`,
  );
});

test("the paired form does reach it", () => {
  const db = migrated();
  const lines = plan(
    db,
    `SELECT address_id FROM address_signals signal
     WHERE signal.survived_assets>0 AND signal.survived_assets>=1`,
  );
  assert.equal(
    lines.some((line) => /USING (COVERING )?INDEX/.test(line)),
    true,
    `paired threshold lost its index:\n${lines.join("\n")}`,
  );
});

/**
 * The rules in indexer/tags.ts are not exported, so this asserts the
 * invariant against the source: any threshold rule filtering a column that
 * HAS a `> 0` partial index must restate that term, or it silently scans the
 * whole table. Driven off the indexes actually present in the migrations, so
 * adding or removing one keeps this correct without editing the test.
 */
test("every tag threshold on an indexed column restates the index predicate", () => {
  const db = migrated();
  const indexed = new Set(
    (
      db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='address_signals' AND sql IS NOT NULL`)
        .all() as { sql: string }[]
    ).flatMap((row) => {
      const match = /WHERE\s+([a-z_]+)\s*>\s*0\s*$/i.exec(row.sql.replace(/\s+/g, " ").trim());
      return match ? [match[1]] : [];
    }),
  );
  assert.ok(indexed.size > 0, "expected some `WHERE col > 0` partial indexes on address_signals");

  const source = readFileSync("src/indexer/tags.ts", "utf8");
  const offenders: string[] = [];
  for (const [, column, threshold] of source.matchAll(/signal\.([a-z_0-9]+)\s*>=\s*(\d+)/g)) {
    if (!indexed.has(column)) continue; // no index to reach; the plain form is fine
    if (!new RegExp(`signal\\.${column}\\s*>\\s*0`).test(source)) {
      offenders.push(`${column}>=${threshold}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these tag rules filter an indexed column with a bare >= and will scan all 442k rows. ` +
      `Restate the index predicate, e.g. \`signal.col>0 AND signal.col>=N\`: ${offenders.join(", ")}`,
  );
});
