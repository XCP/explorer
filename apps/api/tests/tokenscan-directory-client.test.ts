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
  db.exec(`CREATE TABLE tags(entity_type TEXT,entity_id TEXT,tag TEXT,source TEXT,meta TEXT,
    PRIMARY KEY(entity_type,entity_id,tag));
    INSERT INTO tags VALUES('asset','A','one','tokenscan','old');
    INSERT INTO tags VALUES('asset','B','two','collection','curated');`);
  db.prepare(TOKENSCAN_TAG_UPSERT_SQL).run("A", "one", "fresh");
  db.prepare(TOKENSCAN_TAG_UPSERT_SQL).run("B", "two", "provider");
  assert.deepEqual(
    { ...db.prepare(`SELECT source,meta FROM tags WHERE entity_id='A'`).get() },
    {
      source: "tokenscan",
      meta: "fresh",
    },
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT source,meta FROM tags WHERE entity_id='B'`).get() },
    {
      source: "collection",
      meta: "curated",
    },
  );
});
