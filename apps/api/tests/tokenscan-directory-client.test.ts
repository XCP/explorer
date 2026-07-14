import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseTokenscanDirectoryScript } from "#api/integrations/tokenscan-directory";
import { TOKENSCAN_TAG_UPSERT_SQL } from "#api/indexer/tokenscan-collections";

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

test("Tokenscan upserts refresh owned tags without stealing another source", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE tags(entity_id INTEGER,tag TEXT,source TEXT,meta TEXT,PRIMARY KEY(entity_id,tag));
    INSERT INTO entity_dictionary VALUES(1,'asset','A'),(2,'asset','B');
    INSERT INTO tags VALUES(1,'one','tokenscan','old');
    INSERT INTO tags VALUES(2,'two','collection','curated');`);
  db.prepare(TOKENSCAN_TAG_UPSERT_SQL).run("A", "one", "fresh");
  db.prepare(TOKENSCAN_TAG_UPSERT_SQL).run("B", "two", "provider");
  assert.deepEqual(
    { ...db.prepare(`SELECT source,meta FROM tags WHERE entity_id=1`).get() },
    {
      source: "tokenscan",
      meta: "fresh",
    },
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT source,meta FROM tags WHERE entity_id=2`).get() },
    {
      source: "collection",
      meta: "curated",
    },
  );
});
