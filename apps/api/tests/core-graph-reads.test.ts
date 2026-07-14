import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { addressEgo, assetHolders } from "#api/queries/graph-extract";
import { graphCuts, graphOverview, graphScore } from "#api/queries/graph";

class Statement {
  private args: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.args) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("compact graph reads use canonical identities and only the active generation", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,graph_trust REAL,graph_distrust REAL);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,graph_trust REAL,graph_distrust REAL);
    CREATE TABLE curated(kind TEXT,key TEXT,PRIMARY KEY(kind,key));
    CREATE TABLE balances(balance_id INTEGER PRIMARY KEY,address_id INTEGER,asset_id INTEGER,quantity TEXT,
      quantity_normalized TEXT);
    CREATE TABLE graph_edges(generation INTEGER,source_entity_id INTEGER,destination_entity_id INTEGER,
      weight REAL,edge_block INTEGER,PRIMARY KEY(generation,source_entity_id,destination_entity_id)) WITHOUT ROWID;
    INSERT INTO core_state VALUES
      ('graph_generation','2'),('graph_cut_addr_trust','0.2'),('graph_cut_addr_distrust','0.4'),
      ('graph_cut_asset_trust','0.3'),('graph_cut_asset_distrust','0.5');
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob'),(3,'carol');
    INSERT INTO asset_dictionary VALUES(10,'CARD');
    INSERT INTO entity_dictionary VALUES
      (1,'address','alice'),(2,'address','bob'),(3,'address','carol'),(10,'asset','CARD');
    INSERT INTO address_signals VALUES(1,0.8,0.1),(2,0.4,0.2),(3,0.1,0.7);
    INSERT INTO asset_signals VALUES(10,0.9,0.1);
    INSERT INTO balances VALUES(1,2,10,'200','2.0'),(2,3,10,'100','1.0');
    INSERT INTO graph_edges VALUES
      (1,1,3,99,1),(2,1,2,2,2),(2,2,3,3,2),(2,3,2,1,2),(2,10,1,0.693147,2);
  `);
  const binding = d1(db);
  assert.deepEqual(await graphScore(binding, "address", "alice"), { trust: 0.8, distrust: 0.1 });
  assert.deepEqual((await graphCuts(binding)).asset, { trust: 0.3, distrust: 0.5 });
  const ego = await addressEgo(binding, "alice", 10);
  assert.deepEqual(ego.nodes.map((node) => node.id), ["alice", "bob"]);
  assert.equal(ego.edges.length, 1);
  assert.equal(ego.edges[0].target, "bob");
  const holders = await assetHolders(binding, "CARD", 10);
  assert.deepEqual(holders.nodes.map((node) => node.id), ["CARD", "bob", "carol"]);
  assert.equal(holders.edges.filter((edge) => !edge.spoke).length, 2);
  const overview = await graphOverview(binding);
  assert.equal(overview.addresses.tiers.trusted, 2);
  assert.equal(overview.addresses.tiers.distrusted, 1);
  assert.equal(overview.assets.top_trusted[0].key, "CARD");
  db.close();
});
