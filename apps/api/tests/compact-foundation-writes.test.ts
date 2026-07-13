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
