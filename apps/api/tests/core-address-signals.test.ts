import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { rebuildCoreAddressSignals, runCoreAddressSignalsStep } from "#api/indexer/core-address-signals";

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));
class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { rows_written: Number(result.changes) } };
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}
const d1 = (db: DatabaseSync) =>
  ({
    prepare: (sql: string) => new Statement(db, sql),
    async batch(items: Statement[]) {
      for (const item of items) await item.run();
      return [];
    },
  }) as unknown as D1Database;

test("compact address signals recompute touched identities and converge to zero", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1trader'),('1peer');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(100,zeroblob(32),1);
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',(SELECT address_id FROM address_dictionary WHERE address='1trader'),0,0,50
      FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO sends(event_index,tx_index,tx_hash,block_index,source_id,destination_id,source_address_id,destination_address_id,asset_id,quantity,msg_index)
      SELECT 1,1,randomblob(32),100,t.address_id,p.address_id,t.address_id,p.address_id,a.asset_id,'1',0
      FROM address_dictionary t,address_dictionary p,asset_dictionary a WHERE t.address='1trader' AND p.address='1peer' AND a.asset='CARD';
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT t.address_id,a.asset_id,'1',1 FROM address_dictionary t,asset_dictionary a WHERE t.address='1trader' AND a.asset='CARD';
    INSERT INTO transactions(tx_index,tx_hash,block_index,source_id,fee) SELECT 2,randomblob(32),100,address_id,'1000' FROM address_dictionary WHERE address='1trader';
    INSERT INTO order_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,tx1_address_id,forward_asset_id,forward_quantity,backward_asset_id,backward_quantity,block_index)
      SELECT 3,4,randomblob(32),randomblob(32),t.address_id,p.address_id,a.asset_id,'1',x.asset_id,'1',100
      FROM address_dictionary t,address_dictionary p,asset_dictionary a,asset_dictionary x
      WHERE t.address='1trader' AND p.address='1peer' AND a.asset='CARD' AND x.asset='XCP';
  `);
  await rebuildCoreAddressSignals(d1(db), ["1trader", "1trader"]);
  const row = () => ({
    ...db
      .prepare(
        `SELECT first_block,last_block,out_peers,assets_held,dex_trades,btc_fees FROM address_signals
    WHERE address_id=(SELECT address_id FROM address_dictionary WHERE address='1trader')`,
      )
      .get(),
  });
  assert.deepEqual(row(), {
    first_block: 100,
    last_block: 100,
    out_peers: 1,
    assets_held: 1,
    dex_trades: 1,
    btc_fees: 0.00001,
  });
  db.exec(`DELETE FROM sends; DELETE FROM balances; DELETE FROM order_matches; DELETE FROM transactions;`);
  await rebuildCoreAddressSignals(d1(db), ["1trader"]);
  assert.deepEqual(row(), {
    first_block: null,
    last_block: 0,
    out_peers: 0,
    assets_held: 0,
    dex_trades: 0,
    btc_fees: 0,
  });
});

test("full address repair pauses after coverage while forced repair remains available", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(200,zeroblob(32),1);
    INSERT INTO address_dictionary(address) VALUES('1one'),('1two');
  `);
  const core = d1(db);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).processed, 2);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).cycleComplete, true);
  assert.deepEqual(await runCoreAddressSignalsStep(core, 10), { processed: 0, cursor: 0, cycleComplete: true });
  assert.equal(db.prepare(`SELECT value FROM core_state WHERE key='address_signals_cycles'`).get()?.value, "1");
  assert.equal((await runCoreAddressSignalsStep(core, 10, true)).processed, 2);
});

test("address signals exclude polymorphic UTXO balance locations", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`INSERT INTO address_dictionary(address) VALUES(''),('abcd:0'),('0x1234'),('1BitcoinAddress');`);
  const result = await runCoreAddressSignalsStep(d1(db), 10);
  assert.equal(result.processed, 1);
  const addresses = db
    .prepare(`SELECT address FROM address_signals JOIN address_dictionary USING(address_id)`)
    .all()
    .map((row) => row.address);
  assert.deepEqual(addresses, ["1BitcoinAddress"]);
});
