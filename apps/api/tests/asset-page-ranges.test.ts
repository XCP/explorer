import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listCoreAssets } from "#api/queries/core-assets";

test("alphabetical offsets match the live catalog across range boundaries and indexer changes", async () => {
  const db = new DatabaseSync(":memory:");
  const migration = "0101_asset_page_ranges.sql";
  for (const file of readdirSync("migrations-core")
    .filter((file) => file.endsWith(".sql") && file < migration)
    .sort()) {
    db.exec(readFileSync(`migrations-core/${file}`, "utf8"));
  }
  const seed = (first: number, last: number) => {
    db.exec(`WITH RECURSIVE ids(i) AS (SELECT ${first} UNION ALL SELECT i+1 FROM ids WHERE i<${last})
      INSERT INTO asset_dictionary(asset_id,asset) SELECT i,printf('ART%06d',i) FROM ids;
      INSERT INTO assets(asset_id) SELECT asset_id FROM asset_dictionary WHERE asset_id BETWEEN ${first} AND ${last};`);
  };
  seed(100, 6199);
  db.exec(readFileSync(`migrations-core/${migration}`, "utf8"));
  const binding = {
    prepare: (sql: string) => ({
      bind: (...params: number[]) => ({ all: async () => ({ results: db.prepare(sql).all(...params) }) }),
    }),
  } as unknown as D1Database;

  async function checkPages() {
    const catalog = db
      .prepare("SELECT d.asset FROM asset_dictionary d JOIN assets a USING(asset_id) ORDER BY d.asset")
      .all()
      .map((row) => row.asset);
    const ranges = db.prepare("SELECT SUM(members) AS total, MAX(members) AS largest FROM asset_page_ranges").get()!;
    assert.equal(ranges.total, catalog.length);
    assert.ok(Number(ranges.largest) <= 1024);
    for (const dir of ["asc", "desc"] as const) {
      const ordered = dir === "asc" ? catalog : [...catalog].reverse();
      for (const offset of [
        0,
        4095,
        4096,
        4097,
        4570,
        4608,
        catalog.length - 5,
        catalog.length,
        catalog.length + 100,
      ]) {
        const rows = await listCoreAssets(binding, { sort: "asset", dir, limit: 60, offset });
        assert.deepEqual(
          rows.map((row) => row.asset),
          ordered.slice(offset, offset + 60),
        );
      }
    }
  }
  await checkPages();
  seed(6200, 8000);
  db.exec(`DELETE FROM assets WHERE asset_id BETWEEN 612 AND 1123;
    DELETE FROM asset_dictionary WHERE asset_id=1311;
    UPDATE asset_dictionary SET asset='ZZLAST' WHERE asset_id=1320;
    UPDATE asset_dictionary SET asset_id=9999 WHERE asset_id=1250;
    UPDATE assets SET asset_id=9999 WHERE asset_id=1250;
    INSERT INTO assets(asset_id) VALUES (8888);
    INSERT INTO asset_dictionary(asset_id,asset) VALUES (8888,'AAFIRST');`);
  db.exec("BEGIN; DELETE FROM assets WHERE asset_id>1500; ROLLBACK;");
  await checkPages();
  db.close();
});
