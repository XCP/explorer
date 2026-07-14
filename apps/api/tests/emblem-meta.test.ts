import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EMBLEM_META_UPDATE_SQL } from "#api/indexer/emblem-meta";

test("Emblem metadata resolves claims through compact asset identity", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE emblem_vaults(
      token_id TEXT PRIMARY KEY,claimed_name TEXT,claimed_asset_id INTEGER,content_coins TEXT,
      has_contents INTEGER,emblem_fraud INTEGER,meta_crawled INTEGER DEFAULT 0);
    INSERT INTO asset_dictionary VALUES(7,'RAREPEPE');
    INSERT INTO emblem_vaults(token_id) VALUES('1');
  `);
  db.prepare(EMBLEM_META_UPDATE_SQL).run("RAREPEPE", "RAREPEPE", "btc", 1, 0, "1");
  assert.deepEqual(
    { ...db.prepare(`SELECT * FROM emblem_vaults`).get() },
    {
      token_id: "1",
      claimed_name: "RAREPEPE",
      claimed_asset_id: 7,
      content_coins: "btc",
      has_contents: 1,
      emblem_fraud: 0,
      meta_crawled: 1,
    },
  );
  db.close();
});
