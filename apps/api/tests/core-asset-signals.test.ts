import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { rebuildCoreAssetSignals } from "#api/indexer/core-asset-signals";
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
      .prepare(`SELECT holders,top1_pct,burned_pct,age_blocks,trades,dispenses FROM asset_signals
        WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='A')`)
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
  db.exec(`UPDATE asset_signals SET holders=0,top1_pct=0,burned_pct=0 WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='A')`);
  const fresh = await coreAssetSignals(d1(db), "A");
  assert.equal(fresh?.holders, 1);
  assert.equal(fresh?.top1_pct, 100);
  assert.equal(fresh?.burned_pct, 40);
  assert.equal(fresh?.age_blocks, 101);
  assert.equal(fresh?.recency_blocks, 201);
});
