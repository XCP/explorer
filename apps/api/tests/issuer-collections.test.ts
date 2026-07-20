import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { buildIssuerCollections, issuerCollection, issuerCollectionMeta } from "#api/indexer/issuer-collections";

class Statement {
  private args: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { rows_written: result.changes } };
  }
}
const d1 = (db: DatabaseSync): D1Database =>
  ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("explicit issuer collections classify new issuances immediately", () => {
  const collection = issuerCollection("bc1qv9zuv6ycly3gvnt2qrrw7ve9f3vlyjapmefrym");
  assert.equal(collection?.tag, "corruptionaires");
  assert.deepEqual(JSON.parse(issuerCollectionMeta(collection!)), {
    collection: "Corruptionaires",
    site: "https://corruptionaires.neocities.org/",
  });
  assert.equal(issuerCollection("unrelated"), null);
  assert.equal(issuerCollection(null), null);
  assert.equal(issuerCollection("1ChvF5WNhVMg6heJdruRXgs6bUwQAaVWzL")?.tag, "based-intellectuals");
});

test("issuer collection rebuild writes and reconciles compact entity tags", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,issuer_id INTEGER);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,PRIMARY KEY(entity_id,tag));
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,
      observed_at INTEGER DEFAULT(unixepoch()),PRIMARY KEY(entity_id,tag,source));
    CREATE TABLE cache(key TEXT PRIMARY KEY);
    INSERT INTO address_dictionary VALUES(1,'bc1qv9zuv6ycly3gvnt2qrrw7ve9f3vlyjapmefrym');
    INSERT INTO asset_dictionary VALUES(10,'CORRUPTJSUN');
    INSERT INTO assets VALUES(10,1);
    INSERT INTO entity_dictionary VALUES(99,'asset','STALE');
    INSERT INTO tags VALUES(99,'corruptionaires','issuer',NULL,'old');
    INSERT INTO collection_membership_evidence(entity_id,tag,source,meta) VALUES(99,'corruptionaires','issuer','old');
  `);
  const result = await buildIssuerCollections({ CORE_DB: d1(db) } as never);
  assert.equal(result.collections, 3);
  assert.deepEqual(
    db
      .prepare(
        `SELECT entity.entity_key asset,tag.tag,tag.source FROM tags tag
      JOIN entity_dictionary entity ON entity.entity_id=tag.entity_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [{ asset: "CORRUPTJSUN", tag: "corruptionaires", source: "issuer" }],
  );
  db.close();
});
