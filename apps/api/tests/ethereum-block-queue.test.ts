import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const progressMigration = readFileSync("migrations-core/0048_ethereum_block_progress.sql", "utf8");
const queueMigration = readFileSync("migrations-core/0051_ethereum_block_queue.sql", "utf8");

test("Ethereum block queue stays equal to distinct sale blocks without timestamps", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE core_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE emblem_sales(id INTEGER PRIMARY KEY,block_number INTEGER);
    CREATE INDEX idx_emblem_sales_block_number ON emblem_sales(block_number);
    CREATE TABLE ethereum_blocks(block_number INTEGER PRIMARY KEY,block_time INTEGER NOT NULL);
    INSERT INTO emblem_sales VALUES(1,100),(2,100),(3,200),(4,NULL);
    INSERT INTO ethereum_blocks VALUES(200,2000);
  `);
  db.exec(progressMigration);
  db.exec(queueMigration);

  const queued = () =>
    db
      .prepare("SELECT block_number FROM ethereum_block_queue ORDER BY block_number")
      .all()
      .map((row) => row.block_number);
  assert.deepEqual(queued(), [100]);

  db.prepare("INSERT INTO emblem_sales VALUES(5,300)").run();
  assert.deepEqual(queued(), [100, 300]);

  db.prepare("INSERT INTO ethereum_blocks VALUES(100,1000)").run();
  assert.deepEqual(queued(), [300]);

  db.prepare("DELETE FROM ethereum_blocks WHERE block_number=200").run();
  assert.deepEqual(queued(), [200, 300]);

  db.prepare("UPDATE emblem_sales SET block_number=400 WHERE id=3").run();
  assert.deepEqual(queued(), [300, 400]);

  db.prepare("DELETE FROM emblem_sales WHERE id=5").run();
  assert.deepEqual(queued(), [400]);
});
