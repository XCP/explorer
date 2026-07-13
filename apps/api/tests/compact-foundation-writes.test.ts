import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createIdentitySet, dictionaryStatements } from "#api/indexer/dictionaries";
import { applyCompactBalanceDeltas } from "#api/indexer/balance-store";
import { dispatch } from "#api/indexer/events/dispatch";
import type { Ctx, Ev, Stmt } from "#api/indexer/events/context";

const CORE_DDL = [
  "migrations-core/0001_core.sql",
  "migrations-core/0002_protocol.sql",
  "migrations-core/0003_projections.sql",
]
  .map((path) => readFileSync(path, "utf8"))
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
    this.database.prepare(this.sql).run(...this.binds);
    return { success: true, meta: { changes: 1 } };
  }
  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.binds) as T[] };
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

function context(): Ctx {
  return {
    stmts: [],
    ledgerStmts: [],
    identities: createIdentitySet(),
    compact: { stmts: [], identities: createIdentitySet() },
    balDelta: new Map(),
    maxBlock: 0,
    supplyDirty: new Set(),
  };
}

async function execute(database: DatabaseSync, statements: Stmt[]) {
  const target = d1(database);
  for (const statement of statements) await statement(target).run();
}

async function executeCompact(database: DatabaseSync, ctx: Ctx) {
  if (!ctx.compact) throw new Error("compact test context missing");
  await execute(database, dictionaryStatements(ctx.compact.identities));
  await execute(database, ctx.compact.stmts);
}

function event(event: string, params: Record<string, unknown>, eventIndex: number): Ev {
  return {
    event,
    params,
    event_index: eventIndex,
    tx_hash: typeof params.tx_hash === "string" ? params.tx_hash : null,
    block_index: Number(params.block_index ?? 100),
  };
}

test("compact foundational writes preserve identities and converge on replay", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const hash = "ab".repeat(32);
  const previousHash = "99".repeat(32);
  const utxoHash = "cd".repeat(32);
  const utxo = `${utxoHash}:2`;
  const ctx = context();

  dispatch(
    event(
      "NEW_BLOCK",
      { block_index: 100, block_hash: "aa".repeat(32), previous_block_hash: previousHash, block_time: 10 },
      1,
    ),
    ctx,
  );
  dispatch(event("BLOCK_PARSED", { block_index: 100, transaction_count: 1 }, 2), ctx);
  dispatch(
    event(
      "NEW_TRANSACTION",
      { tx_index: 7, tx_hash: hash, block_index: 100, source: "alice", destination: "bob", fee: "10" },
      3,
    ),
    ctx,
  );
  dispatch(
    event("CREDIT", { address: "alice", asset: "RARE", quantity: "5", block_index: 100, tx_hash: hash }, 4),
    ctx,
  );
  dispatch(
    event(
      "CREDIT",
      {
        utxo,
        utxo_address: "alice",
        asset: "RARE",
        quantity: "7",
        block_index: 100,
        tx_hash: hash,
      },
      5,
    ),
    ctx,
  );

  const compact = ctx.compact;
  if (!compact) throw new Error("compact test context missing");
  await execute(database, dictionaryStatements(compact.identities));
  await execute(database, compact.stmts);
  await execute(database, ctx.ledgerStmts);
  await applyCompactBalanceDeltas(d1(database), ctx.balDelta, true);
  await execute(database, compact.stmts);
  await execute(database, ctx.ledgerStmts);
  await applyCompactBalanceDeltas(d1(database), ctx.balDelta, true);

  const transaction = database
    .prepare(
      `SELECT lower(hex(t.tx_hash)) tx_hash,s.address source,d.address destination
       FROM transactions t
       LEFT JOIN address_dictionary s ON s.address_id=t.source_id
       LEFT JOIN address_dictionary d ON d.address_id=t.destination_id`,
    )
    .get() as { tx_hash: string; source: string; destination: string };
  assert.deepEqual({ ...transaction }, { tx_hash: hash, source: "alice", destination: "bob" });
  const block = database.prepare(`SELECT lower(hex(previous_block_hash)) previous_hash FROM blocks`).get() as {
    previous_hash: string;
  };
  assert.equal(block.previous_hash, previousHash);
  const ledger = database
    .prepare(
      `SELECT e.event_index,e.direction,e.quantity,a.address,s.asset,ua.address utxo_address
       FROM ledger_events e
       JOIN address_dictionary a ON a.address_id=e.address_id
       JOIN asset_dictionary s ON s.asset_id=e.asset_id
       LEFT JOIN address_dictionary ua ON ua.address_id=e.utxo_address_id
       ORDER BY e.event_index`,
    )
    .all() as {
    event_index: number;
    direction: number;
    quantity: string;
    address: string;
    asset: string;
    utxo_address: string | null;
  }[];
  assert.deepEqual(
    ledger.map((row) => ({ ...row })),
    [
      { event_index: 4, direction: 1, quantity: "5", address: "alice", asset: "RARE", utxo_address: null },
      { event_index: 5, direction: 1, quantity: "7", address: utxo, asset: "RARE", utxo_address: "alice" },
    ],
  );
  const balances = database
    .prepare(
      `SELECT CASE WHEN b.address_id IS NOT NULL THEN a.address
                   ELSE lower(hex(b.utxo_tx_hash))||':'||b.utxo_vout END holder,
              ua.address utxo_address,s.asset,b.quantity,b.updated_event_index
       FROM balances b
       LEFT JOIN address_dictionary a ON a.address_id=b.address_id
       LEFT JOIN address_dictionary ua ON ua.address_id=b.utxo_address_id
       JOIN asset_dictionary s ON s.asset_id=b.asset_id
       ORDER BY holder`,
    )
    .all() as {
    holder: string;
    utxo_address: string | null;
    asset: string;
    quantity: string;
    updated_event_index: number;
  }[];
  assert.deepEqual(
    balances.map((row) => ({ ...row })),
    [
      { holder: "alice", utxo_address: null, asset: "RARE", quantity: "5", updated_event_index: 4 },
      { holder: utxo, utxo_address: "alice", asset: "RARE", quantity: "7", updated_event_index: 5 },
    ],
  );
  const snapshot = database.prepare(`SELECT COUNT(*) count FROM balance_snapshots`).get() as { count: number };
  assert.equal(snapshot.count, 2);
});

test("compact balance catch-up applies only events above an imported row high-water", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  database.exec(`
    INSERT INTO address_dictionary(address) VALUES ('alice');
    INSERT INTO asset_dictionary(asset) VALUES ('RARE');
    INSERT INTO balances(address_id,asset_id,quantity,updated_block_index,updated_event_index)
    SELECT a.address_id,s.asset_id,'10',100,4
    FROM address_dictionary a,asset_dictionary s
    WHERE a.address='alice' AND s.asset='RARE';
  `);
  const ctx = context();
  dispatch(event("CREDIT", { address: "alice", asset: "RARE", quantity: "5" }, 3), ctx);
  dispatch(event("CREDIT", { address: "alice", asset: "RARE", quantity: "7" }, 5), ctx);

  await applyCompactBalanceDeltas(d1(database), ctx.balDelta, false);

  const balance = database.prepare(`SELECT quantity,updated_event_index FROM balances`).get() as {
    quantity: string;
    updated_event_index: number;
  };
  assert.deepEqual({ ...balance }, { quantity: "17", updated_event_index: 5 });
});

test("compact asset creation, issuances, and MPMA sends preserve canonical identities", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const hash = "ef".repeat(32);
  const asset = "A123";
  const ctx = context();

  dispatch(event("ASSET_CREATION", { asset_name: asset, asset_id: "123", asset_longname: "PARENT.SUB" }, 1), ctx);
  dispatch(
    event(
      "ASSET_ISSUANCE",
      {
        tx_index: 8,
        tx_hash: hash,
        asset,
        asset_longname: "PARENT.SUB",
        source: "issuer",
        issuer: "issuer",
        quantity: "100",
        divisible: true,
        description: "first",
        mime_type: "text/plain",
        status: "valid",
      },
      2,
    ),
    ctx,
  );
  for (const [eventIndex, destination, msgIndex] of [
    [3, "alice", 0],
    [4, "bob", 1],
  ] as const) {
    dispatch(
      event(
        "MPMA_SEND",
        {
          tx_index: 9,
          tx_hash: hash,
          source: "issuer",
          destination,
          asset,
          quantity: "10",
          msg_index: msgIndex,
          memo: "batch",
          status: "valid",
        },
        eventIndex,
      ),
      ctx,
    );
  }
  dispatch(
    event(
      "RESET_ISSUANCE",
      {
        tx_index: 10,
        tx_hash: "12".repeat(32),
        asset,
        asset_longname: "PARENT.SUB",
        source: "issuer",
        issuer: "issuer",
        quantity: "0",
        divisible: false,
        reset: true,
        description: "reset",
        status: "valid",
      },
      5,
    ),
    ctx,
  );

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  const assetRow = database
    .prepare(
      `SELECT d.asset,a.asset_longname,a.numeric_asset_id,a.type,i.address issuer,o.address owner,
              a.divisible,a.description,a.first_issuance_block_index,a.last_issuance_block_index
       FROM assets a
       JOIN asset_dictionary d ON d.asset_id=a.asset_id
       LEFT JOIN address_dictionary i ON i.address_id=a.issuer_id
       LEFT JOIN address_dictionary o ON o.address_id=a.owner_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...assetRow },
    {
      asset,
      asset_longname: "PARENT.SUB",
      numeric_asset_id: "123",
      type: "subasset",
      issuer: "issuer",
      owner: "issuer",
      divisible: 0,
      description: "reset",
      first_issuance_block_index: 100,
      last_issuance_block_index: 100,
    },
  );
  const issuances = database
    .prepare(`SELECT event_index,tx_index,msg_index,divisible,reset FROM issuances ORDER BY event_index`)
    .all() as Record<string, unknown>[];
  assert.deepEqual(
    issuances.map((row) => ({ ...row })),
    [
      { event_index: 2, tx_index: 8, msg_index: 0, divisible: 1, reset: 0 },
      { event_index: 5, tx_index: 10, msg_index: 0, divisible: 0, reset: 1 },
    ],
  );
  const sends = database
    .prepare(
      `SELECT s.event_index,s.tx_index,s.msg_index,a.address destination,d.asset,s.send_type
       FROM sends s
       JOIN address_dictionary a ON a.address_id=s.destination_id
       JOIN asset_dictionary d ON d.asset_id=s.asset_id
       ORDER BY s.msg_index`,
    )
    .all() as Record<string, unknown>[];
  assert.deepEqual(
    sends.map((row) => ({ ...row })),
    [
      { event_index: 3, tx_index: 9, msg_index: 0, destination: "alice", asset, send_type: "mpma" },
      { event_index: 4, tx_index: 9, msg_index: 1, destination: "bob", asset, send_type: "mpma" },
    ],
  );
});

test("compact orders preserve match pairs and lifecycle updates", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const tx0 = "21".repeat(32);
  const tx1 = "43".repeat(32);
  const payHash = "65".repeat(32);
  const cancelHash = "87".repeat(32);
  const pair = `${tx0}_${tx1}`;
  const ctx = context();

  for (const [txIndex, txHash, source] of [
    [20, tx0, "maker"],
    [21, tx1, "taker"],
  ] as const) {
    dispatch(event("NEW_TRANSACTION", { tx_index: txIndex, tx_hash: txHash, source }, txIndex), ctx);
  }
  dispatch(
    event(
      "OPEN_ORDER",
      {
        tx_index: 20,
        tx_hash: tx0,
        source: "maker",
        give_asset: "XCP",
        give_quantity: "1000",
        get_asset: "BTC",
        get_quantity: "2000",
        expiration: 20,
        status: "open",
      },
      22,
    ),
    ctx,
  );
  dispatch(
    event(
      "OPEN_ORDER",
      {
        tx_index: 21,
        tx_hash: tx1,
        source: "taker",
        give_asset: "BTC",
        give_quantity: "2000",
        get_asset: "XCP",
        get_quantity: "1000",
        expiration: 20,
        status: "open",
      },
      23,
    ),
    ctx,
  );
  dispatch(
    event(
      "ORDER_MATCH",
      {
        id: pair,
        tx0_index: 20,
        tx1_index: 21,
        tx0_hash: tx0,
        tx1_hash: tx1,
        tx0_address: "maker",
        tx1_address: "taker",
        forward_asset: "XCP",
        forward_quantity: "1000",
        backward_asset: "BTC",
        backward_quantity: "2000",
        status: "pending",
      },
      24,
    ),
    ctx,
  );
  dispatch(event("ORDER_UPDATE", { tx_hash: tx1, give_remaining: "0", get_remaining: "0", status: "open" }, 25), ctx);
  dispatch(
    event(
      "BTC_PAY",
      {
        tx_index: 22,
        tx_hash: payHash,
        source: "taker",
        destination: "maker",
        order_match_id: pair,
        btc_amount: "2000",
        status: "valid",
      },
      26,
    ),
    ctx,
  );
  dispatch(
    event(
      "CANCEL_ORDER",
      {
        tx_index: 23,
        tx_hash: cancelHash,
        source: "maker",
        offer_hash: tx0,
        status: "valid",
      },
      27,
    ),
    ctx,
  );

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  const orderRows = database
    .prepare(`SELECT tx_index,give_remaining,get_remaining,status,closed_block_index FROM orders ORDER BY tx_index`)
    .all() as Record<string, unknown>[];
  assert.deepEqual(
    orderRows.map((row) => ({ ...row })),
    [
      { tx_index: 20, give_remaining: "1000", get_remaining: "2000", status: "cancelled", closed_block_index: 100 },
      { tx_index: 21, give_remaining: "0", get_remaining: "0", status: "open", closed_block_index: null },
    ],
  );
  const match = database
    .prepare(`SELECT tx0_index,tx1_index,status,forward_quantity,backward_quantity FROM order_matches`)
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...match },
    { tx0_index: 20, tx1_index: 21, status: "completed", forward_quantity: "1000", backward_quantity: "2000" },
  );
  const payment = database
    .prepare(`SELECT event_index,tx_index,order_match_tx0_index,order_match_tx1_index,btc_amount FROM btcpays`)
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...payment },
    { event_index: 26, tx_index: 22, order_match_tx0_index: 20, order_match_tx1_index: 21, btc_amount: "2000" },
  );
  const cancel = database.prepare(`SELECT tx_index,offer_tx_index,status FROM cancels`).get() as Record<
    string,
    unknown
  >;
  assert.deepEqual({ ...cancel }, { tx_index: 23, offer_tx_index: 20, status: "valid" });
});

test("compact transaction-level protocol records converge on replay", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const ctx = context();
  const hash = (byte: string) => byte.repeat(32);

  dispatch(
    event(
      "BURN",
      { tx_index: 30, tx_hash: hash("10"), source: "alice", burned: "100", earned: "200", status: "valid" },
      30,
    ),
    ctx,
  );
  dispatch(
    event(
      "ASSET_DESTRUCTION",
      {
        tx_index: 31,
        tx_hash: hash("20"),
        source: "alice",
        asset: "RARE",
        quantity: "3",
        tag: "cleanup",
        status: "valid",
      },
      31,
    ),
    ctx,
  );
  dispatch(
    event(
      "SWEEP",
      {
        tx_index: 32,
        tx_hash: hash("30"),
        source: "alice",
        destination: "bob",
        flags: 3,
        memo: "move",
        fee_paid: "5",
        status: "valid",
      },
      32,
    ),
    ctx,
  );
  dispatch(
    event(
      "ASSET_DIVIDEND",
      {
        tx_index: 33,
        tx_hash: hash("40"),
        source: "alice",
        asset: "RARE",
        dividend_asset: "XCP",
        quantity_per_unit: "7",
        fee_paid: "2",
        status: "valid",
      },
      33,
    ),
    ctx,
  );
  dispatch(
    event(
      "BROADCAST",
      {
        tx_index: 34,
        tx_hash: hash("50"),
        source: "alice",
        timestamp: 123,
        value: "1.5",
        fee_fraction_int: "10",
        text: "bt:DEPLOY|TICK",
        status: "valid",
      },
      34,
    ),
    ctx,
  );

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  for (const table of ["burns", "destructions", "sweeps", "dividends", "broadcasts"]) {
    const row = database.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number };
    assert.equal(row.count, 1, table);
  }
  const destruction = database
    .prepare(
      `SELECT a.address,d.asset,x.quantity,x.tag
       FROM destructions x
       JOIN address_dictionary a ON a.address_id=x.source_id
       JOIN asset_dictionary d ON d.asset_id=x.asset_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...destruction }, { address: "alice", asset: "RARE", quantity: "3", tag: "cleanup" });
  const sweep = database
    .prepare(
      `SELECT s.address source,d.address destination,x.flags,x.memo
       FROM sweeps x
       JOIN address_dictionary s ON s.address_id=x.source_id
       JOIN address_dictionary d ON d.address_id=x.destination_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...sweep }, { source: "alice", destination: "bob", flags: 3, memo: "move" });
  const broadcast = database.prepare(`SELECT btns,btns_op,btns_tick FROM broadcasts`).get() as Record<string, unknown>;
  assert.deepEqual({ ...broadcast }, { btns: 1, btns_op: "DEPLOY", btns_tick: "TICK" });
});

test("compact dispenser lifecycle preserves dispenser transaction relationships", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const dispenserHash = "71".repeat(32);
  const dispenseHash = "72".repeat(32);
  const refillHash = "73".repeat(32);
  const closeHash = "74".repeat(32);
  const ctx = context();

  dispatch(event("NEW_TRANSACTION", { tx_index: 40, tx_hash: dispenserHash, source: "vendor" }, 40), ctx);
  dispatch(
    event(
      "OPEN_DISPENSER",
      {
        tx_index: 40,
        tx_hash: dispenserHash,
        source: "vendor",
        origin: "owner",
        asset: "XCP",
        give_quantity: "100",
        escrow_quantity: "1000",
        give_remaining: "1000",
        satoshirate: "500",
        status: 0,
      },
      41,
    ),
    ctx,
  );
  dispatch(
    event(
      "DISPENSE",
      {
        tx_index: 41,
        tx_hash: dispenseHash,
        dispense_index: 0,
        dispenser_tx_hash: dispenserHash,
        source: "vendor",
        destination: "buyer",
        asset: "XCP",
        dispense_quantity: "100",
        btc_amount: "500",
      },
      42,
    ),
    ctx,
  );
  dispatch(
    event("DISPENSER_UPDATE", { tx_hash: dispenserHash, give_remaining: "900", dispense_count: 1, status: 0 }, 43),
    ctx,
  );
  dispatch(
    event(
      "REFILL_DISPENSER",
      {
        tx_index: 42,
        tx_hash: refillHash,
        dispenser_tx_hash: dispenserHash,
        source: "owner",
        destination: "vendor",
        asset: "XCP",
        dispense_quantity: "200",
      },
      44,
    ),
    ctx,
  );
  dispatch(
    event("DISPENSER_UPDATE", { tx_hash: dispenserHash, give_remaining: "1100", dispense_count: 1, status: 0 }, 45),
    ctx,
  );
  dispatch(
    event(
      "DISPENSER_UPDATE",
      { tx_hash: dispenserHash, status: 11, close_block_index: 105, last_status_tx_hash: closeHash },
      46,
    ),
    ctx,
  );

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  const dispenser = database
    .prepare(
      `SELECT d.tx_index,s.address source,o.address origin,a.asset,d.give_remaining,d.dispense_count,d.status,
              d.closed_block_index,lower(hex(d.last_status_tx_hash)) last_status_tx_hash
       FROM dispensers d
       JOIN address_dictionary s ON s.address_id=d.source_id
       JOIN address_dictionary o ON o.address_id=d.origin_id
       JOIN asset_dictionary a ON a.asset_id=d.asset_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...dispenser },
    {
      tx_index: 40,
      source: "vendor",
      origin: "owner",
      asset: "XCP",
      give_remaining: "1100",
      dispense_count: 1,
      status: 11,
      closed_block_index: 105,
      last_status_tx_hash: closeHash,
    },
  );
  const dispense = database
    .prepare(`SELECT tx_index,dispense_index,dispenser_tx_index,dispense_quantity,btc_amount FROM dispenses`)
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...dispense },
    { tx_index: 41, dispense_index: 0, dispenser_tx_index: 40, dispense_quantity: "100", btc_amount: "500" },
  );
  const refill = database
    .prepare(`SELECT tx_index,dispenser_tx_index,dispense_quantity FROM dispenser_refills`)
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...refill }, { tx_index: 42, dispenser_tx_index: 40, dispense_quantity: "200" });
});

test("compact fairminter lifecycle preserves campaign and mint transaction identities", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const fairminterHash = "81".repeat(32);
  const fairmintHash = "82".repeat(32);
  const ctx = context();

  dispatch(event("NEW_TRANSACTION", { tx_index: 50, tx_hash: fairminterHash, source: "issuer" }, 50), ctx);
  dispatch(
    event(
      "NEW_FAIRMINTER",
      {
        tx_index: 50,
        tx_hash: fairminterHash,
        source: "issuer",
        asset: "FAIR",
        asset_parent: "PARENT",
        asset_longname: "PARENT.FAIR",
        description: "Fair launch",
        price: "1",
        quantity_by_price: "5",
        hard_cap: "1000",
        max_mint_per_tx: "100",
        premint_quantity: "10",
        minted_asset_commission_int: "2",
        soft_cap: "500",
        divisible: true,
        status: "open",
        max_mint_per_address: "200",
      },
      51,
    ),
    ctx,
  );
  dispatch(event("NEW_TRANSACTION", { tx_index: 51, tx_hash: fairmintHash, source: "minter" }, 52), ctx);
  dispatch(
    event(
      "NEW_FAIRMINT",
      {
        tx_index: 51,
        tx_hash: fairmintHash,
        source: "minter",
        fairminter_tx_hash: fairminterHash,
        asset: "FAIR",
        earn_quantity: "100",
        paid_quantity: "20",
        commission: "2",
        status: "valid",
      },
      53,
    ),
    ctx,
  );
  dispatch(event("FAIRMINTER_UPDATE", { tx_hash: fairminterHash, status: "closed" }, 54), ctx);

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  const fairminter = database
    .prepare(
      `SELECT f.tx_index,lower(hex(f.tx_hash)) tx_hash,s.address source,a.asset,p.asset asset_parent,
              f.asset_longname,f.description,f.hard_cap,f.divisible,f.status
       FROM fairminters f
       JOIN address_dictionary s ON s.address_id=f.source_id
       JOIN asset_dictionary a ON a.asset_id=f.asset_id
       JOIN asset_dictionary p ON p.asset_id=f.asset_parent_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...fairminter },
    {
      tx_index: 50,
      tx_hash: fairminterHash,
      source: "issuer",
      asset: "FAIR",
      asset_parent: "PARENT",
      asset_longname: "PARENT.FAIR",
      description: "Fair launch",
      hard_cap: "1000",
      divisible: 1,
      status: "closed",
    },
  );
  const fairmint = database
    .prepare(
      `SELECT f.event_index,f.tx_index,lower(hex(f.tx_hash)) tx_hash,f.fairminter_tx_index,
              s.address source,a.asset,f.earn_quantity,f.paid_quantity,f.commission,f.status
       FROM fairmints f
       JOIN address_dictionary s ON s.address_id=f.source_id
       JOIN asset_dictionary a ON a.asset_id=f.asset_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...fairmint },
    {
      event_index: 53,
      tx_index: 51,
      tx_hash: fairmintHash,
      fairminter_tx_index: 50,
      source: "minter",
      asset: "FAIR",
      earn_quantity: "100",
      paid_quantity: "20",
      commission: "2",
      status: "valid",
    },
  );
});
