/**
 * Replay parity: the non-verbose event stream must produce byte-identical rows to the verbose one.
 *
 * The replay fetches /events WITHOUT verbose (verbose inlines stamp-asset descriptions — multi-MB
 * blobs that blew Worker memory) and derives locally everything verbose used to provide: divisibility
 * from our own asset rows, normalized quantities via normalize(), block_time tracked from NEW_BLOCK.
 * This test replays one fixture stream twice — once with verbose enrichment, once mechanically
 * stripped to the non-verbose shape — and asserts every table dumps identically. Direct value
 * assertions on the stripped run keep the fixture honest (a wrong param name would otherwise make
 * both runs agree on nulls).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { syncCoreEvents } from "#api/indexer/sync";

const CORE_DDL = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"))
  .join("\n");

class PreparedStatement {
  private binds: unknown[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.binds = values;
    return this;
  }
  async run() {
    this.database.prepare(this.sql).run(...(this.binds as never[]));
    return { success: true, meta: { changes: 1 } };
  }
  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...(this.binds as never[])) as T[] };
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...(this.binds as never[])) as T | undefined) ?? null;
  }
}

function d1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new PreparedStatement(database, sql);
    },
    async batch(statements: PreparedStatement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

/* ---------- the fixture stream (verbose shape) ---------- */

const ALICE = "bc1qalice";
const BOB = "bc1qbob";
const TX = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const DIVISIBLE_INFO = { divisible: true, asset_longname: null, description: "d".repeat(64), locked: false };
const INDIVISIBLE_INFO = { divisible: false, asset_longname: null, description: "r".repeat(64), locked: false };

interface FixtureEvent {
  event: string;
  event_index: number;
  block_index: number;
  tx_hash: string | null;
  params: Record<string, unknown>;
}

const fx = (
  event: string,
  eventIndex: number,
  blockIndex: number,
  txHash: string | null,
  params: Record<string, unknown>,
): FixtureEvent => ({
  event,
  event_index: eventIndex,
  block_index: blockIndex,
  tx_hash: txHash,
  params: { ...params, block_index: blockIndex, block_time: blockIndex === 101 ? 1000 : 2000 },
});

// Two blocks over two fetch pages: page one issues the assets, page two spends them — so the
// second chunk's divisibility resolution must come from the mirror's own rows, not the pre-scan.
const PAGE_ONE: FixtureEvent[] = [
  fx("NEW_BLOCK", 0, 101, null, { block_hash: "aa".repeat(32), previous_block_hash: "99".repeat(32), difficulty: 1 }),
  fx("NEW_TRANSACTION", 1, 101, TX(1), { tx_index: 1, tx_hash: TX(1), source: ALICE, btc_amount: 0, fee: 500 }),
  fx("DEBIT", 2, 101, TX(1), {
    action: "issuance fee",
    address: ALICE,
    asset: "XCP",
    quantity: 50000000,
    quantity_normalized: "0.50000000",
    asset_info: { divisible: true },
    tx_index: 1,
    utxo: null,
    utxo_address: null,
  }),
  fx("ASSET_CREATION", 3, 101, TX(1), { asset: "DIVISIBLEA", asset_longname: null, asset_id: "1001" }),
  fx("ASSET_ISSUANCE", 4, 101, TX(1), {
    asset: "DIVISIBLEA",
    asset_longname: null,
    divisible: true,
    quantity: 150000000,
    quantity_normalized: "1.50000000",
    fee_paid: 50000000,
    fee_paid_normalized: "0.50000000",
    issuer: ALICE,
    source: ALICE,
    transfer: false,
    locked: false,
    description: "d".repeat(64),
    status: "valid",
    tx_index: 1,
    tx_hash: TX(1),
    msg_index: 0,
  }),
  fx("CREDIT", 5, 101, TX(1), {
    calling_function: "issuance",
    address: ALICE,
    asset: "DIVISIBLEA",
    quantity: 150000000,
    quantity_normalized: "1.50000000",
    asset_info: DIVISIBLE_INFO,
    tx_index: 1,
    utxo: null,
    utxo_address: null,
  }),
  fx("NEW_TRANSACTION", 6, 101, TX(2), { tx_index: 2, tx_hash: TX(2), source: ALICE, btc_amount: 0, fee: 500 }),
  fx("ASSET_CREATION", 7, 101, TX(2), { asset: "RARECARD", asset_longname: null, asset_id: "1002" }),
  fx("ASSET_ISSUANCE", 8, 101, TX(2), {
    asset: "RARECARD",
    asset_longname: null,
    divisible: false,
    quantity: 1000,
    quantity_normalized: "1000",
    fee_paid: 0,
    fee_paid_normalized: "0.00000000",
    issuer: ALICE,
    source: ALICE,
    transfer: false,
    locked: false,
    description: "r".repeat(64),
    status: "valid",
    tx_index: 2,
    tx_hash: TX(2),
    msg_index: 0,
  }),
  fx("CREDIT", 9, 101, TX(2), {
    calling_function: "issuance",
    address: ALICE,
    asset: "RARECARD",
    quantity: 1000,
    quantity_normalized: "1000",
    asset_info: INDIVISIBLE_INFO,
    tx_index: 2,
    utxo: null,
    utxo_address: null,
  }),
  fx("BURN", 10, 101, TX(3), {
    tx_index: 3,
    tx_hash: TX(3),
    source: BOB,
    burned: 100000000,
    burned_normalized: "1.00000000",
    earned: 148000000000,
    earned_normalized: "1480.00000000",
    status: "valid",
  }),
  fx("BLOCK_PARSED", 11, 101, null, {
    ledger_hash: "b1".repeat(32),
    txlist_hash: "b2".repeat(32),
    messages_hash: "b3".repeat(32),
    transaction_count: 3,
  }),
];

const PAGE_TWO: FixtureEvent[] = [
  fx("NEW_BLOCK", 12, 102, null, { block_hash: "ab".repeat(32), previous_block_hash: "aa".repeat(32), difficulty: 1 }),
  fx("NEW_TRANSACTION", 13, 102, TX(4), { tx_index: 4, tx_hash: TX(4), source: ALICE, btc_amount: 0, fee: 500 }),
  fx("DEBIT", 14, 102, TX(4), {
    action: "send",
    address: ALICE,
    asset: "DIVISIBLEA",
    quantity: 50000000,
    quantity_normalized: "0.50000000",
    asset_info: DIVISIBLE_INFO,
    tx_index: 4,
    utxo: null,
    utxo_address: null,
  }),
  fx("CREDIT", 15, 102, TX(4), {
    calling_function: "send",
    address: BOB,
    asset: "DIVISIBLEA",
    quantity: 50000000,
    quantity_normalized: "0.50000000",
    asset_info: DIVISIBLE_INFO,
    tx_index: 4,
    utxo: null,
    utxo_address: null,
  }),
  fx("ENHANCED_SEND", 16, 102, TX(4), {
    asset: "DIVISIBLEA",
    quantity: 50000000,
    quantity_normalized: "0.50000000",
    asset_info: DIVISIBLE_INFO,
    source: ALICE,
    destination: BOB,
    memo: null,
    msg_index: 0,
    send_type: "send",
    status: "valid",
    tx_index: 4,
    tx_hash: TX(4),
  }),
  fx("ASSET_DESTRUCTION", 17, 102, TX(5), {
    asset: "RARECARD",
    quantity: 5,
    quantity_normalized: "5",
    asset_info: INDIVISIBLE_INFO,
    source: ALICE,
    tag: "burn",
    status: "valid",
    tx_index: 5,
    tx_hash: TX(5),
  }),
  fx("NEW_TRANSACTION", 18, 102, TX(6), { tx_index: 6, tx_hash: TX(6), source: BOB, btc_amount: 0, fee: 500 }),
  fx("OPEN_DISPENSER", 19, 102, TX(6), {
    asset: "DIVISIBLEA",
    give_quantity: 10000000,
    give_quantity_normalized: "0.10000000",
    escrow_quantity: 90000000,
    give_remaining: 90000000,
    give_remaining_normalized: "0.90000000",
    satoshirate: 174,
    satoshirate_normalized: "0.00000174",
    asset_info: DIVISIBLE_INFO,
    source: BOB,
    origin: BOB,
    oracle_address: null,
    status: 0,
    dispense_count: 0,
    tx_index: 6,
    tx_hash: TX(6),
  }),
  fx("DISPENSE", 20, 102, TX(7), {
    asset: "DIVISIBLEA",
    dispense_quantity: 10000000,
    dispense_quantity_normalized: "0.10000000",
    btc_amount: 174,
    btc_amount_normalized: "0.00000174",
    asset_info: DIVISIBLE_INFO,
    source: BOB,
    destination: ALICE,
    dispenser_tx_hash: TX(6),
    dispense_index: 0,
    tx_index: 7,
    tx_hash: TX(7),
  }),
  fx("DISPENSER_UPDATE", 21, 102, TX(7), {
    asset: "DIVISIBLEA",
    give_remaining: 80000000,
    give_remaining_normalized: "0.80000000",
    asset_info: DIVISIBLE_INFO,
    dispense_count: 1,
    source: BOB,
    status: 0,
    tx_hash: TX(6),
  }),
  fx("NEW_TRANSACTION", 0, 102, TX(8), { tx_index: 8, tx_hash: TX(8), source: ALICE, btc_amount: 0, fee: 500 }),
  fx("NEW_TRANSACTION", 0, 102, TX(10), { tx_index: 10, tx_hash: TX(10), source: BOB, btc_amount: 0, fee: 500 }),
  fx("OPEN_ORDER", 22, 102, TX(8), {
    give_asset: "RARECARD",
    give_quantity: 100,
    give_quantity_normalized: "100",
    give_remaining: 100,
    give_remaining_normalized: "100",
    give_asset_info: INDIVISIBLE_INFO,
    get_asset: "XCP",
    get_quantity: 5000000000,
    get_quantity_normalized: "50.00000000",
    get_remaining: 5000000000,
    get_remaining_normalized: "50.00000000",
    get_asset_info: { divisible: true },
    expiration: 1000,
    expire_index: 1102,
    fee_required: 0,
    fee_required_normalized: "0.00000000",
    fee_required_remaining: 0,
    fee_required_remaining_normalized: "0.00000000",
    fee_provided: 174,
    fee_provided_normalized: "0.00000174",
    fee_provided_remaining: 174,
    fee_provided_remaining_normalized: "0.00000174",
    source: ALICE,
    status: "open",
    tx_index: 8,
    tx_hash: TX(8),
  }),
  fx("BTC_PAY", 23, 102, TX(9), {
    btc_amount: 5000,
    btc_amount_normalized: "0.00005000",
    order_match_id: `${TX(8)}_${TX(10)}`,
    source: BOB,
    destination: ALICE,
    status: "valid",
    tx_index: 9,
    tx_hash: TX(9),
  }),
  fx("ASSET_DIVIDEND", 24, 102, TX(11), {
    asset: "RARECARD",
    asset_info: INDIVISIBLE_INFO,
    dividend_asset: "DIVISIBLEA",
    dividend_asset_info: DIVISIBLE_INFO,
    quantity_per_unit: 1000000,
    quantity_per_unit_normalized: "0.01000000",
    fee_paid: 20000000,
    fee_paid_normalized: "0.20000000",
    source: ALICE,
    status: "valid",
    tx_index: 11,
    tx_hash: TX(11),
  }),
  fx("BLOCK_PARSED", 25, 102, null, {
    ledger_hash: "c1".repeat(32),
    txlist_hash: "c2".repeat(32),
    messages_hash: "c3".repeat(32),
    transaction_count: 8,
  }),
];

// The literal indexes above are decorative — the stream is renumbered contiguously here, which is
// what the replay cursor arithmetic assumes.
[...PAGE_ONE, ...PAGE_TWO].forEach((event, index) => (event.event_index = index));

/* ---------- verbose -> non-verbose stripping ---------- */

// Exactly what the non-verbose stream omits: per-event block_time (except NEW_BLOCK and
// NEW_TRANSACTION, which state it natively), every *_normalized derivative, and asset_info
// enrichment. Everything else — raw quantities, names, hashes — is identical on the wire.
function stripVerbose(events: FixtureEvent[]): FixtureEvent[] {
  return events.map((event) => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.params)) {
      if (key.endsWith("_normalized") || key === "asset_info" || key.endsWith("_asset_info")) continue;
      if (key === "block_time" && event.event !== "NEW_BLOCK" && event.event !== "NEW_TRANSACTION") continue;
      params[key] = value;
    }
    return { ...event, params };
  });
}

/* ---------- replay one variant ---------- */

async function replay(pages: FixtureEvent[][]): Promise<DatabaseSync> {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const tipIndex = pages.flat().length - 1;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/events?limit=1")) return new Response(JSON.stringify({ result_count: tipIndex + 1 }));
    if (url.endsWith("/blocks/last")) return new Response(JSON.stringify({ result: { block_index: 102 } }));
    if (url.endsWith("/blocks/102")) return new Response(JSON.stringify({ result: { block_hash: "ab".repeat(32) } }));
    const cursor = /\/events\?cursor=(\d+)&limit=(\d+)/.exec(url);
    if (cursor) {
      // fetchAsc requests cursor=from+chunk-1&limit=chunk; recover `from` and serve its page.
      const from = Number(cursor[1]) - Number(cursor[2]) + 1;
      const page = pages.find((events) => events[0].event_index >= from) ?? [];
      return new Response(JSON.stringify({ result: [...page].reverse() }));
    }
    throw new Error(`unexpected Counterparty request: ${url}`);
  };
  try {
    const result = await syncCoreEvents({ CORE_DB: d1(database), COUNTERPARTY_API_BASE: "https://counterparty.test" });
    assert.equal(result.caught_up, true);
    assert.equal(result.last_event_index, tipIndex);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return database;
}

/* ---------- dump + compare ---------- */

function dump(database: DatabaseSync): Record<string, unknown[]> {
  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    out[name] = (database.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          // Trigger-maintained bookkeeping uses unixepoch(). Two equivalent replays can cross a
          // second boundary, so normalize wall-clock metadata while comparing canonical results.
          key === "updated_at"
            ? 0
            : value instanceof Uint8Array
              ? Array.from(value)
                  .map((byte) => byte.toString(16).padStart(2, "0"))
                  .join("")
              : value,
        ]),
      ),
    );
  }
  return out;
}

test("non-verbose replay stores byte-identical rows to verbose replay", async () => {
  const verbose = await replay([PAGE_ONE, PAGE_TWO]);
  const stripped = await replay([stripVerbose(PAGE_ONE), stripVerbose(PAGE_TWO)]);

  // The fixture must actually exercise the derivations — assert the stripped run's stored values
  // directly so a misnamed param can't collapse both runs into agreeing nulls.
  const row = <T>(sql: string): T => ({ ...stripped.prepare(sql).get() }) as T;
  assert.deepEqual(row(`SELECT burned_normalized b, earned_normalized e, block_time t FROM burns`), {
    b: "1.00000000",
    e: "1480.00000000",
    t: 1000,
  });
  assert.deepEqual(
    row(`SELECT satoshirate_normalized s, give_remaining_normalized g, dispense_count c FROM dispensers`),
    { s: "0.00000174", g: "0.80000000", c: 1 },
  );
  assert.deepEqual(row(`SELECT quantity_per_unit_normalized q FROM dividends`), { q: "0.01000000" });
  assert.deepEqual(row(`SELECT btc_amount_normalized n FROM btcpays`), { n: "0.00005000" });
  assert.deepEqual(row(`SELECT quantity_normalized q, block_time t FROM sends`), { q: "0.50000000", t: 2000 });
  assert.deepEqual(row(`SELECT quantity_normalized q FROM destructions`), { q: "5" });
  assert.deepEqual(
    row(
      `SELECT quantity_normalized q FROM balances
        JOIN address_dictionary a ON a.address_id=balances.address_id
        JOIN asset_dictionary s ON s.asset_id=balances.asset_id
       WHERE a.address='${BOB}' AND s.asset='DIVISIBLEA'`,
    ),
    { q: "0.50000000" },
  );

  assert.deepEqual(dump(stripped), dump(verbose));
});
