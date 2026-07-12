import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  COMPACT_PRIMARY_DDL, COMPACT_SENDS_BY_ADDRESS_SQL, COMPACT_BALANCES_BY_ADDRESS_SQL,
} from "../src/indexer/compact-primary-prototype";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(COMPACT_PRIMARY_DDL);
  db.exec(`
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob');
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'UNREGISTERED');
  `);
  db.prepare(`INSERT INTO transactions_v2 VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    7, new Uint8Array(32).fill(0xab), 100, 1, 1, 2, "0", "10", null, 1, null,
  );
  db.prepare(`INSERT INTO sends_v2(event_index,tx_index,block_index,block_time,source_id,destination_id,asset_id,quantity,quantity_normalized,send_type,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(9, 7, 100, 1, 1, 2, 2, "5", "5", "send", "valid");
  db.prepare(`INSERT INTO balances_v2(address_id,asset_id,quantity,quantity_normalized) VALUES(?,?,?,?)`).run(1, 2, "5", "5");
  return db;
}

test("compact sends reconstruct hashes and preserve observed noncanonical assets", () => {
  const rows = fixture().prepare(COMPACT_SENDS_BY_ADDRESS_SQL).all(1, 50, 0) as { tx_hash: string; asset: string }[];
  assert.equal(rows[0].tx_hash, "ab".repeat(32));
  assert.equal(rows[0].asset, "UNREGISTERED");
});

test("compact primary address reads search ids before decoding", () => {
  const db = fixture();
  const sendPlan = db.prepare(`EXPLAIN QUERY PLAN ${COMPACT_SENDS_BY_ADDRESS_SQL}`).all(1, 50, 0) as { detail: string }[];
  assert.equal(sendPlan.some((row) => row.detail.includes("idx_send2_source")), true);
  assert.equal(sendPlan.some((row) => row.detail.includes("idx_send2_destination")), true);
  assert.equal(sendPlan.some((row) => row.detail === "SCAN sends_v2"), false);
  const balancePlan = db.prepare(`EXPLAIN QUERY PLAN ${COMPACT_BALANCES_BY_ADDRESS_SQL}`).all(1, 50, 0) as { detail: string }[];
  assert.equal(balancePlan.some((row) => row.detail.includes("idx_bal2_address_asset")), true);
  assert.equal(balancePlan.some((row) => row.detail === "SCAN balances_v2"), false);
});

test("compact balances split UTXOs and enforce exactly one holder representation", () => {
  const db = fixture();
  let invalid = "";
  try {
    db.prepare(`INSERT INTO balances_v2(address_id,utxo_tx_hash,utxo_vout,asset_id,quantity) VALUES(?,?,?,?,?)`)
      .run(1, new Uint8Array(32), 0, 1, "1");
  } catch (error) { invalid = (error as Error).message; }
  assert.equal(invalid.includes("CHECK constraint failed"), true);
});
