import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { BUILD_EXCHANGE_TOP_ASSETS_SQL } from "#api/indexer/exchange-top-assets";

const READ_SQL = `SELECT asset.asset, asset.asset_longname, top.depositors
  FROM exchange_top_assets top JOIN asset_dictionary asset ON asset.asset_id=top.asset_id
  WHERE generation=CAST((SELECT value FROM core_state WHERE key='exchange_top_assets_generation') AS INTEGER)
  ORDER BY depositors DESC, asset.asset ASC`;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sends(asset_id INTEGER, source_id INTEGER, destination_id INTEGER);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY, is_exchange INTEGER NOT NULL);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY, asset TEXT, asset_longname TEXT);
    CREATE TABLE core_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE exchange_top_assets(
      generation INTEGER NOT NULL, asset_id INTEGER NOT NULL, depositors INTEGER NOT NULL,
      PRIMARY KEY(generation, asset_id)
    ) WITHOUT ROWID;
    CREATE INDEX idx_exchange_top_assets_rank ON exchange_top_assets(generation, depositors DESC, asset_id);
    INSERT INTO core_state VALUES ('exchange_top_assets_generation','0');
    INSERT INTO address_signals VALUES (10,1),(11,1),(12,0);
    INSERT INTO asset_dictionary VALUES (1,'A','A.long'),(2,'B',NULL),(3,'C',NULL);
    INSERT INTO sends VALUES
      (1,20,10),(1,20,11),(1,21,10),
      (2,22,10),(2,23,12),(3,20,11);
  `);
  return db;
}

test("exchange leaderboard counts distinct depositors and publishes generations atomically", () => {
  const db = fixture();
  db.prepare(BUILD_EXCHANGE_TOP_ASSETS_SQL).run(1);
  assert.deepEqual(
    db
      .prepare(
        `SELECT asset.asset,top.depositors FROM exchange_top_assets top
        JOIN asset_dictionary asset ON asset.asset_id=top.asset_id
        WHERE generation=1 ORDER BY depositors DESC,asset.asset`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { asset: "A", depositors: 2 },
      { asset: "B", depositors: 1 },
      { asset: "C", depositors: 1 },
    ],
  );
  assert.deepEqual(db.prepare(READ_SQL).all(), []);
  db.prepare(`UPDATE core_state SET value='1' WHERE key='exchange_top_assets_generation'`).run();
  assert.equal(db.prepare(READ_SQL).all().length, 3);

  db.prepare(`INSERT INTO sends VALUES (2,24,11)`).run();
  db.prepare(BUILD_EXCHANGE_TOP_ASSETS_SQL).run(2);
  assert.equal((db.prepare(READ_SQL).get() as { asset: string }).asset, "A");
  db.prepare(`UPDATE core_state SET value='2' WHERE key='exchange_top_assets_generation'`).run();
  assert.deepEqual(
    db
      .prepare(READ_SQL)
      .all()
      .slice(0, 2)
      .map((row) => ({ ...row })),
    [
      { asset: "A", asset_longname: "A.long", depositors: 2 },
      { asset: "B", asset_longname: null, depositors: 2 },
    ],
  );
});

test("exchange leaderboard read uses only compact indexes", () => {
  const db = fixture();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL}`).all() as { detail: string }[];
  const details = plan.map((row) => row.detail).join("\n");
  assert.match(details, /idx_exchange_top_assets_rank|PRIMARY KEY/);
  assert.equal(/SCAN sends|SCAN address_signals/.test(details), false, details);
});
