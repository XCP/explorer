import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listAddressCollections } from "#api/queries/collections";

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
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("address collections: holdings are opt-in, counted per distinct member asset above zero", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT);
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT);
    CREATE TABLE collection_creators(address_id INTEGER,tag TEXT,cards INTEGER);
    CREATE TABLE balances(address_id INTEGER,asset_id INTEGER,quantity TEXT);
    INSERT INTO address_dictionary VALUES(1,'creator'),(2,'collector'),(3,'nobody');
    INSERT INTO asset_dictionary VALUES(1,'A'),(2,'B'),(3,'C'),(4,'PLAIN');
    INSERT INTO entity_dictionary VALUES(1,'asset','A'),(2,'asset','B'),(3,'asset','C'),(4,'address','A');
    INSERT INTO collection_membership_evidence VALUES
      (1,'cards','manual'),(1,'cards','tokenscan'),(2,'cards','manual'),(3,'other','collection'),(4,'cards','manual');
    INSERT INTO collection_creators VALUES(1,'cards',2);
    INSERT INTO balances VALUES(2,1,'1'),(2,2,'5'),(2,3,'0'),(2,4,'9'),(1,3,'1'),(3,4,'1');
  `);

  const created = await listAddressCollections(d1(db), ["collector", "creator", "nobody"], false);
  assert.deepEqual(created, [{ address: "creator", collections: [{ tag: "cards", cards: 2 }] }]);

  const withHeld = await listAddressCollections(d1(db), ["collector", "creator", "nobody"], true);
  assert.deepEqual(withHeld, [
    // request order; created nothing, so an empty creator list rather than omission
    { address: "collector", collections: [], held: [{ tag: "cards", cards: 2 }] },
    { address: "creator", collections: [{ tag: "cards", cards: 2 }], held: [{ tag: "other", cards: 1 }] },
  ]);
});
