/**
 * The emblem_trade_dirty queue triggers must survive upsert writers. SQLite strips a trigger
 * body's OR IGNORE when the firing statement carries its own ON CONFLICT clause, so the original
 * triggers aborted on their primary key whenever a crawl re-saw a sale (which is the dedupe design)
 * — killing the Emblem sales and transfer crawls for two weeks. Migration 0080 rebuilds them with
 * conflict-free bodies; these tests replay the exact prod failure shapes.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const CORE_DDL = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"))
  .join("\n");

function seededDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  return database;
}

const dirtyCount = (database: DatabaseSync): number =>
  Number((database.prepare(`SELECT COUNT(*) c FROM emblem_trade_dirty`).get() as { c: number }).c);

const dirtyProgress = (database: DatabaseSync): number =>
  Number(
    (
      database.prepare(`SELECT value FROM core_state WHERE key='emblem_trade_dirty_remaining'`).get() as {
        value: string;
      }
    ).value,
  );

const contentsDirtyCount = (database: DatabaseSync): number =>
  Number((database.prepare(`SELECT COUNT(*) c FROM emblem_vault_contents_dirty`).get() as { c: number }).c);

const SALE_UPSERT = `INSERT INTO emblem_sales(
    tx_hash,log_index,contract_id,token_id,price_raw,block_number
  ) VALUES(?,?,?,?,?,?)
  ON CONFLICT(tx_hash,log_index,contract_id,token_id) DO UPDATE SET
    price_raw=excluded.price_raw,block_number=excluded.block_number`;

test("re-upserting a sale enqueues its trade exactly once and does not abort", () => {
  const database = seededDatabase();
  database.prepare(SALE_UPSERT).run("0xabc", 1, 7, "42", "100", 20_000_000);
  assert.equal(dirtyCount(database), 1);
  assert.equal(dirtyProgress(database), 1);
  // The prod failure: the DO UPDATE path fired the update trigger with its OR IGNORE stripped.
  database.prepare(SALE_UPSERT).run("0xabc", 1, 7, "42", "200", 20_000_001);
  assert.equal(dirtyCount(database), 1);
  assert.equal(dirtyProgress(database), 1);
  database.prepare(`DELETE FROM emblem_trade_dirty WHERE contract_id=7 AND token_id='42'`).run();
  assert.equal(dirtyCount(database), 0);
  assert.equal(dirtyProgress(database), 0);
});

test("re-upserting an ethereum block re-enqueues its sales without aborting", () => {
  const database = seededDatabase();
  database.prepare(SALE_UPSERT).run("0xabc", 1, 7, "42", "100", 20_000_000);
  database.prepare(SALE_UPSERT).run("0xdef", 2, 7, "42", "150", 20_000_000); // same token, same block
  const BLOCK_UPSERT = `INSERT INTO ethereum_blocks(block_number,block_time) VALUES(?,?)
    ON CONFLICT(block_number) DO UPDATE SET block_time=excluded.block_time
    WHERE ethereum_blocks.block_time IS NOT excluded.block_time`;
  database.prepare(BLOCK_UPSERT).run(20_000_000, 1_700_000_000);
  database.prepare(BLOCK_UPSERT).run(20_000_000, 1_700_000_012); // block_time revision re-fires
  assert.equal(dirtyCount(database), 1);
  // Draining the queue then revising the block re-enqueues the token — the queue's whole purpose.
  database.prepare(`DELETE FROM emblem_trade_dirty`).run();
  database.prepare(BLOCK_UPSERT).run(20_000_000, 1_700_000_099);
  assert.equal(dirtyCount(database), 1);
});

test("vault contents dirty triggers follow send, balance, and sweep upserts without duplicate writes", () => {
  const database = seededDatabase();
  database.prepare(`INSERT INTO emblem_vaults(contract_id,token_id,btc_address_id) VALUES(7,'42',10)`).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`DELETE FROM emblem_vault_contents_dirty`).run();

  database.prepare(`INSERT INTO emblem_vaults(contract_id,token_id,btc_address_id) VALUES(8,'43',NULL)`).run();
  assert.equal(contentsDirtyCount(database), 0);
  database.prepare(`UPDATE emblem_vaults SET btc_address_id=11 WHERE contract_id=8 AND token_id='43'`).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`UPDATE emblem_vaults SET btc_address_id=NULL WHERE contract_id=8 AND token_id='43'`).run();
  assert.equal(contentsDirtyCount(database), 0);

  const sendUpsert = `INSERT INTO sends(
      event_index,tx_index,tx_hash,block_index,source_id,destination_id,asset_id,quantity,msg_index
    ) VALUES(1,2,zeroblob(32),100,20,10,30,'1',0)
    ON CONFLICT(event_index) DO UPDATE SET quantity=excluded.quantity`;
  database.prepare(sendUpsert).run();
  database.prepare(sendUpsert).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`DELETE FROM emblem_vault_contents_dirty`).run();
  database.prepare(`UPDATE sends SET quantity='2' WHERE event_index=1`).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`DELETE FROM emblem_vault_contents_dirty`).run();

  const balanceUpsert = `INSERT INTO balances(balance_id,address_id,asset_id,quantity)
    VALUES(1,10,30,'1')
    ON CONFLICT(balance_id) DO UPDATE SET quantity=excluded.quantity`;
  database.prepare(balanceUpsert).run();
  database.prepare(balanceUpsert).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`DELETE FROM emblem_vault_contents_dirty`).run();
  database.prepare(`UPDATE balances SET quantity='2' WHERE balance_id=1`).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`DELETE FROM emblem_vault_contents_dirty`).run();

  const sweepUpsert = `INSERT INTO sweeps(tx_index,tx_hash,block_index,source_id,destination_id)
    VALUES(3,zeroblob(32),101,10,20)
    ON CONFLICT(tx_index) DO UPDATE SET destination_id=excluded.destination_id`;
  database.prepare(sweepUpsert).run();
  database.prepare(sweepUpsert).run();
  assert.equal(contentsDirtyCount(database), 1);
  database.prepare(`DELETE FROM emblem_vault_contents_dirty`).run();
  database.prepare(`UPDATE sweeps SET block_time=200 WHERE tx_index=3`).run();
  assert.equal(contentsDirtyCount(database), 1);
});
