import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { rebuildCoreAssetSignals, runCoreAssetSignalsStep } from "#api/indexer/core-asset-signals";
import { coreAssetAccounting, coreAssetSignals } from "#api/queries/core-assets";

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
    this.db.prepare(this.sql).run(...this.values);
    return { success: true };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
}

function d1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

test("compact asset signals refresh volatile fields from canonical relations", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO asset_dictionary(asset) VALUES('A');
    INSERT INTO address_dictionary(address_id,address) VALUES(10,'holder'),(11,'burn');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(200,zeroblob(32),1);
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,supply,supply_normalized,first_issuance_block_index)
      VALUES((SELECT asset_id FROM asset_dictionary WHERE asset='A'),'asset',10,0,1,'100','100',100);
    INSERT INTO address_signals(address_id,is_burn) VALUES(10,0),(11,1);
    INSERT INTO balances(balance_id,address_id,asset_id,quantity,updated_event_index)
      VALUES(1,10,(SELECT asset_id FROM asset_dictionary WHERE asset='A'),'60',1),
            (2,11,(SELECT asset_id FROM asset_dictionary WHERE asset='A'),'40',1);
  `);

  assert.equal(await rebuildCoreAssetSignals(d1(db), ["A", "A"]), 1);
  const row = {
    ...(db
      .prepare(
        `SELECT holders,top1_pct,burned_pct,age_blocks,trades,dispenses FROM asset_signals
        WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='A')`,
      )
      .get() as Record<string, number>),
  };
  assert.deepEqual(row, {
    holders: 1,
    top1_pct: 100,
    burned_pct: 40,
    age_blocks: 100,
    trades: 0,
    dispenses: 0,
  });

  db.exec(`INSERT INTO blocks(block_index,block_hash,block_time) VALUES(201,randomblob(32),2)`);
  db.exec(
    `UPDATE asset_signals SET holders=0,top1_pct=0,burned_pct=0 WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='A')`,
  );
  const projected = await coreAssetSignals(d1(db), "A");
  assert.equal(projected?.holder_count, 0);
  assert.equal(projected?.top1_pct, 0);
  assert.equal(projected?.burned_pct, 0);
  db.exec(`INSERT INTO asset_holder_signal_dirty(asset_id)
    SELECT asset_id FROM asset_dictionary WHERE asset='A'`);
  await runCoreAssetSignalsStep(d1(db), 10);
  const fresh = await coreAssetSignals(d1(db), "A");
  assert.equal(fresh?.holder_count, 1);
  assert.equal(fresh?.holders, 1);
  assert.equal(fresh?.top1_pct, 100);
  assert.equal(fresh?.burned_pct, 40);
  assert.equal(fresh?.age_blocks, 101);
  assert.equal(fresh?.recency_blocks, 201);
  assert.deepEqual({ ...(await coreAssetAccounting(d1(db), "A")) }, { supply: "100", burned: "40", escrow: "0" });
});

test("market evidence requires an attributable asset, independent buyer, and single-asset sale", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO asset_dictionary(asset) VALUES('A');
    INSERT INTO address_dictionary(address_id,address)
      VALUES(10,'issuer'),(20,'buyer-one'),(21,'seller'),(22,'buyer-two');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(200,zeroblob(32),1);
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,supply_normalized,first_issuance_block_index)
      VALUES((SELECT asset_id FROM asset_dictionary WHERE asset='A'),'asset',10,0,1,'100',100);
    INSERT INTO trades(venue,ref,asset_id,block_time,quantity,currency,total,usd_value,buyer_id,seller_id,sale_class)
      VALUES
      ('dex','clean-dex',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1704067200,1,'XCP',10,20,20,21,NULL),
      ('dex','self-dex',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1706745600,1,'XCP',10,900,20,20,NULL),
      ('dispense','clean-dispense',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1706745600,1,'BTC',0.1,30,22,21,'single'),
      ('dispense','bundle',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1709251200,1,'BTC',0.1,800,22,21,'bundle'),
      ('emblem','clean-emblem',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1709251200,1,'ETH',1,50,20,21,'real'),
      ('emblem','shell',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1711929600,1,'ETH',1,700,22,21,'scam_cracked'),
      ('scarce.city','unknown',(SELECT asset_id FROM asset_dictionary WHERE asset='A'),1714521600,1,'BTC',0.1,600,NULL,NULL,NULL);
  `);

  await rebuildCoreAssetSignals(d1(db), ["A"]);
  assert.deepEqual(
    {
      ...(db
        .prepare(
          `SELECT clean_realized_usd,distinct_paid_buyers,clean_active_trade_months,market_venue_count
           FROM asset_signals WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='A')`,
        )
        .get() as Record<string, number>),
    },
    {
      clean_realized_usd: 100,
      distinct_paid_buyers: 2,
      clean_active_trade_months: 3,
      market_venue_count: 3,
    },
  );
});

test("compact asset signal repair walks every identity and durably completes a cycle", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO asset_dictionary(asset) VALUES('A'),('B');
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(200,zeroblob(32),1);
    INSERT INTO assets(asset_id,type,divisible,locked,supply_normalized,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,'1',100 FROM asset_dictionary;
  `);
  const core = d1(db);
  let processed = 0;
  let complete = await runCoreAssetSignalsStep(core, 1);
  for (let calls = 0; !complete.cycleComplete && calls < 10; calls++) {
    processed += complete.processed;
    complete = await runCoreAssetSignalsStep(core, 1);
  }
  assert.deepEqual(complete, { processed: 0, cursor: 0, cycleComplete: true });
  const assets = db.prepare(`SELECT COUNT(*) count FROM assets`).get()?.count;
  assert.equal(processed, assets);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_signals`).get()?.count, assets);
  assert.equal(db.prepare(`SELECT value FROM core_state WHERE key='asset_signals_cycles'`).get()?.value, "1");
  assert.deepEqual(await runCoreAssetSignalsStep(core, 1), { processed: 0, cursor: 0, cycleComplete: true });
  assert.equal(db.prepare(`SELECT value FROM core_state WHERE key='asset_signals_cycles'`).get()?.value, "1");
  db.exec(`INSERT INTO blocks(block_index,block_hash,block_time) VALUES(4231,randomblob(32),2)`);
  assert.deepEqual(await runCoreAssetSignalsStep(core, 1), { processed: 0, cursor: 0, cycleComplete: true });
  db.exec(`INSERT INTO blocks(block_index,block_hash,block_time) VALUES(4232,randomblob(32),3)`);
  assert.equal((await runCoreAssetSignalsStep(core, 1)).processed, 1);
  assert.equal((await runCoreAssetSignalsStep(core, 1, true)).processed, 1);
});

test("address-derived holder repair preserves unrelated market signals", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address_id,address) VALUES(20,'1holder');
    INSERT INTO address_signals(address_id,assets_held,survived_assets,dex_trades) VALUES(20,9,1,6);
    INSERT INTO asset_dictionary(asset) VALUES('A');
    INSERT INTO assets(asset_id,type,divisible,locked,supply_normalized,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,'100',100 FROM asset_dictionary WHERE asset='A';
    INSERT INTO asset_signals(asset_id,trades,dispenses,max_realized_usd,holders,holder_breadth)
      SELECT asset_id,12,7,99,0,0 FROM asset_dictionary WHERE asset='A';
    INSERT INTO balances(balance_id,address_id,asset_id,quantity,updated_event_index)
      SELECT 1,20,asset_id,'10',1 FROM asset_dictionary WHERE asset='A';
    INSERT INTO asset_holder_signal_dirty(asset_id)
      SELECT asset_id FROM asset_dictionary WHERE asset='A';
  `);

  assert.equal((await runCoreAssetSignalsStep(d1(db), 10)).processed, 1);
  assert.deepEqual(
    {
      ...(db
        .prepare(
          `SELECT holders,holder_breadth,trades,dispenses,max_realized_usd FROM asset_signals
           WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='A')`,
        )
        .get() as Record<string, number>),
    },
    { holders: 1, holder_breadth: 0, trades: 12, dispenses: 7, max_realized_usd: 99 },
  );
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM asset_holder_signal_dirty`).get()?.count, 0);
});

test("compact asset signals derive holder community features and propagate issuer quality", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(200,zeroblob(32),1);
    INSERT INTO address_dictionary(address_id,address) VALUES(10,'issuer'),(20,'h1'),(21,'h2'),(22,'h3');
    INSERT INTO address_signals(address_id,assets_held,survived_assets,dex_trades)
      VALUES(20,3,1,2),(21,6,0,4),(22,9,1,6);
    INSERT INTO asset_dictionary(asset) VALUES('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H');
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,supply_normalized,first_issuance_block_index)
      SELECT asset_id,'asset',10,0,0,'100',100 FROM asset_dictionary WHERE asset NOT IN ('BTC','XCP');
    INSERT INTO balances(balance_id,address_id,asset_id,quantity,updated_event_index)
      SELECT row_number() OVER (),holder.address_id,asset.asset_id,'1',1
      FROM asset_dictionary asset CROSS JOIN (SELECT 20 address_id UNION ALL SELECT 21 UNION ALL SELECT 22) holder;
    INSERT INTO curated(kind,key) VALUES('lowq','A'),('lowq','B'),('lowq','C'),('lowq','D');
  `);

  const core = d1(db);
  const assetCount = db.prepare(`SELECT count(*) count FROM assets`).get()?.count;
  assert.equal((await runCoreAssetSignalsStep(core, 20)).processed, assetCount);
  assert.equal((await runCoreAssetSignalsStep(core, 20)).cycleComplete, true);
  const community = db
    .prepare(`SELECT holder_breadth,pct_creator_holders,avg_holder_dex FROM asset_signals LIMIT 1`)
    .get() as Record<string, number>;
  assert.equal(community.holder_breadth, 6);
  assert.ok(Math.abs(community.pct_creator_holders - 200 / 3) < 1e-9);
  assert.equal(community.avg_holder_dex, 4);
  assert.equal(db.prepare(`SELECT sum(low_quality) count FROM asset_signals`).get()?.count, 8);
});

test("trade mutations enqueue and converge the affected asset signal", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO blocks(block_index,block_hash,block_time) VALUES(200,zeroblob(32),1);
    INSERT INTO address_dictionary(address_id,address) VALUES(10,'buyer'),(11,'seller');
    INSERT INTO asset_dictionary(asset) VALUES('QUEUED');
    INSERT INTO assets(asset_id,type,divisible,locked,supply_normalized,first_issuance_block_index)
      SELECT asset_id,'asset',0,0,'1',100 FROM asset_dictionary WHERE asset='QUEUED';
    INSERT INTO trades(venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,buyer_id,seller_id,sale_class)
      SELECT 'dispense','queued',asset_id,1000,200,1,'BTC',1,50,10,11,'single'
      FROM asset_dictionary WHERE asset='QUEUED';
  `);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM asset_signal_dirty`).get()?.n, 1);
  const result = await runCoreAssetSignalsStep(d1(db), 10);
  assert.equal(result.processed, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM asset_signal_dirty`).get()?.n, 0);
  assert.equal(
    db
      .prepare(
        `SELECT clean_realized_usd FROM asset_signals signal JOIN asset_dictionary dictionary USING(asset_id)
         WHERE dictionary.asset='QUEUED'`,
      )
      .get()?.clean_realized_usd,
    50,
  );
});
