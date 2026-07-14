import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getCoreAsset, listCoreSubassets } from "#api/queries/core-assets";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact asset metadata and subassets restore dictionary identities", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,asset_longname TEXT,numeric_asset_id TEXT,type TEXT,issuer_id INTEGER,owner_id INTEGER,divisible INTEGER,locked INTEGER,description_locked INTEGER,supply TEXT,supply_normalized TEXT,description TEXT,mime_type TEXT,first_issuance_block_index INTEGER,last_issuance_block_index INTEGER,first_issuance_block_time INTEGER,last_issuance_block_time INTEGER,updated_at INTEGER);
    INSERT INTO address_dictionary VALUES(1,'issuer');
    INSERT INTO asset_dictionary VALUES(1,'PARENT'),(2,'CHILD1'),(3,'CHILD2'),(4,'OTHER');
    INSERT INTO assets VALUES(1,NULL,NULL,'asset',1,1,0,0,0,'1','1','{"image":"x"}','application/json',1,1,10,10,10);
    INSERT INTO assets VALUES(2,'PARENT.Alpha',NULL,'subasset',1,1,0,0,0,'1','1',NULL,NULL,2,2,20,20,20);
    INSERT INTO assets VALUES(3,'PARENT.beta',NULL,'subasset',1,1,1,1,0,'1','0.00000001',NULL,NULL,3,3,30,30,30);
    INSERT INTO assets VALUES(4,'PARENTS.nope',NULL,'subasset',1,1,0,0,0,'1','1',NULL,NULL,4,4,40,40,40);
  `);
  const binding = d1(db);
  assert.equal((await getCoreAsset(binding, "PARENT"))?.description, '{"image":"x"}');
  const rows = await listCoreSubassets(binding, "PARENT", 10, 0);
  assert.deepEqual(rows.map((row) => row.asset), ["CHILD2", "CHILD1"]);
  assert.equal(rows[0].issuer, "issuer");
});
