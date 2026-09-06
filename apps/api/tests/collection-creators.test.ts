import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { rebuildCollectionCreators } from "#api/indexer/collection-creators";
import { listAddressCollectionCreators } from "#api/queries/collections";

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

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
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { rows_written: Number(result.changes) } };
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}
const d1 = (db: DatabaseSync) =>
  ({
    prepare: (sql: string) => new Statement(db, sql),
    async batch(items: Statement[]) {
      const results = [];
      for (const item of items) results.push(await item.all());
      return results;
    },
  }) as unknown as D1Database;

function seed(db: DatabaseSync) {
  for (const migration of migrations) db.exec(migration);
  // Two collections, three cards. CARD1 and CARD2 are Rare Pepes; CARD2's issuance rights were later
  // transferred to 1holder, so its current issuer is not its creator. CARD3 is a Bitcorn by 1holder.
  db.exec(`
    INSERT INTO address_dictionary(address) VALUES('1artist'),('1holder'),('1nobody');
    INSERT INTO asset_dictionary(asset) VALUES('CARD1'),('CARD2'),('CARD3');
    INSERT INTO entity_dictionary(entity_type,entity_key) VALUES('asset','CARD1'),('asset','CARD2'),('asset','CARD3');
    INSERT INTO tags(entity_id,tag,source)
      SELECT entity_id,'rare-pepe','collection' FROM entity_dictionary WHERE entity_key IN ('CARD1','CARD2');
    INSERT INTO tags(entity_id,tag,source)
      SELECT entity_id,'bitcorn','tokenscan' FROM entity_dictionary WHERE entity_key='CARD3';
    INSERT INTO issuances(event_index,tx_index,tx_hash,block_index,asset_id,source_id,issuer_id,status)
      SELECT 1,1,randomblob(32),400000,a.asset_id,s.address_id,s.address_id,'valid'
      FROM asset_dictionary a,address_dictionary s WHERE a.asset='CARD1' AND s.address='1artist';
    INSERT INTO issuances(event_index,tx_index,tx_hash,block_index,asset_id,source_id,issuer_id,status)
      SELECT 2,2,randomblob(32),400001,a.asset_id,s.address_id,s.address_id,'valid'
      FROM asset_dictionary a,address_dictionary s WHERE a.asset='CARD2' AND s.address='1artist';
    INSERT INTO issuances(event_index,tx_index,tx_hash,block_index,asset_id,source_id,issuer_id,transfer,status)
      SELECT 3,3,randomblob(32),500000,a.asset_id,s.address_id,h.address_id,1,'valid'
      FROM asset_dictionary a,address_dictionary s,address_dictionary h
      WHERE a.asset='CARD2' AND s.address='1artist' AND h.address='1holder';
    INSERT INTO issuances(event_index,tx_index,tx_hash,block_index,asset_id,source_id,issuer_id,status)
      SELECT 4,4,randomblob(32),600000,a.asset_id,s.address_id,s.address_id,'valid'
      FROM asset_dictionary a,address_dictionary s WHERE a.asset='CARD3' AND s.address='1holder';
  `);
}

test("collection creators project the first valid issuer per card and answer a batch lookup", async () => {
  const db = new DatabaseSync(":memory:");
  seed(db);
  const first = await rebuildCollectionCreators(d1(db));
  assert.deepEqual(first, { written: 2, removed: 0 });

  const rows = await listAddressCollectionCreators(d1(db), ["1artist", "1holder", "1nobody", "1unknown"]);
  assert.deepEqual(rows, [
    { address: "1artist", collections: [{ tag: "rare-pepe", cards: 2 }] },
    { address: "1holder", collections: [{ tag: "bitcorn", cards: 1 }] },
  ]);

  // Unchanged history writes nothing: the upsert's guard rejects every row.
  assert.deepEqual(await rebuildCollectionCreators(d1(db)), { written: 0, removed: 0 });
});

test("collection creators follow membership: a card leaving its collection retracts the badge", async () => {
  const db = new DatabaseSync(":memory:");
  seed(db);
  await rebuildCollectionCreators(d1(db));
  db.exec(`DELETE FROM tags WHERE tag='bitcorn'`);
  assert.deepEqual(await rebuildCollectionCreators(d1(db)), { written: 0, removed: 1 });
  assert.deepEqual(await listAddressCollectionCreators(d1(db), ["1holder"]), []);
});
