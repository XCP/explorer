import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  enqueueCoreAddressSignals,
  rebuildCoreAddressSignals,
  runCoreAddressSignalsStep,
} from "#api/indexer/core-address-signals";
import { rebuildCoreAssetSignals, runCoreAssetSignalsStep } from "#api/indexer/core-asset-signals";

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
      // Mirror real D1: each statement's rows come back on `results` (the signals rebuild reads them).
      const results = [];
      for (const item of items) results.push(await item.all());
      return results;
    },
  }) as unknown as D1Database;

test("compact address signals recompute touched identities and converge to zero", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1trader'),('1peer');
    INSERT INTO asset_dictionary(asset) VALUES('CARD'),('OWNED');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(100,zeroblob(32),1);
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',(SELECT address_id FROM address_dictionary WHERE address='1trader'),0,0,50
      FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO assets(asset_id,type,issuer_id,owner_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',
        (SELECT address_id FROM address_dictionary WHERE address='1peer'),
        (SELECT address_id FROM address_dictionary WHERE address='1trader'),0,0,50
      FROM asset_dictionary WHERE asset='OWNED';
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
        `SELECT first_block,last_block,out_peers,assets_held,assets_controlled,dex_trades,btc_fees FROM address_signals
    WHERE address_id=(SELECT address_id FROM address_dictionary WHERE address='1trader')`,
      )
      .get(),
  });
  assert.deepEqual(row(), {
    first_block: 100,
    last_block: 100,
    out_peers: 1,
    assets_held: 1,
    assets_controlled: 2,
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
    assets_controlled: 2,
    dex_trades: 0,
    btc_fees: 0,
  });
});

test("a burn places both the burner and the burn address at the burn block", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  // Burns record only the source: the burn address is every burn's implicit destination, and its
  // first asset receipt came years later — first_block must come from the burn, not that send.
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1burner'),('1CounterpartyXXXXXXXXXXXXXXXUWLpVr'),('1sender');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(278310,zeroblob(32),1),(525585,randomblob(32),2);
    INSERT INTO burns(tx_index,tx_hash,block_index,source_id,burned,earned,status)
      SELECT 1,randomblob(32),278310,address_id,'100000000','150000000000','valid'
      FROM address_dictionary WHERE address='1burner';
    INSERT INTO sends(event_index,tx_index,tx_hash,block_index,source_id,destination_id,source_address_id,destination_address_id,asset_id,quantity,msg_index)
      SELECT 1,2,randomblob(32),525585,s.address_id,b.address_id,s.address_id,b.address_id,a.asset_id,'1',0
      FROM address_dictionary s,address_dictionary b,asset_dictionary a
      WHERE s.address='1sender' AND b.address='1CounterpartyXXXXXXXXXXXXXXXUWLpVr' AND a.asset='CARD';
  `);
  await rebuildCoreAddressSignals(d1(db), ["1burner", "1CounterpartyXXXXXXXXXXXXXXXUWLpVr", "1sender"]);
  const bounds = (address: string) => ({
    ...db
      .prepare(
        `SELECT first_block,last_block FROM address_signals
         WHERE address_id=(SELECT address_id FROM address_dictionary WHERE address=?)`,
      )
      .get(address),
  });
  assert.deepEqual(bounds("1burner"), { first_block: 278310, last_block: 278310 });
  assert.deepEqual(bounds("1CounterpartyXXXXXXXXXXXXXXXUWLpVr"), { first_block: 278310, last_block: 525585 });
  // Nobody else's burn is attributed to an unrelated address.
  assert.deepEqual(bounds("1sender"), { first_block: 525585, last_block: 525585 });
});

test("address signals attribute dispenser proceeds to origin or source exactly once", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1origin'),('1source'),('1buyer');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',(SELECT address_id FROM address_dictionary WHERE address='1source'),0,0,1
      FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO dispensers(tx_index,tx_hash,block_index,source_id,origin_id,asset_id)
      SELECT 1,randomblob(32),100,source.address_id,origin.address_id,asset.asset_id
      FROM address_dictionary source,address_dictionary origin,asset_dictionary asset
      WHERE source.address='1source' AND origin.address='1origin' AND asset.asset='CARD';
    INSERT INTO dispensers(tx_index,tx_hash,block_index,source_id,origin_id,asset_id)
      SELECT 2,randomblob(32),101,source.address_id,NULL,asset.asset_id
      FROM address_dictionary source,asset_dictionary asset
      WHERE source.address='1source' AND asset.asset='CARD';
    INSERT INTO dispenses(event_index,tx_index,dispense_index,tx_hash,dispenser_tx_index,source_id,destination_id,asset_id,btc_amount,block_index)
      SELECT 1,11,0,randomblob(32),1,source.address_id,buyer.address_id,asset.asset_id,'200000000',100
      FROM address_dictionary source,address_dictionary buyer,asset_dictionary asset
      WHERE source.address='1source' AND buyer.address='1buyer' AND asset.asset='CARD';
    INSERT INTO dispenses(event_index,tx_index,dispense_index,tx_hash,dispenser_tx_index,source_id,destination_id,asset_id,btc_amount,block_index)
      SELECT 2,12,0,randomblob(32),2,source.address_id,buyer.address_id,asset.asset_id,'300000000',101
      FROM address_dictionary source,address_dictionary buyer,asset_dictionary asset
      WHERE source.address='1source' AND buyer.address='1buyer' AND asset.asset='CARD';
  `);

  await rebuildCoreAddressSignals(d1(db), ["1origin", "1source"]);
  const rows = db
    .prepare(
      `SELECT address.address,signal.dispenses,signal.dispense_btc
       FROM address_signals signal JOIN address_dictionary address USING(address_id)
       WHERE address.address IN ('1origin','1source') ORDER BY address.address`,
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { address: "1origin", dispenses: 1, dispense_btc: 2 },
    { address: "1source", dispenses: 1, dispense_btc: 3 },
  ]);
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

test("queued address refreshes enqueue the assets currently held by that address", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1holder');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO assets(asset_id,type,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,1 FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT address.address_id,asset.asset_id,'1',1
      FROM address_dictionary address,asset_dictionary asset
      WHERE address.address='1holder' AND asset.asset='CARD';
  `);
  const core = d1(db);
  await enqueueCoreAddressSignals(core, ["1holder"]);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).processed, 1);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) count FROM asset_signal_dirty dirty
         JOIN asset_dictionary asset USING(asset_id) WHERE asset.asset='CARD'`,
      )
      .get()?.count,
    1,
  );

  db.exec(`DELETE FROM asset_signal_dirty`);
  await enqueueCoreAddressSignals(core, ["1holder"]);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).processed, 1);
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM asset_signal_dirty`).get()?.count,
    0,
    "an unchanged address projection does not create repeated asset work",
  );
});

test("address batches coalesce shared asset dependencies until the queue completes", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1holderA'),('1holderB');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO assets(asset_id,type,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,1 FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT address.address_id,asset.asset_id,'1',1
      FROM address_dictionary address,asset_dictionary asset
      WHERE address.address IN ('1holderA','1holderB') AND asset.asset='CARD';
    INSERT INTO asset_signals(asset_id)
      SELECT asset_id FROM asset_dictionary WHERE asset='CARD';
  `);
  const core = d1(db);
  await enqueueCoreAddressSignals(core, ["1holderA", "1holderB"]);

  assert.equal((await runCoreAddressSignalsStep(core, 1)).queueRemaining, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signal_dirty`).get()?.count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_holder_signal_dirty`).get()?.count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signal_dependency_dirty`).get()?.count, 1);

  assert.equal((await runCoreAddressSignalsStep(core, 1)).queueRemaining, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signal_dependency_dirty`).get()?.count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signal_dirty`).get()?.count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_holder_signal_dirty`).get()?.count, 1);
});

test("a removed holding still repairs its asset after the address projection changes", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1holder');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO assets(asset_id,type,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,1 FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT address.address_id,asset.asset_id,'1',1
      FROM address_dictionary address,asset_dictionary asset
      WHERE address.address='1holder' AND asset.asset='CARD';
  `);
  const core = d1(db);
  await rebuildCoreAddressSignals(core, ["1holder"]);
  db.exec(`DELETE FROM balances; DELETE FROM asset_signal_dirty`);

  await enqueueCoreAddressSignals(core, ["1holder"], ["CARD"]);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).queueRemaining, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signal_dirty`).get()?.count, 1);
});

test("an economic-only address change does not re-derive the assets that address holds", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1spender'),('1peerA'),('1peerB');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO assets(asset_id,type,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,1 FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT address.address_id,asset.asset_id,'1',1
      FROM address_dictionary address,asset_dictionary asset
      WHERE address.address IN ('1spender','1peerA','1peerB') AND asset.asset='CARD';
    INSERT INTO asset_signals(asset_id) SELECT asset_id FROM asset_dictionary WHERE asset='CARD';
    INSERT INTO transactions(tx_index,tx_hash,block_index,block_time,source_id,supported)
      SELECT 1,zeroblob(32),1,1,address_id,1 FROM address_dictionary WHERE address='1spender';
  `);
  const core = d1(db);
  await enqueueCoreAddressSignals(core, ["1spender"]);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).processed, 1);
  db.exec(`DELETE FROM asset_holder_signal_dirty; DELETE FROM asset_signal_dirty;`);

  // btc_fees is derived from transactions.fee, and the holder projection never reads it. Filling the
  // Bitcoin-fee backfill therefore has to leave the asset's holder derivation alone.
  db.exec(`UPDATE transactions SET fee='50000' WHERE tx_index=1`);
  await enqueueCoreAddressSignals(core, ["1spender"]);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).processed, 1);
  assert.equal(
    db.prepare(`SELECT btc_fees FROM address_signals`).get()?.btc_fees,
    0.0005,
    "the address projection itself still records the new fee",
  );
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signal_dependency_dirty`).get()?.count, 0);
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM asset_holder_signal_dirty`).get()?.count,
    0,
    "an economic-only change must not fan out to held assets",
  );

  // dex_trades feeds avg_holder_dex, so moving it must still fan out to the assets still held.
  db.exec(`
    INSERT INTO order_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,block_index)
      SELECT 1,2,zeroblob(32),zeroblob(32),address_id,1
      FROM address_dictionary WHERE address='1spender';
  `);
  await enqueueCoreAddressSignals(core, ["1spender"]);
  assert.equal((await runCoreAddressSignalsStep(core, 10)).processed, 1);
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM asset_holder_signal_dirty`).get()?.count,
    1,
    "dex_trades is a holder-projection input, so its change still fans out",
  );
});

test("community-only address changes skip small holder sets without suppressing real changes", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address_id,address)
      VALUES(20,'1holder'),(21,'1peerA'),(22,'1peerB'),(23,'1zero');
    INSERT INTO asset_dictionary(asset) VALUES('SINGLE'),('PAIR'),('COMMUNITY'),('UTXO');
    INSERT INTO assets(asset_id,type,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,1 FROM asset_dictionary WHERE asset NOT IN ('BTC','XCP');
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT 20,asset_id,'1',1 FROM assets;
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT 21,asset_id,'1',1 FROM asset_dictionary WHERE asset IN ('PAIR','COMMUNITY');
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT 22,asset_id,'1',1 FROM asset_dictionary WHERE asset='COMMUNITY';
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT 23,asset_id,'0',1 FROM assets;
    INSERT INTO balances(utxo_tx_hash,utxo_vout,asset_id,quantity,updated_event_index)
      SELECT zeroblob(32),0,asset_id,'1',1 FROM asset_dictionary WHERE asset='UTXO';
    INSERT INTO balances(utxo_tx_hash,utxo_vout,asset_id,quantity,updated_event_index)
      SELECT zeroblob(32),1,asset_id,'1',1 FROM asset_dictionary WHERE asset='UTXO';
  `);
  const core = d1(db);
  const assets = ["SINGLE", "PAIR", "COMMUNITY", "UTXO"];
  await rebuildCoreAddressSignals(core, ["1holder", "1peerA", "1peerB"]);
  await rebuildCoreAssetSignals(core, assets);
  const before = db.prepare(`SELECT * FROM asset_signals ORDER BY asset_id`).all();
  db.exec(`INSERT INTO order_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,block_index)
    VALUES(1,2,zeroblob(32),zeroblob(32),20,1)`);
  await enqueueCoreAddressSignals(core, ["1holder"]);
  await runCoreAddressSignalsStep(core, 10);
  assert.deepEqual(
    db
      .prepare(`SELECT asset FROM asset_holder_signal_dirty JOIN asset_dictionary USING(asset_id)`)
      .all()
      .map((row) => row.asset),
    ["COMMUNITY"],
    "zero and UTXO balances do not count toward the three-address threshold",
  );
  await runCoreAssetSignalsStep(core, 10);
  const after = db.prepare(`SELECT * FROM asset_signals ORDER BY asset_id`).all();
  assert.equal(
    db
      .prepare(
        `SELECT avg_holder_dex FROM asset_signals JOIN asset_dictionary USING(asset_id)
      WHERE asset='COMMUNITY'`,
      )
      .get()?.avg_holder_dex,
    1 / 3,
  );
  assert.deepEqual(
    after.filter((row) => row.avg_holder_dex === 0),
    before.filter((row) => row.asset_id !== after.find((item) => item.avg_holder_dex !== 0)?.asset_id),
    "single-holder, two-holder and UTXO assets are unchanged",
  );
  await rebuildCoreAssetSignals(core, assets);
  assert.deepEqual(db.prepare(`SELECT * FROM asset_signals ORDER BY asset_id`).all(), after);

  // Crossing the threshold must still work in both directions. Named event dependencies preserve
  // the asset even if the address losing its last unit is absent from its current balance rows.
  db.exec(`INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
    SELECT 22,asset_id,'1',2 FROM asset_dictionary WHERE asset='PAIR'`);
  await enqueueCoreAddressSignals(core, ["1peerB"], ["PAIR"]);
  await runCoreAddressSignalsStep(core, 10);
  await runCoreAssetSignalsStep(core, 10);
  assert.equal(
    db
      .prepare(
        `SELECT avg_holder_dex FROM asset_signals JOIN asset_dictionary USING(asset_id)
    WHERE asset='PAIR'`,
      )
      .get()?.avg_holder_dex,
    1 / 3,
  );
  db.exec(`DELETE FROM balances WHERE address_id=22
    AND asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='PAIR')`);
  await enqueueCoreAddressSignals(core, ["1peerB"], ["PAIR"]);
  await runCoreAddressSignalsStep(core, 10);
  await runCoreAssetSignalsStep(core, 10);
  assert.equal(
    db
      .prepare(
        `SELECT avg_holder_dex FROM asset_signals JOIN asset_dictionary USING(asset_id)
    WHERE asset='PAIR'`,
      )
      .get()?.avg_holder_dex,
    0,
  );

  // Burn classification affects holder counts and quantities at every cardinality.
  db.exec(`INSERT INTO curated(kind,key) VALUES('burn','1holder')`);
  await enqueueCoreAddressSignals(core, ["1holder"]);
  await runCoreAddressSignalsStep(core, 10);
  assert.equal(db.prepare(`SELECT count(*) n FROM asset_holder_signal_dirty`).get()?.n, 4);
  await runCoreAssetSignalsStep(core, 10);
  assert.equal(
    db
      .prepare(
        `SELECT holders FROM asset_signals JOIN asset_dictionary USING(asset_id)
    WHERE asset='SINGLE'`,
      )
      .get()?.holders,
    0,
  );
  const burned = db.prepare(`SELECT * FROM asset_signals ORDER BY asset_id`).all();
  await rebuildCoreAssetSignals(core, assets);
  assert.deepEqual(db.prepare(`SELECT * FROM asset_signals ORDER BY asset_id`).all(), burned);

  // Creator participation is a boolean input. A second surviving creation changes the address
  // reputation but cannot change whether that address is a creator in its held communities.
  db.exec(`INSERT INTO asset_dictionary(asset) VALUES('CREATED1');
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',20,0,0,1 FROM asset_dictionary WHERE asset='CREATED1';
    INSERT INTO asset_signals(asset_id,holders)
      SELECT asset_id,10 FROM asset_dictionary WHERE asset='CREATED1'`);
  await rebuildCoreAddressSignals(core, ["1holder"]);
  db.exec(`INSERT INTO asset_dictionary(asset) VALUES('CREATED2');
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',20,0,0,1 FROM asset_dictionary WHERE asset='CREATED2';
    INSERT INTO asset_signals(asset_id,holders)
      SELECT asset_id,10 FROM asset_dictionary WHERE asset='CREATED2'`);
  await enqueueCoreAddressSignals(core, ["1holder"]);
  await runCoreAddressSignalsStep(core, 10);
  assert.equal(db.prepare(`SELECT survived_assets FROM address_signals WHERE address_id=20`).get()?.survived_assets, 2);
  assert.equal(db.prepare(`SELECT count(*) n FROM asset_holder_signal_dirty`).get()?.n, 0);
  assert.equal(db.prepare(`SELECT count(*) n FROM asset_signal_dependency_dirty`).get()?.n, 0);

  // A missing projection is repaired even for a small holder set.
  db.exec(`DELETE FROM asset_signals WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='SINGLE');
    INSERT INTO order_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,tx0_address_id,block_index)
      VALUES(3,4,zeroblob(32),zeroblob(32),20,1)`);
  await enqueueCoreAddressSignals(core, ["1holder"]);
  await runCoreAddressSignalsStep(core, 10);
  assert.equal(db.prepare(`SELECT count(*) n FROM asset_signal_dirty`).get()?.n, 1);
  await runCoreAssetSignalsStep(core, 10);
  assert.equal(
    db
      .prepare(
        `SELECT holders FROM asset_signals JOIN asset_dictionary USING(asset_id)
    WHERE asset='SINGLE'`,
      )
      .get()?.holders,
    0,
  );
});
