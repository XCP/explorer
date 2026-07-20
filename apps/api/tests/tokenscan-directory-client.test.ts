import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseTokenscanDirectoryScript } from "#api/integrations/tokenscan-directory";
import { ARTIST_TAG_UPSERT_SQL } from "#api/indexer/collections";
import { COLLECTION_EVIDENCE_UPSERT_SQL } from "#api/indexer/collection-membership";

test("Tokenscan directory parsing extracts usable collections", () => {
  assert.deepEqual(
    parseTokenscanDirectoryScript(
      'const NFT_DATA = [{"name":"Rare Pepe","site":"https://example.test","cards":["RAREPEPE.png"]}];',
    ),
    [{ name: "Rare Pepe", site: "https://example.test", cards: ["RAREPEPE.png"] }],
  );
});

test("Tokenscan directory parsing rejects destructive provider drift", () => {
  assert.throws(() => parseTokenscanDirectoryScript("const NFT_DATA = {};"), /array not found/);
  assert.throws(() => parseTokenscanDirectoryScript("const NFT_DATA = [{}];"), /no usable collections/);
  assert.throws(() => parseTokenscanDirectoryScript('const NFT_DATA = [{"name":"x","cards":[1]}];'), /string array/);
  assert.throws(
    () => parseTokenscanDirectoryScript('const NFT_DATA = [{"name":1,"cards":[]}];'),
    /name must be a string/,
  );
});

test("collection evidence retains independent providers for one membership", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,
      observed_at INTEGER,PRIMARY KEY(entity_id,tag,source));
    INSERT INTO entity_dictionary VALUES(1,'asset','A'),(2,'asset','B');
    INSERT INTO collection_membership_evidence VALUES(1,'one','collection',NULL,'curated',1);`);
  db.prepare(COLLECTION_EVIDENCE_UPSERT_SQL).run("A", "one", "tokenscan", null, "provider");
  db.prepare(COLLECTION_EVIDENCE_UPSERT_SQL).run("A", "one", "collection", null, "fresh");
  assert.deepEqual(
    db
      .prepare(`SELECT source,meta FROM collection_membership_evidence ORDER BY source`)
      .all()
      .map((row) => ({ ...row })),
    [
      { source: "collection", meta: "fresh" },
      { source: "tokenscan", meta: "provider" },
    ],
  );
});

test("collection and artist upserts resolve one canonical asset entity", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,PRIMARY KEY(entity_id,tag));
    CREATE TABLE collection_membership_evidence(entity_id INTEGER,tag TEXT,source TEXT,value REAL,meta TEXT,
      observed_at INTEGER,PRIMARY KEY(entity_id,tag,source));
    INSERT INTO entity_dictionary VALUES(1,'asset','CARD');`);
  db.prepare(COLLECTION_EVIDENCE_UPSERT_SQL).run("CARD", "rare-pepe", "collection", 1002, '{"series":1,"card":2}');
  db.prepare(ARTIST_TAG_UPSERT_SQL).run("CARD", "artist-satoshi", '{"name":"Satoshi"}');
  assert.deepEqual(
    db
      .prepare(`SELECT tag,source,value,meta FROM tags ORDER BY tag`)
      .all()
      .map((row) => ({ ...row })),
    [{ tag: "artist-satoshi", source: "artist", value: null, meta: '{"name":"Satoshi"}' }],
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT tag,source,value,meta FROM collection_membership_evidence`).get() },
    { tag: "rare-pepe", source: "collection", value: 1002, meta: '{"series":1,"card":2}' },
  );
  db.close();
});
