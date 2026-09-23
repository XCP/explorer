import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { dispenseAccountingSql } from "#api/indexer/dispense-accounting";
import { DISPENSE_TRADES_SQL } from "#api/indexer/trades";

function fixture(beforeMigration = false) {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations-core")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (beforeMigration && name.startsWith("0099_")) continue;
    db.exec(readFileSync(`migrations-core/${name}`, "utf8"));
  }
  db.exec(`INSERT INTO address_dictionary(address_id,address) VALUES(1000001,'1seller'),(1000002,'1buyer');`);
  let next = 1000000;
  function add(tx: number, index: number, asset: string, payment = 2000000, rate: number | null = 2000000, qty = 1) {
    db.prepare("INSERT INTO asset_dictionary(asset) VALUES(?) ON CONFLICT(asset) DO NOTHING").run(asset);
    const id = Number(db.prepare("SELECT asset_id FROM asset_dictionary WHERE asset=?").get(asset)?.asset_id);
    const event = ++next;
    db.prepare(
      `INSERT INTO transactions(tx_index,tx_hash,block_index,block_time)
      VALUES(?,randomblob(32),1,1789593673) ON CONFLICT(tx_index) DO NOTHING`,
    ).run(tx);
    if (rate !== null)
      db.prepare(
        `INSERT INTO dispensers(tx_index,tx_hash,asset_id,source_id,give_quantity,satoshirate,block_index)
      VALUES(?,randomblob(32),?,1000001,'1',?,1)`,
      ).run(event, id, String(rate));
    db.prepare(
      `INSERT INTO dispenses(event_index,tx_index,dispense_index,tx_hash,dispenser_tx_index,
      asset_id,source_id,destination_id,dispense_quantity,dispense_quantity_normalized,btc_amount,block_index,block_time)
      SELECT ?,?,?,tx_hash,?,?,1000001,1000002,?,?,?,1,1789593673 FROM transactions WHERE tx_index=?`,
    ).run(event, tx, index, event, id, String(qty), String(qty), String(payment), tx);
    return id;
  }
  const total = (tx: number) =>
    Number(db.prepare("SELECT SUM(quote_sats) value FROM dispenses WHERE tx_index=?").get(tx)?.value);
  return { db, add, total };
}

test("151 Pokemon legs share one payment in asset allocations and the sales ledger", () => {
  const { db, add, total } = fixture();
  for (let i = 0; i < 151; i++) add(1, i, `POKEMON${String(i).padStart(3, "0")}`);
  db.exec(dispenseAccountingSql());
  assert.ok(Math.abs(total(1) - 2000000) < 0.000001);
  assert.equal(db.prepare("SELECT MIN(payment_asset_count) n FROM dispenses").get()?.n, 151);
  assert.equal(db.prepare("SELECT SUM(CAST(btc_amount AS REAL)) n FROM dispenses").get()?.n, 302000000);
  db.prepare(DISPENSE_TRADES_SQL).run(0, 2);
  assert.ok(
    Math.abs(Number(db.prepare("SELECT total FROM trades WHERE venue='dispense'").get()?.total) - 0.02) < 1e-12,
  );
  db.exec(dispenseAccountingSql());
  assert.ok(Math.abs(total(1) - 2000000) < 0.000001);
  db.close();
});

test("repeated same-seller outputs, depletion and overpayment preserve separate payment caps", () => {
  const { db, add, total } = fixture();
  add(1, 0, "AAA");
  add(1, 1, "BBB");
  add(1, 2, "AAA");
  add(1, 3, "BBB");
  add(1, 4, "BBB");
  add(2, 0, "XCP", 495000, 5000, 31);
  add(3, 0, "CCC", 2000000, null);
  add(3, 1, "DDD", 2000000, null);
  db.exec(dispenseAccountingSql());
  assert.equal(total(1), 6000000);
  assert.equal(total(2), 155000);
  assert.equal(total(3), 2000000);
  db.prepare(DISPENSE_TRADES_SQL).run(0, 2);
  assert.equal(
    db.prepare("SELECT total FROM trades WHERE venue='dispense' AND ref LIKE '%:e1000001'").get()?.total,
    0.06,
  );
  db.close();
});

test("a late sibling reprices earlier pages and only scans the selected transaction", () => {
  const { db, add, total } = fixture();
  add(1, 0, "AAA");
  db.prepare(dispenseAccountingSql("d.tx_index=?")).run(1);
  assert.equal(total(1), 2000000);
  add(1, 1, "BBB");
  add(2, 0, "CCC");
  db.prepare(dispenseAccountingSql("d.tx_index=?")).run(1);
  assert.equal(total(1), 2000000);
  assert.equal(total(2), 0);
  assert.equal(db.prepare("SELECT MIN(quote_sats) n FROM dispenses WHERE tx_index=1").get()?.n, 1000000);
  db.close();
});

test("migration corrects historical seller, buyer and asset money and queues dependent rebuilds", () => {
  const { db, add, total } = fixture(true);
  const a = add(1, 0, "AAA");
  const b = add(1, 1, "BBB");
  db.prepare(
    "INSERT INTO asset_signals(asset_id,dispense_btc,max_dispense_btc,max_dispense_btc_clean) VALUES(?,0.02,0.02,0.02),(?,0.02,0.02,0.02)",
  ).run(a, b);
  db.exec(`INSERT INTO address_signals(address_id,dispense_btc,btc_spent) VALUES(1000001,0.04,0),(1000002,0,0.04);
    INSERT INTO core_state(key,value) VALUES('prices_synced_blk','100'),('usd_cur','999');`);
  const sql = readFileSync("migrations-core/0099_dispense_payment_allocation.sql", "utf8");
  assert.ok(sql.replace(/\s+/g, "").includes(dispenseAccountingSql().replace(/\s+/g, "")));
  db.exec(sql);
  assert.equal(total(1), 2000000);
  assert.equal(db.prepare("SELECT SUM(dispense_btc) n FROM asset_signals WHERE asset_id IN (?,?)").get(a, b)?.n, 0.02);
  assert.equal(db.prepare("SELECT dispense_btc n FROM address_signals WHERE address_id=1000001").get()?.n, 0.02);
  assert.equal(db.prepare("SELECT btc_spent n FROM address_signals WHERE address_id=1000002").get()?.n, 0.02);
  assert.equal(
    db.prepare("SELECT count(*) n FROM core_state WHERE key IN ('prices_synced_blk','usd_cur')").get()?.n,
    0,
  );
  db.close();
});
