import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { refreshAssetEmergence } from "#api/indexer/asset-emergence";

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
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

const d1 = (db: DatabaseSync) => ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;
const DAY = 86_400;

test("emergence evidence updates while fresh, freezes at day 30, and excludes self trades", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  const now = 200 * DAY;
  db.exec(`
    INSERT INTO asset_dictionary(asset) VALUES('FRESH'),('EMERGING');
    INSERT INTO address_dictionary(address_id,address) VALUES(1,'buyer'),(2,'seller'),(3,'other');
    INSERT INTO assets(asset_id,type,first_issuance_block_time)
      SELECT asset_id,'asset',${now - 20 * DAY} FROM asset_dictionary WHERE asset='FRESH';
    INSERT INTO assets(asset_id,type,first_issuance_block_time)
      SELECT asset_id,'asset',${now - 40 * DAY} FROM asset_dictionary WHERE asset='EMERGING';
    INSERT INTO trades(venue,ref,asset_id,block_time,buyer_id,seller_id)
      SELECT 'dex','fresh-real',asset_id,${now - 19 * DAY},1,2 FROM asset_dictionary WHERE asset='FRESH';
    INSERT INTO trades(venue,ref,asset_id,block_time,buyer_id,seller_id)
      SELECT 'dex','fresh-self',asset_id,${now - 18 * DAY},1,1 FROM asset_dictionary WHERE asset='FRESH';
    INSERT INTO trades(venue,ref,asset_id,block_time,buyer_id,seller_id)
      SELECT 'dispense','early',asset_id,${now - 39 * DAY},1,2 FROM asset_dictionary WHERE asset='EMERGING';
    INSERT INTO trades(venue,ref,asset_id,block_time,buyer_id,seller_id)
      SELECT 'emblem','late',asset_id,${now - 15 * DAY},3,2 FROM asset_dictionary WHERE asset='EMERGING';
    INSERT INTO trades(venue,ref,asset_id,block_time,buyer_id,seller_id)
      SELECT 'dex','after-cutoff',asset_id,${now - 5 * DAY},3,2 FROM asset_dictionary WHERE asset='EMERGING';
  `);

  assert.deepEqual(await refreshAssetEmergence(d1(db), now), { refreshed: 2, fresh: 1, emerging: 1 });
  const fresh = db.prepare(`SELECT finalized,trades,buyers,active_days FROM asset_emergence
    WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='FRESH')`).get();
  assert.deepEqual({ ...fresh }, { finalized: 0, trades: 1, buyers: 1, active_days: 1 });
  const emerging = db.prepare(`SELECT finalized,trades,buyers,active_days,late_buyers,venues FROM asset_emergence
    WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='EMERGING')`).get();
  assert.deepEqual(
    { ...emerging },
    { finalized: 1, trades: 2, buyers: 2, active_days: 2, late_buyers: 1, venues: 2 },
  );

  await refreshAssetEmergence(d1(db), now + 10 * DAY);
  assert.deepEqual(
    { ...db.prepare(`SELECT trades,buyers,active_days,late_buyers,venues FROM asset_emergence
      WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='EMERGING')`).get() },
    { trades: 2, buyers: 2, active_days: 2, late_buyers: 1, venues: 2 },
  );
  db.close();
});
