import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { projectCollectionMembership } from "#api/indexer/collection-membership";

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

const envFor = (db: DatabaseSync) =>
  ({ CORE_DB: { prepare: (sql: string) => new Statement(db, sql) } }) as unknown as Parameters<
    typeof projectCollectionMembership
  >[0];

test("canonical collection membership follows priority and falls back safely", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,PRIMARY KEY(entity_id,tag));
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,
      observed_at INTEGER,PRIMARY KEY(entity_id,tag,source));
    INSERT INTO tags VALUES(9,'stamp','protocol',NULL,NULL);
    INSERT INTO collection_membership_evidence VALUES
      (1,'rare-pepe','tokenscan',NULL,'feed',1),
      (1,'rare-pepe','manual',7,'reviewed',2);
  `);
  const env = envFor(db);

  await projectCollectionMembership(env, "rare-pepe");
  assert.deepEqual(
    { ...db.prepare(`SELECT source,value,meta FROM tags WHERE entity_id=1`).get() },
    {
      source: "manual",
      value: 7,
      meta: "reviewed",
    },
  );

  db.exec(`DELETE FROM collection_membership_evidence WHERE source='manual'`);
  await projectCollectionMembership(env, "rare-pepe");
  assert.equal(db.prepare(`SELECT source FROM tags WHERE entity_id=1`).get()?.source, "tokenscan");

  db.exec(`DELETE FROM collection_membership_evidence WHERE source='tokenscan'`);
  await projectCollectionMembership(env, "rare-pepe");
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM tags WHERE tag='rare-pepe'`).get()?.count, 0);
  assert.equal(db.prepare(`SELECT source FROM tags WHERE tag='stamp'`).get()?.source, "protocol");
  db.close();
});

test("collection projection replay is idempotent", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,PRIMARY KEY(entity_id,tag));
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,
      observed_at INTEGER,PRIMARY KEY(entity_id,tag,source));
    INSERT INTO collection_membership_evidence VALUES(1,'bitcorn','issuer',NULL,'corn',1);
  `);
  const env = envFor(db);
  await projectCollectionMembership(env, "bitcorn");
  await projectCollectionMembership(env, "bitcorn");
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM tags`).get()?.count, 1);
  db.close();
});
