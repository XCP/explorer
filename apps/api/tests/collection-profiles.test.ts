import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getCollectionProfile, listCollectionProfiles } from "#api/queries/collections";

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

test("collection profiles reconcile Rating, clean market, overlap, concentration, and integrity axes", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT);
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT,meta TEXT,observed_at INTEGER);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,issuer_id INTEGER);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,low_quality INTEGER,clean_active_trade_months INTEGER,
      distinct_paid_buyers INTEGER,clean_realized_usd REAL);
    CREATE TABLE asset_ratings(asset_id INTEGER PRIMARY KEY,rating REAL);
    CREATE TABLE balances(asset_id INTEGER,address_id INTEGER,quantity INTEGER);
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,meta TEXT);
    INSERT INTO entity_dictionary VALUES(1,'asset','A'),(2,'asset','B'),(3,'asset','C');
    INSERT INTO asset_dictionary VALUES(1,'A'),(2,'B'),(3,'C');
    INSERT INTO assets VALUES(1,10),(2,10),(3,11);
    INSERT INTO asset_signals VALUES(1,0,12,7,900),(2,0,3,2,100),(3,1,0,0,0);
    INSERT INTO asset_ratings VALUES(1,9.5),(2,5.0);
    INSERT INTO collection_membership_evidence VALUES
      (1,'cards','manual',NULL,1),(1,'cards','tokenscan',NULL,1),
      (2,'cards','manual',NULL,1),(3,'cards','manual',NULL,1);
    INSERT INTO tags VALUES(1,'cards','manual','{"collection":"Cards","site":"https://example.test"}');
    INSERT INTO balances VALUES(1,100,1),(1,101,1),(2,100,1),(3,102,1),(3,103,0);
  `);

  const profile = await getCollectionProfile(d1(db), "cards");
  if (!profile) throw new Error("collection profile missing");
  assert.equal((await listCollectionProfiles(d1(db))).length, 1);
  assert.deepEqual(
    {
      members: profile.members,
      rated: profile.rated_members,
      median: profile.median_rating,
      distribution: [
        profile.rating_exceptional,
        profile.rating_strong,
        profile.rating_developing,
        profile.rating_limited,
      ],
      realized: profile.total_realized_usd,
      topShare: profile.top_asset_value_pct,
      relationships: profile.holder_relationships,
      holders: profile.unique_holders,
      overlap: profile.holder_overlap_pct,
      integrity: profile.integrity_assets,
    },
    {
      members: 3,
      rated: 2,
      median: 7.3,
      distribution: [1, 0, 1, 0],
      realized: 1000,
      topShare: 90,
      relationships: 4,
      holders: 3,
      overlap: 25,
      integrity: 1,
    },
  );
  assert.equal("score" in profile, false, "a descriptive collection profile must not grow a composite score");
});
