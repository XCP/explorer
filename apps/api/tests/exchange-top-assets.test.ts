import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { BUILD_EXCHANGE_TOP_ASSETS_SQL } from "#api/indexer/exchange-top-assets";

const READ_SQL = `SELECT asset, asset_longname, depositors
  FROM exchange_top_assets
  WHERE generation=CAST((SELECT value FROM indexer_state WHERE key='exchange_top_assets_generation') AS INTEGER)
  ORDER BY depositors DESC, asset ASC`;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sends(asset TEXT, source TEXT, destination TEXT);
    CREATE TABLE address_signals(address TEXT PRIMARY KEY, is_exchange INTEGER NOT NULL);
    CREATE TABLE assets(asset TEXT PRIMARY KEY, asset_longname TEXT);
    CREATE TABLE indexer_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE exchange_top_assets(
      generation INTEGER NOT NULL, asset TEXT NOT NULL, asset_longname TEXT, depositors INTEGER NOT NULL,
      PRIMARY KEY(generation, asset)
    ) WITHOUT ROWID;
    CREATE INDEX idx_exchange_top_assets_rank ON exchange_top_assets(generation, depositors DESC, asset);
    INSERT INTO indexer_state VALUES ('exchange_top_assets_generation','0');
    INSERT INTO address_signals VALUES ('cex-a',1),('cex-b',1),('user',0);
    INSERT INTO assets VALUES ('A','A.long'),('B',NULL),('C',NULL);
    INSERT INTO sends VALUES
      ('A','alice','cex-a'),('A','alice','cex-b'),('A','bob','cex-a'),
      ('B','carol','cex-a'),('B','dave','user'),('C','alice','cex-b');
  `);
  return db;
}

test("exchange leaderboard counts distinct depositors and publishes generations atomically", () => {
  const db = fixture();
  db.prepare(BUILD_EXCHANGE_TOP_ASSETS_SQL).run(1);
  assert.deepEqual(
    db
      .prepare(`SELECT asset,depositors FROM exchange_top_assets WHERE generation=1 ORDER BY depositors DESC,asset`)
      .all()
      .map((row) => ({ ...row })),
    [
      { asset: "A", depositors: 2 },
      { asset: "B", depositors: 1 },
      { asset: "C", depositors: 1 },
    ],
  );
  assert.deepEqual(db.prepare(READ_SQL).all(), []);
  db.prepare(`UPDATE indexer_state SET value='1' WHERE key='exchange_top_assets_generation'`).run();
  assert.equal(db.prepare(READ_SQL).all().length, 3);

  db.prepare(`INSERT INTO sends VALUES ('B','erin','cex-b')`).run();
  db.prepare(BUILD_EXCHANGE_TOP_ASSETS_SQL).run(2);
  assert.equal((db.prepare(READ_SQL).get() as { asset: string }).asset, "A");
  db.prepare(`UPDATE indexer_state SET value='2' WHERE key='exchange_top_assets_generation'`).run();
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
