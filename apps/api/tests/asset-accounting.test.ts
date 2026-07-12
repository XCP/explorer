import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

test("combined asset accounting preserves exact int64 values and matches all four aggregates", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE balances (asset TEXT, holder TEXT, quantity TEXT);
    CREATE TABLE address_signals (address TEXT PRIMARY KEY, is_burn INTEGER);
    CREATE TABLE issuances (asset TEXT, quantity TEXT, status TEXT);
    CREATE TABLE destructions (asset TEXT, quantity TEXT, status TEXT);
    CREATE TABLE dispensers (asset TEXT, give_remaining TEXT, status INTEGER);
    CREATE TABLE orders (give_asset TEXT, give_remaining TEXT, status TEXT);
    INSERT INTO address_signals VALUES ('holder',0),('burn',1);
    INSERT INTO balances VALUES ('BIG','holder','9007199254740993'),('BIG','burn','7'),('BIG','zero','0');
    INSERT INTO issuances VALUES ('BIG','9007199254741000','valid');
    INSERT INTO destructions VALUES ('BIG','3','valid');
    INSERT INTO dispensers VALUES ('BIG','11',0),('BIG','99',1);
    INSERT INTO orders VALUES ('BIG','13','open'),('BIG','88','filled');
  `);
  const row = db.prepare(`SELECT
    (SELECT COUNT(*) FROM balances WHERE asset=?1 AND CAST(quantity AS INTEGER)>0) holder_count,
    CAST((SELECT SUM(CAST(quantity AS INTEGER)) FROM issuances WHERE asset=?1 AND status LIKE 'valid%')
       - (SELECT SUM(CAST(quantity AS INTEGER)) FROM destructions WHERE asset=?1 AND status LIKE 'valid%') AS TEXT) supply,
    CAST((SELECT SUM(CAST(b.quantity AS INTEGER)) FROM balances b JOIN address_signals s ON s.address=b.holder
      WHERE b.asset=?1 AND s.is_burn=1) AS TEXT) burned,
    CAST((SELECT SUM(CAST(give_remaining AS INTEGER)) FROM dispensers WHERE asset=?1 AND status=0)
       + (SELECT SUM(CAST(give_remaining AS INTEGER)) FROM orders WHERE give_asset=?1 AND status='open') AS TEXT) escrow`).get("BIG") as Record<string, number | string>;
  assert.equal(row.holder_count, 2);
  assert.equal(row.supply, "9007199254740997");
  assert.equal(row.burned, "7");
  assert.equal(row.escrow, "24");
});
