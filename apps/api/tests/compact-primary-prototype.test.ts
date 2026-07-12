import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  COMPACT_PRIMARY_DDL,
  COMPACT_SENDS_BY_ADDRESS_SQL,
  COMPACT_BALANCES_BY_ADDRESS_SQL,
  COMPACT_TOTAL_BY_ASSET_SQL,
  ORDER_MATCH_PUBLIC_ID_SQL,
} from "../src/indexer/compact-primary-prototype";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(COMPACT_PRIMARY_DDL);
  db.exec(`
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob');
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'RARE');
  `);
  db.prepare(`INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    7,
    new Uint8Array(32).fill(0xab),
    100,
    1,
    1,
    2,
    "0",
    "10",
    null,
    1,
    null,
  );
  db.prepare(
    `INSERT INTO sends(event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,asset_id,quantity,quantity_normalized,send_type,status,msg_index)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(9, 7, new Uint8Array(32).fill(0xab), 100, 1, 1, 2, 2, "5", "5", "send", "valid", 0);
  db.prepare(`INSERT INTO balances(address_id,asset_id,quantity,quantity_normalized) VALUES(?,?,?,?)`).run(
    1,
    2,
    "5",
    "5",
  );
  return db;
}

test("compact sends preserve source one-to-many identity and compact hashes", () => {
  const rows = fixture().prepare(COMPACT_SENDS_BY_ADDRESS_SQL).all(1, 50, 0) as { tx_hash: string; asset: string }[];
  assert.equal(rows[0].tx_hash, "ab".repeat(32));
  assert.equal(rows[0].asset, "RARE");
  let duplicate = "";
  try {
    fixture()
      .prepare(`INSERT INTO sends(event_index,tx_index,tx_hash,block_index,msg_index) VALUES(?,?,?,?,?)`)
      .run(10, 7, new Uint8Array(32).fill(0xab), 100, 0);
  } catch (error) {
    duplicate = (error as Error).message;
  }
  assert.equal(duplicate.includes("UNIQUE constraint failed"), true);
});

test("compact primary address reads search ids before decoding", () => {
  const db = fixture();
  const sendPlan = db.prepare(`EXPLAIN QUERY PLAN ${COMPACT_SENDS_BY_ADDRESS_SQL}`).all(1, 50, 0) as {
    detail: string;
  }[];
  assert.equal(
    sendPlan.some((row) => row.detail.includes("idx_sends_source")),
    true,
  );
  assert.equal(
    sendPlan.some((row) => row.detail.includes("idx_sends_destination")),
    true,
  );
  assert.equal(
    sendPlan.some((row) => row.detail === "SCAN sends"),
    false,
  );
  const balancePlan = db.prepare(`EXPLAIN QUERY PLAN ${COMPACT_BALANCES_BY_ADDRESS_SQL}`).all(1, 50, 0) as {
    detail: string;
  }[];
  assert.equal(
    balancePlan.some((row) => row.detail.includes("idx_balances_address_asset")),
    true,
  );
  assert.equal(
    balancePlan.some((row) => row.detail === "SCAN balances"),
    false,
  );
});

test("compact balances split UTXOs and enforce exactly one holder representation", () => {
  const db = fixture();
  let invalid = "";
  try {
    db.prepare(`INSERT INTO balances(address_id,utxo_tx_hash,utxo_vout,asset_id,quantity) VALUES(?,?,?,?,?)`).run(
      1,
      new Uint8Array(32),
      0,
      1,
      "1",
    );
  } catch (error) {
    invalid = (error as Error).message;
  }
  assert.equal(invalid.includes("CHECK constraint failed"), true);
});

test("one balance table sums address and UTXO holders without a union", () => {
  const db = fixture();
  db.prepare(
    `INSERT INTO balances(utxo_tx_hash,utxo_vout,utxo_address_id,asset_id,quantity,quantity_normalized)
    VALUES(?,?,?,?,?,?)`,
  ).run(new Uint8Array(32).fill(0xcd), 2, 1, 2, "7", "7");
  const total = db.prepare(COMPACT_TOTAL_BY_ASSET_SQL).get(2) as { total: number };
  assert.equal(total.total, 12);
  const kinds = db.prepare(`SELECT holder_type FROM balances ORDER BY holder_type`).all() as { holder_type: string }[];
  assert.deepEqual(
    kinds.map((row) => row.holder_type),
    ["address", "utxo"],
  );
});

test("orders and matches use source transaction identities and reconstruct public match ids", () => {
  const db = fixture();
  const h0 = new Uint8Array(32).fill(0x11),
    h1 = new Uint8Array(32).fill(0x22);
  db.prepare(
    `INSERT INTO orders(tx_index,tx_hash,block_index,source_id,give_asset_id,get_asset_id,status)
    VALUES(?,?,?,?,?,?,?)`,
  ).run(8, h0, 100, 1, 1, 2, "open");
  db.prepare(
    `INSERT INTO order_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,block_index,status)
    VALUES(?,?,?,?,?,?)`,
  ).run(8, 7, h0, h1, 101, "completed");
  const row = db.prepare(ORDER_MATCH_PUBLIC_ID_SQL).get(8, 7) as { id: string };
  assert.equal(row.id, `${"11".repeat(32)}_${"22".repeat(32)}`);
  let duplicate = "";
  try {
    db.prepare(`INSERT INTO order_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,block_index) VALUES(?,?,?,?,?)`).run(
      8,
      7,
      h0,
      h1,
      102,
    );
  } catch (error) {
    duplicate = (error as Error).message;
  }
  assert.equal(duplicate.includes("UNIQUE constraint failed"), true);
});

test("issuances retain one-to-many transaction message identity", () => {
  const db = fixture();
  const hash = new Uint8Array(32).fill(0xee);
  db.prepare(
    `INSERT INTO issuances(event_index,tx_index,tx_hash,msg_index,block_index,asset_id,status)
    VALUES(?,?,?,?,?,?,?)`,
  ).run(20, 12, hash, 0, 100, 2, "valid");
  db.prepare(
    `INSERT INTO issuances(event_index,tx_index,tx_hash,msg_index,block_index,asset_id,status)
    VALUES(?,?,?,?,?,?,?)`,
  ).run(21, 12, hash, 1, 100, 2, "valid");
  const count = db.prepare(`SELECT COUNT(*) n FROM issuances WHERE tx_index=12`).get() as { n: number };
  assert.equal(count.n, 2);
});
