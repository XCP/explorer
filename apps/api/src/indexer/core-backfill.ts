import type { Env } from "#api/env";
import { hashToBytes } from "#api/indexer/compact-codec";

const DEFAULT_ROWS = 250;
const MAX_ROWS = 500;
const DICTIONARY_GROUP = 50;
const TRANSACTION_GROUP = 8;
const BLOCK_GROUP = 10;

type SourceTransaction = {
  tx_index: number;
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  btc_amount: string | null;
  fee: string | null;
  supported: number;
  utxos_info: string | null;
};

type SourceBlock = {
  block_index: number;
  block_hash: string | null;
  block_time: number | null;
  previous_block_hash: string | null;
  difficulty: string | null;
  ledger_hash: string | null;
  txlist_hash: string | null;
  messages_hash: string | null;
  transaction_count: number | null;
};

export type CoreTransactionBackfillResult = {
  table: "transactions";
  cursor: number;
  processed: number;
  caught_up: boolean;
};

export type CoreBlockBackfillResult = {
  table: "blocks";
  cursor: number;
  processed: number;
  caught_up: boolean;
};

function groups<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

async function coreState(db: D1Database, key: string): Promise<string | null> {
  return (
    (await db.prepare(`SELECT value FROM core_state WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null
  );
}

/**
 * Copy one bounded transaction page into the canonical mirror. Dictionary rows, data rows, and the cursor
 * commit in one destination batch, so a retry either replays the whole page or starts after it. Every write is
 * an upsert; source rows are never deleted and a partially completed page cannot advance its durable cursor.
 */
export async function backfillCoreTransactions(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedRows = DEFAULT_ROWS,
): Promise<CoreTransactionBackfillResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedRows), MAX_ROWS));
  const cursor = Number((await coreState(env.CORE_DB, "transactions_cursor")) ?? -1);
  const source = await env.DB.prepare(
    `SELECT tx_index,tx_hash,block_index,block_time,source,destination,btc_amount,fee,supported,utxos_info
       FROM transactions WHERE tx_index>? ORDER BY tx_index LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<SourceTransaction>();
  const rows = source.results;
  if (rows.length === 0) {
    await env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('transactions_done','1')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    return { table: "transactions", cursor, processed: 0, caught_up: true };
  }

  const addresses = [
    ...new Set(rows.flatMap((row) => [row.source, row.destination]).filter((value): value is string => value != null)),
  ];
  const statements: D1PreparedStatement[] = [];
  for (const group of groups(addresses, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO address_dictionary(address) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(address) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(rows, TRANSACTION_GROUP)) {
    const values = group
      .map(
        () =>
          `(?,?,?,?,(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?)`,
      )
      .join(",");
    const binds = group.flatMap((row) => [
      row.tx_index,
      hashToBytes(row.tx_hash),
      row.block_index,
      row.block_time,
      row.source,
      row.destination,
      row.btc_amount,
      row.fee,
      row.supported,
      row.utxos_info,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO transactions
           (tx_index,tx_hash,block_index,block_time,source_id,destination_id,btc_amount,fee,supported,utxos_info)
         VALUES ${values}
         ON CONFLICT(tx_index) DO UPDATE SET
           tx_hash=excluded.tx_hash,block_index=excluded.block_index,block_time=excluded.block_time,
           source_id=excluded.source_id,destination_id=excluded.destination_id,btc_amount=excluded.btc_amount,
           fee=excluded.fee,supported=excluded.supported,utxos_info=excluded.utxos_info`,
      ).bind(...binds),
    );
  }

  const nextCursor = rows.at(-1)?.tx_index ?? cursor;
  statements.push(
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('transactions_cursor',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(String(nextCursor)),
  );
  if (rows.length < limit) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES ('transactions_done','1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ),
    );
  }
  await env.CORE_DB.batch(statements);
  return { table: "transactions", cursor: nextCursor, processed: rows.length, caught_up: rows.length < limit };
}

/** Copy one bounded block-header page, including the replay hashes needed for parity and reorg checks. */
export async function backfillCoreBlocks(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedRows = DEFAULT_ROWS,
): Promise<CoreBlockBackfillResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedRows), MAX_ROWS));
  const cursor = Number((await coreState(env.CORE_DB, "blocks_cursor")) ?? -1);
  const source = await env.DB.prepare(
    `SELECT block_index,block_hash,block_time,previous_block_hash,difficulty,
            ledger_hash,txlist_hash,messages_hash,transaction_count
       FROM blocks WHERE block_index>? ORDER BY block_index LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<SourceBlock>();
  const rows = source.results;
  if (rows.length === 0) {
    await env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('blocks_done','1')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    return { table: "blocks", cursor, processed: 0, caught_up: true };
  }

  const statements: D1PreparedStatement[] = [];
  for (const group of groups(rows, BLOCK_GROUP)) {
    const values = group.map(() => `(?,?,?,?,?,?,?,?,?)`).join(",");
    const binds = group.flatMap((row) => [
      row.block_index,
      hashToBytes(row.block_hash),
      row.block_time,
      hashToBytes(row.previous_block_hash),
      row.difficulty,
      hashToBytes(row.ledger_hash),
      hashToBytes(row.txlist_hash),
      hashToBytes(row.messages_hash),
      row.transaction_count,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO blocks
           (block_index,block_hash,block_time,previous_block_hash,difficulty,
            ledger_hash,txlist_hash,messages_hash,transaction_count)
         VALUES ${values}
         ON CONFLICT(block_index) DO UPDATE SET
           block_hash=excluded.block_hash,block_time=excluded.block_time,
           previous_block_hash=excluded.previous_block_hash,difficulty=excluded.difficulty,
           ledger_hash=excluded.ledger_hash,txlist_hash=excluded.txlist_hash,
           messages_hash=excluded.messages_hash,transaction_count=excluded.transaction_count`,
      ).bind(...binds),
    );
  }
  const nextCursor = rows.at(-1)?.block_index ?? cursor;
  statements.push(
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('blocks_cursor',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(String(nextCursor)),
  );
  if (rows.length < limit) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES ('blocks_done','1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ),
    );
  }
  await env.CORE_DB.batch(statements);
  return { table: "blocks", cursor: nextCursor, processed: rows.length, caught_up: rows.length < limit };
}
