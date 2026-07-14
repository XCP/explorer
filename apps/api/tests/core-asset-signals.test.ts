import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { rebuildCoreAssetSignals, runCoreAssetSignalsStep } from "#api/indexer/core-asset-signals";
import { coreAssetSignals } from "#api/queries/core-assets";

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
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,supply_normalized,first_issuance_block_index)
      VALUES((SELECT asset_id FROM asset_dictionary WHERE asset='A'),'asset',10,0,1,'100',100);
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
  const fresh = await coreAssetSignals(d1(db), "A");
  assert.equal(fresh?.holders, 1);
  assert.equal(fresh?.top1_pct, 100);
  assert.equal(fresh?.burned_pct, 40);
  assert.equal(fresh?.age_blocks, 101);
  assert.equal(fresh?.recency_blocks, 201);
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
