import type { Env } from "#api/env";
import { hashToBytes } from "#api/indexer/compact-codec";

const DEFAULT_ROWS = 250;
const MAX_ROWS = 500;
// Asset rows are much wider than blocks/transactions. Larger pages can exceed D1's batch execution budget.
const MAX_ASSET_ROWS = 100;
const DICTIONARY_GROUP = 50;
const TRANSACTION_GROUP = 8;
const BLOCK_GROUP = 10;
const ASSET_GROUP = 5;
const ISSUANCE_GROUP = 4;
const BALANCE_GROUP = 10;
const SEND_GROUP = 5;

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

type SourceAsset = {
  asset: string;
  asset_longname: string | null;
  asset_id: string | null;
  type: string;
  issuer: string | null;
  owner: string | null;
  divisible: number;
  locked: number;
  description_locked: number;
  supply: string | null;
  supply_normalized: string | null;
  description: string | null;
  mime_type: string | null;
  first_issuance_block_index: number | null;
  last_issuance_block_index: number | null;
  first_issuance_block_time: number | null;
  last_issuance_block_time: number | null;
  updated_at: number;
};

type SourceIssuance = {
  event_index: number;
  tx_index: number;
  tx_hash: string;
  msg_index: number | null;
  block_index: number;
  block_time: number | null;
  asset: string | null;
  asset_longname: string | null;
  quantity: string | null;
  quantity_normalized: string | null;
  source: string | null;
  issuer: string | null;
  transfer: number;
  divisible: number;
  locked: number;
  description: string | null;
  fee_paid: string | null;
  status: string | null;
  asset_events: string | null;
  mime_type: string | null;
  reset: number | null;
  callable: number | null;
  call_date: number | null;
  call_price: string | null;
};

type SourceBalance = {
  holder: string;
  asset: string;
  holder_type: string;
  quantity: string;
  quantity_normalized: string | null;
  updated_block_index: number | null;
  updated_event_index: number;
  utxo_address: string | null;
};

type SourceSend = {
  event_index: number;
  tx_index: number;
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  source_address: string | null;
  destination_address: string | null;
  asset: string | null;
  quantity: string | null;
  quantity_normalized: string | null;
  memo: string | null;
  memo_hex: string | null;
  send_type: string | null;
  status: string | null;
  fee_paid: string | null;
  msg_index: number;
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

export type CoreAssetBackfillResult = {
  table: "assets";
  cursor: string | null;
  processed: number;
  caught_up: boolean;
};

export type CoreIssuanceBackfillResult = {
  table: "issuances";
  cursor: number;
  processed: number;
  caught_up: boolean;
};

export type CoreBalanceBackfillResult = {
  table: "balances";
  cursor: { holder: string; asset: string } | null;
  processed: number;
  caught_up: boolean;
};

export type CoreSendBackfillResult = {
  table: "sends";
  cursor: number;
  processed: number;
  caught_up: boolean;
};

export function parseUtxoHolder(holder: string): { txHash: Uint8Array; vout: number } {
  const match = /^([0-9a-f]{64}):(\d+)$/i.exec(holder);
  if (!match) throw new Error(`invalid UTXO balance holder: ${holder}`);
  const vout = Number(match[2]);
  if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff)
    throw new Error(`invalid UTXO balance vout: ${holder}`);
  const txHash = hashToBytes(match[1]);
  if (txHash == null) throw new Error(`invalid UTXO balance transaction hash: ${holder}`);
  return { txHash, vout };
}

function groups<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function coreStateUpsert(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO core_state(key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .bind(key, value);
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
  const statements: D1PreparedStatement[] = [coreStateUpsert(env.CORE_DB, "transactions_done", "0")];
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

  const statements: D1PreparedStatement[] = [coreStateUpsert(env.CORE_DB, "blocks_done", "0")];
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

/**
 * Copy one bounded current-asset page. Asset names are the stable source identity and cursor; the compact
 * table uses the dictionary id as its primary key. The page inserts every asset/address dictionary dependency,
 * upserts the current row, and advances its cursor in one destination batch.
 */
export async function backfillCoreAssets(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedRows = DEFAULT_ROWS,
): Promise<CoreAssetBackfillResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedRows), MAX_ASSET_ROWS));
  const cursor = await coreState(env.CORE_DB, "assets_cursor");
  const source = await env.DB.prepare(
    `SELECT asset,asset_longname,asset_id,type,issuer,owner,divisible,locked,description_locked,
            supply,supply_normalized,description,mime_type,first_issuance_block_index,
            last_issuance_block_index,first_issuance_block_time,last_issuance_block_time,updated_at
       FROM assets WHERE asset>? ORDER BY asset LIMIT ?`,
  )
    .bind(cursor ?? "", limit)
    .all<SourceAsset>();
  const rows = source.results;
  if (rows.length === 0) {
    await env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('assets_done','1')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    return { table: "assets", cursor, processed: 0, caught_up: true };
  }

  const assetNames = [...new Set(rows.map((row) => row.asset))];
  const addresses = [
    ...new Set(rows.flatMap((row) => [row.issuer, row.owner]).filter((value): value is string => value != null)),
  ];
  const statements: D1PreparedStatement[] = [coreStateUpsert(env.CORE_DB, "assets_done", "0")];
  for (const group of groups(assetNames, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO asset_dictionary(asset) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(asset) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(addresses, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO address_dictionary(address) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(address) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(rows, ASSET_GROUP)) {
    const values = group
      .map(
        () =>
          `((SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .join(",");
    const binds = group.flatMap((row) => [
      row.asset,
      row.asset_longname,
      row.asset_id,
      row.type,
      row.issuer,
      row.owner,
      row.divisible,
      row.locked,
      row.description_locked,
      row.supply,
      row.supply_normalized,
      row.description,
      row.mime_type,
      row.first_issuance_block_index,
      row.last_issuance_block_index,
      row.first_issuance_block_time,
      row.last_issuance_block_time,
      row.updated_at,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO assets
           (asset_id,asset_longname,numeric_asset_id,type,issuer_id,owner_id,divisible,locked,
            description_locked,supply,supply_normalized,description,mime_type,first_issuance_block_index,
            last_issuance_block_index,first_issuance_block_time,last_issuance_block_time,updated_at)
         VALUES ${values}
         ON CONFLICT(asset_id) DO UPDATE SET
           asset_longname=excluded.asset_longname,numeric_asset_id=excluded.numeric_asset_id,type=excluded.type,
           issuer_id=excluded.issuer_id,owner_id=excluded.owner_id,divisible=excluded.divisible,
           locked=excluded.locked,description_locked=excluded.description_locked,supply=excluded.supply,
           supply_normalized=excluded.supply_normalized,description=excluded.description,mime_type=excluded.mime_type,
           first_issuance_block_index=excluded.first_issuance_block_index,
           last_issuance_block_index=excluded.last_issuance_block_index,
           first_issuance_block_time=excluded.first_issuance_block_time,
           last_issuance_block_time=excluded.last_issuance_block_time,updated_at=excluded.updated_at`,
      ).bind(...binds),
    );
  }

  const nextCursor = rows.at(-1)?.asset ?? cursor;
  statements.push(
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('assets_cursor',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(nextCursor),
  );
  if (rows.length < limit) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES ('assets_done','1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ),
    );
  }
  await env.CORE_DB.batch(statements);
  return { table: "assets", cursor: nextCursor, processed: rows.length, caught_up: rows.length < limit };
}

/**
 * Copy one bounded issuance page by its unique event identity. Historical source rows may have a null
 * msg_index; Counterparty's pre-multi-message shape means zero is their canonical message position. The
 * destination's (tx_index,msg_index) uniqueness constraint rejects any unexpected collision before the cursor
 * can advance.
 */
export async function backfillCoreIssuances(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedRows = DEFAULT_ROWS,
): Promise<CoreIssuanceBackfillResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedRows), 100));
  const cursor = Number((await coreState(env.CORE_DB, "issuances_cursor")) ?? -1);
  const source = await env.DB.prepare(
    `SELECT event_index,tx_index,tx_hash,msg_index,block_index,block_time,asset,asset_longname,quantity,
            quantity_normalized,source,issuer,transfer,divisible,locked,description,fee_paid,status,asset_events,
            mime_type,reset,callable,call_date,call_price
       FROM issuances WHERE event_index>? ORDER BY event_index LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<SourceIssuance>();
  const rows = source.results;
  if (rows.length === 0) {
    await env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('issuances_done','1')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    return { table: "issuances", cursor, processed: 0, caught_up: true };
  }

  const assets = [...new Set(rows.map((row) => row.asset).filter((value): value is string => value != null))];
  const addresses = [
    ...new Set(rows.flatMap((row) => [row.source, row.issuer]).filter((value): value is string => value != null)),
  ];
  const statements: D1PreparedStatement[] = [coreStateUpsert(env.CORE_DB, "issuances_done", "0")];
  for (const group of groups(assets, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO asset_dictionary(asset) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(asset) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(addresses, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO address_dictionary(address) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(address) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(rows, ISSUANCE_GROUP)) {
    const values = group
      .map(
        () =>
          `(?,?,?,?,?,?,(SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .join(",");
    const binds = group.flatMap((row) => [
      row.event_index,
      row.tx_index,
      hashToBytes(row.tx_hash),
      row.msg_index ?? 0,
      row.block_index,
      row.block_time,
      row.asset,
      row.asset_longname,
      row.quantity,
      row.quantity_normalized,
      row.source,
      row.issuer,
      row.transfer,
      row.divisible,
      row.locked,
      row.description,
      row.fee_paid,
      row.status,
      row.asset_events,
      row.mime_type,
      row.reset,
      row.callable,
      row.call_date,
      row.call_price,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO issuances
           (event_index,tx_index,tx_hash,msg_index,block_index,block_time,asset_id,asset_longname,quantity,
            quantity_normalized,source_id,issuer_id,transfer,divisible,locked,description,fee_paid,status,
            asset_events,mime_type,reset,callable,call_date,call_price)
         VALUES ${values}
         ON CONFLICT(event_index) DO UPDATE SET
           tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,msg_index=excluded.msg_index,
           block_index=excluded.block_index,block_time=excluded.block_time,asset_id=excluded.asset_id,
           asset_longname=excluded.asset_longname,quantity=excluded.quantity,
           quantity_normalized=excluded.quantity_normalized,source_id=excluded.source_id,issuer_id=excluded.issuer_id,
           transfer=excluded.transfer,divisible=excluded.divisible,locked=excluded.locked,
           description=excluded.description,fee_paid=excluded.fee_paid,status=excluded.status,
           asset_events=excluded.asset_events,mime_type=excluded.mime_type,reset=excluded.reset,
           callable=excluded.callable,call_date=excluded.call_date,call_price=excluded.call_price`,
      ).bind(...binds),
    );
  }

  const nextCursor = rows.at(-1)?.event_index ?? cursor;
  statements.push(
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('issuances_cursor',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(String(nextCursor)),
  );
  if (rows.length < limit) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES ('issuances_done','1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ),
    );
  }
  await env.CORE_DB.batch(statements);
  return { table: "issuances", cursor: nextCursor, processed: rows.length, caught_up: rows.length < limit };
}

/**
 * Copy one current-balance page using the source's exact (holder,asset) identity. Address and UTXO holders
 * remain one relation; partial unique indexes select the correct upsert key without encoding either form into
 * an ambiguous shared string in the compact store.
 */
export async function backfillCoreBalances(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedRows = DEFAULT_ROWS,
): Promise<CoreBalanceBackfillResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedRows), 100));
  const holderCursor = (await coreState(env.CORE_DB, "balances_holder_cursor")) ?? "";
  const assetCursor = (await coreState(env.CORE_DB, "balances_asset_cursor")) ?? "";
  const source = await env.DB.prepare(
    `SELECT holder,asset,holder_type,quantity,quantity_normalized,updated_block_index,
            updated_event_index,utxo_address
       FROM balances
      WHERE holder>? OR (holder=? AND asset>?)
      ORDER BY holder,asset LIMIT ?`,
  )
    .bind(holderCursor, holderCursor, assetCursor, limit)
    .all<SourceBalance>();
  const rows = source.results;
  if (rows.length === 0) {
    await env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('balances_done','1')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    const cursor = holderCursor ? { holder: holderCursor, asset: assetCursor } : null;
    return { table: "balances", cursor, processed: 0, caught_up: true };
  }

  const addressRows: SourceBalance[] = [];
  const utxoRows: Array<SourceBalance & { txHash: Uint8Array; vout: number }> = [];
  for (const row of rows) {
    if (row.holder_type === "address") addressRows.push(row);
    else if (row.holder_type === "utxo") utxoRows.push({ ...row, ...parseUtxoHolder(row.holder) });
    else throw new Error(`unsupported balance holder type: ${row.holder_type}`);
  }
  const assets = [...new Set(rows.map((row) => row.asset))];
  const addresses = [
    ...new Set([
      ...addressRows.map((row) => row.holder),
      ...rows.map((row) => row.utxo_address).filter((value): value is string => value != null),
    ]),
  ];
  const statements: D1PreparedStatement[] = [coreStateUpsert(env.CORE_DB, "balances_done", "0")];
  for (const group of groups(assets, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO asset_dictionary(asset) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(asset) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(addresses, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO address_dictionary(address) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(address) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(addressRows, BALANCE_GROUP)) {
    const values = group
      .map(
        () =>
          `((SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,` +
          `(SELECT address_id FROM address_dictionary WHERE address=?))`,
      )
      .join(",");
    const binds = group.flatMap((row) => [
      row.holder,
      row.asset,
      row.quantity,
      row.quantity_normalized,
      row.updated_block_index,
      row.updated_event_index,
      row.utxo_address,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO balances
           (address_id,asset_id,quantity,quantity_normalized,updated_block_index,updated_event_index,utxo_address_id)
         VALUES ${values}
         ON CONFLICT(address_id,asset_id) WHERE address_id IS NOT NULL DO UPDATE SET
           quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
           updated_block_index=excluded.updated_block_index,updated_event_index=excluded.updated_event_index,
           utxo_address_id=excluded.utxo_address_id`,
      ).bind(...binds),
    );
  }
  for (const group of groups(utxoRows, BALANCE_GROUP)) {
    const values = group
      .map(
        () =>
          `(?,?,(SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,` +
          `(SELECT address_id FROM address_dictionary WHERE address=?))`,
      )
      .join(",");
    const binds = group.flatMap((row) => [
      row.txHash,
      row.vout,
      row.asset,
      row.quantity,
      row.quantity_normalized,
      row.updated_block_index,
      row.updated_event_index,
      row.utxo_address,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO balances
           (utxo_tx_hash,utxo_vout,asset_id,quantity,quantity_normalized,updated_block_index,
            updated_event_index,utxo_address_id)
         VALUES ${values}
         ON CONFLICT(utxo_tx_hash,utxo_vout,asset_id) WHERE utxo_tx_hash IS NOT NULL DO UPDATE SET
           quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
           updated_block_index=excluded.updated_block_index,updated_event_index=excluded.updated_event_index,
           utxo_address_id=excluded.utxo_address_id`,
      ).bind(...binds),
    );
  }

  const last = rows.at(-1)!;
  statements.push(
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('balances_holder_cursor',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(last.holder),
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('balances_asset_cursor',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(last.asset),
  );
  if (rows.length < limit) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES ('balances_done','1')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ),
    );
  }
  await env.CORE_DB.batch(statements);
  return {
    table: "balances",
    cursor: { holder: last.holder, asset: last.asset },
    processed: rows.length,
    caught_up: rows.length < limit,
  };
}

/**
 * Copy one send page by Counterparty's unique event identity. Transaction/message identities remain explicit,
 * while repeated asset and address text is replaced with compact dictionary ids.
 */
export async function backfillCoreSends(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedRows = DEFAULT_ROWS,
): Promise<CoreSendBackfillResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedRows), 100));
  const cursor = Number((await coreState(env.CORE_DB, "sends_cursor")) ?? -1);
  const source = await env.DB.prepare(
    `SELECT event_index,tx_index,tx_hash,block_index,block_time,source,destination,source_address,
            destination_address,asset,quantity,quantity_normalized,memo,memo_hex,send_type,status,fee_paid,msg_index
       FROM sends WHERE event_index>? ORDER BY event_index LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<SourceSend>();
  const rows = source.results;
  if (rows.length === 0) {
    await env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES ('sends_done','1')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    return { table: "sends", cursor, processed: 0, caught_up: true };
  }

  const assets = [...new Set(rows.map((row) => row.asset).filter((value): value is string => value != null))];
  const addresses = [
    ...new Set(
      rows
        .flatMap((row) => [row.source, row.destination, row.source_address, row.destination_address])
        .filter((value): value is string => value != null),
    ),
  ];
  const statements: D1PreparedStatement[] = [coreStateUpsert(env.CORE_DB, "sends_done", "0")];
  for (const group of groups(assets, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO asset_dictionary(asset) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(asset) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(addresses, DICTIONARY_GROUP)) {
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO address_dictionary(address) VALUES ${group.map(() => "(?)").join(",")}
         ON CONFLICT(address) DO NOTHING`,
      ).bind(...group),
    );
  }
  for (const group of groups(rows, SEND_GROUP)) {
    const values = group
      .map(
        () =>
          `(?,?,?,?,?,` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT address_id FROM address_dictionary WHERE address=?),` +
          `(SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,?,?)`,
      )
      .join(",");
    const binds = group.flatMap((row) => [
      row.event_index,
      row.tx_index,
      hashToBytes(row.tx_hash),
      row.block_index,
      row.block_time,
      row.source,
      row.destination,
      row.source_address,
      row.destination_address,
      row.asset,
      row.quantity,
      row.quantity_normalized,
      row.memo,
      row.memo_hex,
      row.send_type,
      row.status,
      row.fee_paid,
      row.msg_index,
    ]);
    statements.push(
      env.CORE_DB.prepare(
        `INSERT INTO sends
           (event_index,tx_index,tx_hash,block_index,block_time,source_id,destination_id,source_address_id,
            destination_address_id,asset_id,quantity,quantity_normalized,memo,memo_hex,send_type,status,fee_paid,msg_index)
         VALUES ${values}
         ON CONFLICT(event_index) DO UPDATE SET
           tx_index=excluded.tx_index,tx_hash=excluded.tx_hash,block_index=excluded.block_index,
           block_time=excluded.block_time,source_id=excluded.source_id,destination_id=excluded.destination_id,
           source_address_id=excluded.source_address_id,destination_address_id=excluded.destination_address_id,
           asset_id=excluded.asset_id,quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
           memo=excluded.memo,memo_hex=excluded.memo_hex,send_type=excluded.send_type,status=excluded.status,
           fee_paid=excluded.fee_paid,msg_index=excluded.msg_index`,
      ).bind(...binds),
    );
  }
  const nextCursor = rows.at(-1)?.event_index ?? cursor;
  statements.push(coreStateUpsert(env.CORE_DB, "sends_cursor", String(nextCursor)));
  if (rows.length < limit) statements.push(coreStateUpsert(env.CORE_DB, "sends_done", "1"));
  await env.CORE_DB.batch(statements);
  return { table: "sends", cursor: nextCursor, processed: rows.length, caught_up: rows.length < limit };
}
