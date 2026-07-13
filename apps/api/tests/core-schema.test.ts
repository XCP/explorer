import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import {
  CORE_SENDS_BY_ADDRESS_SQL,
  CORE_BALANCES_BY_ADDRESS_SQL,
  CORE_TOTAL_BY_ASSET_SQL,
  ORDER_MATCH_PUBLIC_ID_SQL,
  CORE_BLOCK_PAGE_SQL,
  CORE_BLOCK_BY_INDEX_SQL,
  CORE_TRANSACTIONS_BY_BLOCK_SQL,
  CORE_TRANSACTION_BY_HASH_SQL,
} from "#api/queries/core";
import {
  CORE_COLUMN_RULES,
  CORE_SNAPSHOT_TABLES,
  CORE_TABLE_MANIFEST,
  GENERATED_CORE_TABLES,
} from "#api/indexer/core-manifest";

const CORE_DDL = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"))
  .join("\n");

test("core manifest classifies the complete live source schema exactly once", () => {
  assert.equal(CORE_TABLE_MANIFEST.length, 60);
  const sources = CORE_TABLE_MANIFEST.map((entry) => entry.source);
  assert.equal(new Set(sources).size, sources.length);
  assert.deepEqual([...sources].sort(), sources);
  assert.deepEqual(
    CORE_TABLE_MANIFEST.filter((entry) => entry.disposition === "merge").map((entry) => entry.source),
    ["credits", "debits"],
  );
});

test("the reusable snapshot includes every source relation that belongs in the final database", () => {
  const requiredSeedTables = CORE_TABLE_MANIFEST.filter(
    (entry) => entry.disposition !== "platform" && entry.disposition !== "discard",
  ).map((entry) => entry.source);
  assert.deepEqual(CORE_SNAPSHOT_TABLES, requiredSeedTables);
  assert.equal(CORE_SNAPSHOT_TABLES.includes("tags"), true);
  assert.equal(CORE_SNAPSHOT_TABLES.includes("trades"), true);
});

test("every table already present in compact DDL is declared by the manifest", () => {
  const declaredTargets = new Set<string>([
    ...CORE_TABLE_MANIFEST.flatMap((entry) => (entry.target == null ? [] : [entry.target])),
    ...GENERATED_CORE_TABLES,
  ]);
  const ddlTables = [...CORE_DDL.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(
    ddlTables.filter((table) => !declaredTargets.has(table)),
    [],
  );
});

test("every canonical or merged source relation has a compact target table", () => {
  const ddlTables = new Set([...CORE_DDL.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((match) => match[1]));
  const required = new Set(
    CORE_TABLE_MANIFEST.filter((entry) => entry.disposition === "compact" || entry.disposition === "merge").flatMap(
      (entry) => (entry.target == null ? [] : [entry.target]),
    ),
  );
  assert.deepEqual(
    [...required].filter((table) => !ddlTables.has(table)),
    [],
  );
});

test("complete compact DDL contains every required target relation", () => {
  const ddlTables = new Set([...CORE_DDL.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((match) => match[1]));
  const required = new Set<string>([
    ...CORE_TABLE_MANIFEST.flatMap((entry) => (entry.target == null ? [] : [entry.target])),
    ...GENERATED_CORE_TABLES,
  ]);
  assert.deepEqual(
    [...required].filter((table) => !ddlTables.has(table)),
    [],
  );
});

test("every exceptional source-column representation resolves to compact columns", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(CORE_DDL);
  for (const [table, columns] of Object.entries(CORE_COLUMN_RULES)) {
    const target = CORE_TABLE_MANIFEST.find((entry) => entry.source === table)?.target;
    assert.ok(target, `${table} has no target table`);
    const targetColumns = new Set(
      (db.prepare(`PRAGMA table_info("${target}")`).all() as { name: string }[]).map((column) => column.name),
    );
    for (const [sourceColumn, rule] of Object.entries(columns)) {
      for (const targetColumn of rule.targets) {
        assert.equal(targetColumns.has(targetColumn), true, `${table}.${sourceColumn} -> ${targetColumn}`);
      }
      if (rule.targets.length === 0) assert.equal(rule.invariant, "null_only", `${table}.${sourceColumn}`);
    }
  }
});

test("canonical protocol identities reject duplicate matches and ledger directions outside the domain", () => {
  const db = fixture();
  const h0 = new Uint8Array(32).fill(0x31);
  const h1 = new Uint8Array(32).fill(0x32);
  db.prepare(`INSERT INTO bet_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,block_index) VALUES(?,?,?,?,?)`).run(
    30,
    31,
    h0,
    h1,
    100,
  );
  assert.throws(() =>
    db
      .prepare(`INSERT INTO bet_matches(tx0_index,tx1_index,tx0_hash,tx1_hash,block_index) VALUES(?,?,?,?,?)`)
      .run(30, 31, h0, h1, 101),
  );
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO ledger_events(event_index,direction,block_index,address_id,asset_id,quantity) VALUES(?,?,?,?,?,?)`,
      )
      .run(1, 2, 100, 1, 1, "1"),
  );
});

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(CORE_DDL);
  db.exec(`
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob');
    INSERT INTO asset_dictionary(asset) VALUES('RARE');
  `);
  db.prepare(
    `INSERT INTO transactions(tx_index,tx_hash,block_index,block_time,source_id,destination_id,btc_amount,fee,supported,utxos_info)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(7, new Uint8Array(32).fill(0xab), 100, 1, 1, 2, "0", "10", 1, null);
  db.prepare(
    `INSERT INTO blocks(block_index,block_hash,block_time,previous_block_hash,transaction_count)
     VALUES(?,?,?,?,?)`,
  ).run(100, new Uint8Array(32).fill(0xaa), 1, new Uint8Array(32).fill(0x99), 1);
  db.prepare(
    `INSERT INTO sends(event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,asset_id,quantity,quantity_normalized,send_type,status,msg_index)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(9, 7, new Uint8Array(32).fill(0xab), 100, 1, 1, 2, 3, "5", "5", "send", "valid", 0);
  db.prepare(`INSERT INTO balances(address_id,asset_id,quantity,quantity_normalized) VALUES(?,?,?,?)`).run(
    1,
    3,
    "5",
    "5",
  );
  return db;
}

test("core sends preserve source one-to-many identity and compact hashes", () => {
  const rows = fixture().prepare(CORE_SENDS_BY_ADDRESS_SQL).all(1, 50, 0) as { tx_hash: string; asset: string }[];
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

test("core address reads search ids before decoding", () => {
  const db = fixture();
  const sendPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_SENDS_BY_ADDRESS_SQL}`).all(1, 50, 0) as {
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
  const balancePlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_BALANCES_BY_ADDRESS_SQL}`).all(1, 50, 0) as {
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

test("core balances split UTXOs and enforce exactly one holder representation", () => {
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
  ).run(new Uint8Array(32).fill(0xcd), 2, 1, 3, "7", "7");
  const total = db.prepare(CORE_TOTAL_BY_ASSET_SQL).get(3) as { total: number };
  assert.equal(total.total, 12);
  const totalPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_TOTAL_BY_ASSET_SQL}`).all(3) as { detail: string }[];
  assert.equal(
    totalPlan.some((row) => row.detail.includes("idx_balances_asset_quantity")),
    true,
  );
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
  ).run(8, h0, 100, 1, 2, 3, "open");
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
  ).run(20, 12, hash, 0, 100, 3, "valid");
  db.prepare(
    `INSERT INTO issuances(event_index,tx_index,tx_hash,msg_index,block_index,asset_id,status)
    VALUES(?,?,?,?,?,?,?)`,
  ).run(21, 12, hash, 1, 100, 3, "valid");
  const count = db.prepare(`SELECT COUNT(*) n FROM issuances WHERE tx_index=12`).get() as { n: number };
  assert.equal(count.n, 2);
});

test("compact chain reads restore the public hash, address, and null-only data shape", () => {
  const db = fixture();
  const blocks = db.prepare(CORE_BLOCK_PAGE_SQL).all(50, 0) as { block_hash: string }[];
  assert.equal(blocks[0].block_hash, "aa".repeat(32));
  const block = db.prepare(CORE_BLOCK_BY_INDEX_SQL).get(100) as { previous_block_hash: string };
  assert.equal(block.previous_block_hash, "99".repeat(32));
  const transactions = db.prepare(CORE_TRANSACTIONS_BY_BLOCK_SQL).all(100) as {
    tx_hash: string;
    source: string;
    destination: string;
  }[];
  assert.deepEqual(
    { ...transactions[0] },
    {
      tx_index: 7,
      tx_hash: "ab".repeat(32),
      source: "alice",
      destination: "bob",
      fee: "10",
    },
  );
  const transaction = db.prepare(CORE_TRANSACTION_BY_HASH_SQL).get("ab".repeat(32)) as {
    data: string | null;
    source: string;
  };
  assert.equal(transaction.data, null);
  assert.equal(transaction.source, "alice");
});

test("compact chain pages seek their base indexes before decoding", () => {
  const db = fixture();
  const blockPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_BLOCK_PAGE_SQL}`).all(50, 0) as { detail: string }[];
  assert.equal(
    blockPlan.some((row) => row.detail.includes("SCAN blocks")),
    true,
  );
  const txPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_TRANSACTIONS_BY_BLOCK_SQL}`).all(100) as {
    detail: string;
  }[];
  assert.equal(
    txPlan.some((row) => row.detail.includes("idx_transactions_block")),
    true,
  );
  const detailPlan = db.prepare(`EXPLAIN QUERY PLAN ${CORE_TRANSACTION_BY_HASH_SQL}`).all("ab".repeat(32)) as {
    detail: string;
  }[];
  assert.equal(
    detailPlan.some((row) => row.detail.includes("sqlite_autoindex_transactions_1")),
    true,
  );
});

test("latest compact prices seek the currency history", () => {
  const db = fixture();
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN SELECT usd,day FROM prices WHERE currency=? ORDER BY day DESC LIMIT 1`)
    .all("XCP") as { detail: string }[];
  assert.equal(
    plan.some((row) => row.detail.includes("idx_prices_currency_day")),
    true,
  );
});
