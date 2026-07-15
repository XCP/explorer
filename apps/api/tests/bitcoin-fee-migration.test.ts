import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const migration = readFileSync("migrations-core/0034_finalize_bitcoin_transaction_fees.sql", "utf8");

test("fee finalization replaces legacy values and maintains projections", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE transactions(
      tx_index INTEGER PRIMARY KEY, tx_hash BLOB NOT NULL, block_time INTEGER,
      fee TEXT, bitcoin_fee TEXT
    );
    CREATE INDEX idx_transactions_missing_bitcoin_fee ON transactions(tx_index DESC) WHERE bitcoin_fee IS NULL;
    CREATE TABLE daily_metrics(day INTEGER PRIMARY KEY, btc_fees REAL);
    CREATE TABLE network_stats_snapshot(
      singleton INTEGER PRIMARY KEY, transactions INTEGER NOT NULL DEFAULT 0,
      btc_fees REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO network_stats_snapshot(singleton,transactions) VALUES(1,2);
    INSERT INTO core_state VALUES('address_signals_cursor','99');
    CREATE TRIGGER daily_transactions_insert AFTER INSERT ON transactions BEGIN SELECT 1; END;
    CREATE TRIGGER daily_transactions_delete AFTER DELETE ON transactions BEGIN SELECT 1; END;
    CREATE TRIGGER stats_transactions_insert AFTER INSERT ON transactions BEGIN SELECT 1; END;
    CREATE TRIGGER stats_transactions_delete AFTER DELETE ON transactions BEGIN SELECT 1; END;
    INSERT INTO transactions VALUES(1,x'01',86400,'19388665','46970');
    INSERT INTO transactions VALUES(2,x'02',86400,'100000000','50000');
  `);

  db.exec(migration);

  assert.deepEqual(
    db
      .prepare("SELECT tx_index,fee FROM transactions ORDER BY tx_index")
      .all()
      .map((row) => ({ ...row })),
    [
      { tx_index: 1, fee: "46970" },
      { tx_index: 2, fee: "50000" },
    ],
  );
  assert.throws(() => db.prepare("SELECT bitcoin_fee FROM transactions").get(), /no such column/);
  assert.equal(
    (db.prepare("SELECT btc_fees FROM network_stats_snapshot WHERE singleton=1").get() as { btc_fees: number })
      .btc_fees,
    0.0009697,
  );
  assert.equal(
    (db.prepare("SELECT btc_fees FROM daily_metrics WHERE day=1").get() as { btc_fees: number }).btc_fees,
    0.0009697,
  );
  assert.equal(
    (db.prepare("SELECT value FROM core_state WHERE key='address_signals_cursor'").get() as { value: string }).value,
    "0",
  );

  db.prepare("UPDATE transactions SET fee='60000' WHERE tx_index=2").run();
  assert.equal(
    (db.prepare("SELECT btc_fees FROM network_stats_snapshot WHERE singleton=1").get() as { btc_fees: number })
      .btc_fees,
    0.0010697,
  );
  assert.equal(
    (db.prepare("SELECT btc_fees FROM daily_metrics WHERE day=1").get() as { btc_fees: number }).btc_fees,
    0.0010697,
  );
});
