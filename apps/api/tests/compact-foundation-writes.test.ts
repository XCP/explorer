import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createIdentitySet, dictionaryStatements } from "#api/indexer/dictionaries";
import { applyCompactBalanceDeltas } from "#api/indexer/balance-store";
import { dispatch } from "#api/indexer/events/dispatch";
import type { Ctx, Ev, Stmt } from "#api/indexer/events/context";
import { pruneCompactSnapshots, rollbackCompactDatabase, syncCompactEvents } from "#api/indexer/sync";

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
    this.database.prepare(this.sql).run(...this.binds);
    return { success: true, meta: { changes: 1 } };
  }
  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.binds) as T[] };
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.binds) as T | undefined) ?? null;
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
    identities: createIdentitySet(),
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
  await execute(database, dictionaryStatements(ctx.identities));
  await execute(database, ctx.stmts);
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

  await execute(database, dictionaryStatements(ctx.identities));
  await execute(database, ctx.stmts);
  await applyCompactBalanceDeltas(d1(database), ctx.balDelta, true);
  await execute(database, ctx.stmts);
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
        description: "stamp:eyJwIjogInNyYy0yMCIsICJvcCI6ICJkZXBsb3kiLCAidGljayI6ICJLRVZJTiJ9",
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
  assert.deepEqual(
    database
      .prepare(
        `SELECT tag,source FROM tags JOIN entity_dictionary USING(entity_id)
         WHERE entity_type='asset' AND entity_key=? ORDER BY tag`,
      )
      .all(asset)
      .map((row) => ({ ...row })),
    [
      { tag: "src20", source: "protocol" },
      { tag: "src20_deploy", source: "protocol" },
      { tag: "stamp", source: "protocol" },
    ],
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

test("compact pool lifecycle preserves pair, swap, and liquidity identities", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const depositHash = "91".repeat(32);
  const matchHash = "92".repeat(32);
  const withdrawalHash = "93".repeat(32);
  const ctx = context();

  dispatch(event("NEW_TRANSACTION", { tx_index: 60, tx_hash: depositHash, source: "maker" }, 60), ctx);
  dispatch(
    event(
      "OPEN_POOL",
      {
        tx_index: 60,
        tx_hash: depositHash,
        source: "maker",
        asset_a: "RARE",
        asset_b: "XCP",
        lp_asset: "A123",
        reserve_a: "1000",
        reserve_b: "2000",
      },
      61,
    ),
    ctx,
  );
  dispatch(
    event(
      "NEW_POOL_DEPOSIT",
      {
        tx_index: 60,
        tx_hash: depositHash,
        source: "maker",
        asset_a: "RARE",
        asset_b: "XCP",
        quantity_a: "1000",
        quantity_b: "2000",
        quantity_minted: "1400",
        status: "valid",
      },
      62,
    ),
    ctx,
  );
  dispatch(event("POOL_UPDATE", { asset_a: "RARE", asset_b: "XCP", reserve_a: "900", reserve_b: "2200" }, 63), ctx);
  dispatch(event("NEW_TRANSACTION", { tx_index: 61, tx_hash: matchHash, source: "trader" }, 64), ctx);
  dispatch(
    event(
      "POOL_MATCH",
      {
        tx_index: 61,
        tx_hash: matchHash,
        order_tx_hash: matchHash,
        source: "trader",
        asset_a: "RARE",
        asset_b: "XCP",
        forward_asset: "RARE",
        forward_quantity: "100",
        backward_asset: "XCP",
        backward_quantity: "200",
        fee_quantity: "1",
        fee_bps: 50,
        status: "valid",
      },
      65,
    ),
    ctx,
  );
  dispatch(event("NEW_TRANSACTION", { tx_index: 62, tx_hash: withdrawalHash, source: "maker" }, 66), ctx);
  dispatch(
    event(
      "NEW_POOL_WITHDRAWAL",
      {
        tx_index: 62,
        tx_hash: withdrawalHash,
        source: "maker",
        asset_a: "RARE",
        asset_b: "XCP",
        quantity_a: "90",
        quantity_b: "220",
        quantity_destroyed: "140",
        status: "valid",
      },
      67,
    ),
    ctx,
  );

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  const pool = database
    .prepare(
      `SELECT a.asset asset_a,b.asset asset_b,p.lp_asset,p.pair,p.reserve_a,p.reserve_b,p.status
       FROM pools p
       JOIN asset_dictionary a ON a.asset_id=p.asset_a_id
       JOIN asset_dictionary b ON b.asset_id=p.asset_b_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...pool },
    {
      asset_a: "RARE",
      asset_b: "XCP",
      lp_asset: "A123",
      pair: "RARE_XCP",
      reserve_a: "900",
      reserve_b: "2200",
      status: "open",
    },
  );
  const swap = database
    .prepare(
      `SELECT p.event_index,p.tx_index,p.order_tx_index,s.address source,f.asset forward_asset,
              b.asset backward_asset,p.forward_quantity,p.backward_quantity,p.fee_quantity,p.fee_bps
       FROM pool_matches p
       JOIN address_dictionary s ON s.address_id=p.source_id
       JOIN asset_dictionary f ON f.asset_id=p.forward_asset_id
       JOIN asset_dictionary b ON b.asset_id=p.backward_asset_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...swap },
    {
      event_index: 65,
      tx_index: 61,
      order_tx_index: 61,
      source: "trader",
      forward_asset: "RARE",
      backward_asset: "XCP",
      forward_quantity: "100",
      backward_quantity: "200",
      fee_quantity: "1",
      fee_bps: 50,
    },
  );
  const liquidity = database
    .prepare(
      `SELECT event_index,tx_index,kind,quantity_a,quantity_b,quantity_minted,quantity_destroyed FROM pool_liquidity ORDER BY event_index`,
    )
    .all() as Record<string, unknown>[];
  assert.deepEqual(
    liquidity.map((row) => ({ ...row })),
    [
      {
        event_index: 62,
        tx_index: 60,
        kind: "deposit",
        quantity_a: "1000",
        quantity_b: "2000",
        quantity_minted: "1400",
        quantity_destroyed: null,
      },
      {
        event_index: 67,
        tx_index: 62,
        kind: "withdrawal",
        quantity_a: "90",
        quantity_b: "220",
        quantity_minted: null,
        quantity_destroyed: "140",
      },
    ],
  );
});

test("compact bet and RPS state machines preserve composite match identities", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const bet0Hash = "a1".repeat(32);
  const bet1Hash = "a2".repeat(32);
  const betMatchId = `${bet0Hash}_${bet1Hash}`;
  const rps0Hash = "b1".repeat(32);
  const rps1Hash = "b2".repeat(32);
  const rpsMatchId = `${rps0Hash}_${rps1Hash}`;
  const ctx = context();

  dispatch(event("NEW_TRANSACTION", { tx_index: 70, tx_hash: bet0Hash, source: "bull" }, 70), ctx);
  dispatch(event("NEW_TRANSACTION", { tx_index: 71, tx_hash: bet1Hash, source: "bear" }, 71), ctx);
  dispatch(
    event(
      "OPEN_BET",
      {
        tx_index: 70,
        tx_hash: bet0Hash,
        source: "bull",
        feed_address: "oracle",
        bet_type: 0,
        deadline: 500,
        wager_quantity: "100",
        wager_remaining: "100",
        counterwager_quantity: "120",
        counterwager_remaining: "120",
        target_value: "10",
        leverage: 5040,
        expiration: 10,
        expire_index: 110,
        fee_fraction_int: "100",
        status: "open",
      },
      72,
    ),
    ctx,
  );
  dispatch(
    event(
      "BET_MATCH",
      {
        id: betMatchId,
        tx0_hash: bet0Hash,
        tx1_hash: bet1Hash,
        tx0_address: "bull",
        tx1_address: "bear",
        feed_address: "oracle",
        forward_quantity: "100",
        backward_quantity: "120",
        deadline: 500,
        target_value: "10",
        leverage: 5040,
        initial_value: "9",
        status: "pending",
      },
      73,
    ),
    ctx,
  );
  dispatch(event("BET_UPDATE", { tx_hash: bet0Hash, wager_remaining: "0", status: "filled" }, 74), ctx);
  dispatch(event("BET_MATCH_UPDATE", { id: betMatchId, status: "settled" }, 75), ctx);
  dispatch(
    event(
      "BET_MATCH_RESOLUTION",
      {
        tx_hash: "a3".repeat(32),
        bet_match_id: betMatchId,
        bet_match_type_id: 1,
        winner: "bull",
        settled: true,
        bull_credit: "220",
        bear_credit: "0",
        escrow_less_fee: "220",
        fee: "0",
        status: "valid",
      },
      76,
    ),
    ctx,
  );

  dispatch(event("NEW_TRANSACTION", { tx_index: 80, tx_hash: rps0Hash, source: "rock" }, 80), ctx);
  dispatch(event("NEW_TRANSACTION", { tx_index: 81, tx_hash: rps1Hash, source: "paper" }, 81), ctx);
  dispatch(
    event(
      "OPEN_RPS",
      {
        tx_index: 80,
        tx_hash: rps0Hash,
        source: "rock",
        possible_moves: 3,
        wager: "50",
        move_random_hash: "c1".repeat(32),
        expiration: 10,
        expire_index: 110,
        status: "open",
      },
      82,
    ),
    ctx,
  );
  dispatch(
    event(
      "RPS_MATCH",
      {
        id: rpsMatchId,
        tx0_hash: rps0Hash,
        tx1_hash: rps1Hash,
        tx0_address: "rock",
        tx1_address: "paper",
        possible_moves: 3,
        wager: "50",
        status: "pending",
      },
      83,
    ),
    ctx,
  );
  dispatch(event("RPS_UPDATE", { tx_hash: rps0Hash, status: "matched" }, 84), ctx);
  dispatch(event("RPS_MATCH_UPDATE", { id: rpsMatchId, status: "resolved and pending" }, 85), ctx);
  dispatch(event("RPS_RESOLVE", { rps_match_id: rpsMatchId, status: "valid" }, 86), ctx);

  await executeCompact(database, ctx);
  await executeCompact(database, ctx);

  const bet = database.prepare(`SELECT tx_index,wager_remaining,status FROM bets`).get() as Record<string, unknown>;
  assert.deepEqual({ ...bet }, { tx_index: 70, wager_remaining: "0", status: "filled" });
  const betMatch = database.prepare(`SELECT tx0_index,tx1_index,status FROM bet_matches`).get() as Record<
    string,
    unknown
  >;
  assert.deepEqual({ ...betMatch }, { tx0_index: 70, tx1_index: 71, status: "settled" });
  const resolution = database
    .prepare(
      `SELECT r.event_index,r.bet_match_tx0_index,r.bet_match_tx1_index,w.address winner,r.settled,
              r.bull_credit,r.bear_credit,r.status
       FROM bet_match_resolutions r
       JOIN address_dictionary w ON w.address_id=r.winner_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...resolution },
    {
      event_index: 76,
      bet_match_tx0_index: 70,
      bet_match_tx1_index: 71,
      winner: "bull",
      settled: 1,
      bull_credit: "220",
      bear_credit: "0",
      status: "valid",
    },
  );
  const rps = database
    .prepare(`SELECT tx_index,lower(hex(move_random_hash)) move_random_hash,status FROM rps`)
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...rps }, { tx_index: 80, move_random_hash: "c1".repeat(32), status: "matched" });
  const rpsMatch = database.prepare(`SELECT tx0_index,tx1_index,status FROM rps_matches`).get() as Record<
    string,
    unknown
  >;
  assert.deepEqual({ ...rpsMatch }, { tx0_index: 80, tx1_index: 81, status: "resolved and pending" });
});

test("replay advances its durable cursor", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  database.exec(`
    INSERT INTO core_state(key,value) VALUES
      ('last_event_index','0'),
      ('last_block_index','100');
  `);
  const txHash = "d1".repeat(32);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/events?limit=1")) {
      return new Response(JSON.stringify({ result_count: 2 }), { status: 200 });
    }
    if (url.includes("/events?cursor=")) {
      return new Response(
        JSON.stringify({
          result: [
            {
              event: "NEW_TRANSACTION",
              event_index: 1,
              block_index: 101,
              tx_hash: txHash,
              params: { tx_index: 1, tx_hash: txHash, block_index: 101, source: "alice" },
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected Counterparty request: ${url}`);
  };
  try {
    const result = await syncCompactEvents(
      { CORE_DB: d1(database), COUNTERPARTY_API_BASE: "https://counterparty.test" },
      { maxEvents: 10 },
    );
    assert.deepEqual(result, {
      applied: 1,
      last_event_index: 1,
      last_block: 101,
      tip: 1,
      caught_up: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const transaction = database
    .prepare(
      `SELECT t.tx_index,lower(hex(t.tx_hash)) tx_hash,a.address source
       FROM transactions t JOIN address_dictionary a ON a.address_id=t.source_id`,
    )
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...transaction }, { tx_index: 1, tx_hash: txHash, source: "alice" });
  const state = Object.fromEntries(
    (
      database
        .prepare(
          `SELECT key,value FROM core_state
         WHERE key IN ('last_event_index','last_block_index')`,
        )
        .all() as { key: string; value: string }[]
    ).map((row) => [row.key, row.value]),
  );
  assert.deepEqual(state, {
    last_event_index: "1",
    last_block_index: "101",
  });
});

test("compact replay rolls back a mismatched checkpoint before accepting the replacement branch", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  database.exec(`
    INSERT INTO blocks(block_index,block_hash) VALUES(100,X'${"a0".repeat(32)}'),(101,X'${"a1".repeat(32)}');
    INSERT INTO transactions(tx_index,tx_hash,block_index) VALUES(1,X'${"b1".repeat(32)}',101);
    INSERT INTO core_state(key,value) VALUES
      ('last_event_index','10'),('last_block_index','101'),('last_block_hash','orphan');
  `);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/events?limit=1")) return new Response(JSON.stringify({ result_count: 10 }));
    if (url.endsWith("/blocks/101")) return new Response(JSON.stringify({ result: { block_hash: "replacement-101" } }));
    if (url.includes("/events?cursor=10"))
      return new Response(
        JSON.stringify({
          result: [
            { event_index: 10, block_index: 101 },
            { event_index: 9, block_index: 100 },
          ],
        }),
      );
    if (url.endsWith("/blocks/100")) return new Response(JSON.stringify({ result: { block_hash: "replacement-100" } }));
    throw new Error(`unexpected Counterparty request: ${url}`);
  };
  try {
    const result = await syncCompactEvents({
      CORE_DB: d1(database),
      COUNTERPARTY_API_BASE: "https://counterparty.test",
    });
    assert.equal(result.last_event_index, 9);
    assert.equal(result.last_block, 100);
    assert.equal(result.caught_up, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(database.prepare(`SELECT count(*) count FROM transactions`).get()?.count, 0);
  const state = Object.fromEntries(
    (database.prepare(`SELECT key,value FROM core_state`).all() as { key: string; value: string }[]).map((row) => [
      row.key,
      row.value,
    ]),
  );
  assert.equal(state.last_event_index, "9");
  assert.equal(state.last_block_index, "100");
  assert.equal(state.last_block_hash, "replacement-100");
});

test("compact caught-up maintenance prunes superseded snapshots", async () => {
  const compact = new DatabaseSync(":memory:");
  compact.exec(CORE_DDL);
  compact.exec(`
    INSERT OR IGNORE INTO asset_dictionary(asset) VALUES('XCP');
    INSERT OR IGNORE INTO address_dictionary(address) VALUES('alice');
    INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
      SELECT address_id,asset_id,10,'1',1 FROM address_dictionary,asset_dictionary
       WHERE address='alice' AND asset='XCP';
    INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
      SELECT address_id,asset_id,20,'2',2 FROM address_dictionary,asset_dictionary
       WHERE address='alice' AND asset='XCP';
    INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
      SELECT address_id,asset_id,40,'3',3 FROM address_dictionary,asset_dictionary
       WHERE address='alice' AND asset='XCP';
  `);
  await pruneCompactSnapshots(d1(compact), 30);
  assert.deepEqual(
    compact
      .prepare(`SELECT block_index FROM balance_snapshots ORDER BY block_index`)
      .all()
      .map((row) => row.block_index),
    [20, 40],
  );
});

test("compact rollback removes orphan rows and restores balance quantity and high-water", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(CORE_DDL);
  const addressId = Number(
    database.prepare(`INSERT INTO address_dictionary(address) VALUES ('alice') RETURNING address_id`).get()?.address_id,
  );
  const assetId = Number(
    database.prepare(`INSERT INTO asset_dictionary(asset) VALUES ('RARE') RETURNING asset_id`).get()?.asset_id,
  );
  database.prepare(`INSERT INTO assets(asset_id,divisible) VALUES (?,1)`).run(assetId);
  database
    .prepare(
      `INSERT INTO balances(address_id,asset_id,quantity,quantity_normalized,updated_block_index,updated_event_index)
       VALUES (?,?,'20','0.00000020',102,10)`,
    )
    .run(addressId, assetId);
  database
    .prepare(
      `INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
       VALUES (?, ?,100,'10',5),(?, ?,102,'20',10)`,
    )
    .run(addressId, assetId, addressId, assetId);
  database.exec(`
    INSERT INTO blocks(block_index) VALUES (100),(102);
    INSERT INTO transactions(tx_index,tx_hash,block_index) VALUES
      (1,X'${"e1".repeat(32)}',100),
      (2,X'${"e2".repeat(32)}',102);
    INSERT INTO ledger_events(event_index,direction,block_index,address_id,asset_id,quantity)
      VALUES (10,1,102,${addressId},${assetId},'10');
    INSERT INTO orders(tx_index,tx_hash,block_index,status,closed_block_index)
      VALUES (1,X'${"e1".repeat(32)}',100,'filled',102);
    INSERT INTO dispensers(tx_index,tx_hash,block_index,source_id,asset_id,status,closed_block_index)
      VALUES (3,X'${"e3".repeat(32)}',100,${addressId},${assetId},11,102);
    INSERT INTO core_state(key,value) VALUES
      ('last_block_index','102');
  `);

  await rollbackCompactDatabase(d1(database), 101);

  const balance = database
    .prepare(`SELECT quantity,quantity_normalized,updated_block_index,updated_event_index FROM balances`)
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...balance },
    { quantity: "10", quantity_normalized: "0.00000010", updated_block_index: 101, updated_event_index: 5 },
  );
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM balance_snapshots`).get()?.count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM transactions`).get()?.count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM ledger_events`).get()?.count, 0);
  assert.deepEqual(
    { ...(database.prepare(`SELECT status,closed_block_index FROM orders`).get() as Record<string, unknown>) },
    { status: "open", closed_block_index: null },
  );
  assert.deepEqual(
    { ...(database.prepare(`SELECT status,closed_block_index FROM dispensers`).get() as Record<string, unknown>) },
    { status: 11, closed_block_index: null },
  );
  const state = Object.fromEntries(
    (database.prepare(`SELECT key,value FROM core_state`).all() as { key: string; value: string }[]).map((row) => [
      row.key,
      row.value,
    ]),
  );
  assert.equal(state.last_block_index, "101");
});
