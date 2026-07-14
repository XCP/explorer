/**
 * Counterparty mirror engine — chronological event replay into normalized D1.
 *
 * Walks the GLOBAL event stream ascending (event_index is contiguous 0..tip; cursor=X returns <=X
 * descending, so we request a window and reverse it). One unified loop does both backfill (catch up from
 * last_event_index to tip) and following (apply the few new events each tick). Each event is routed to its
 * handler by dispatch() (see events/dispatch.ts); this file owns only the "how we replay" machinery:
 * fetch, batch-write, balances, cursor, and reorg rollback.
 *
 * Correctness model — never drop, always retry. Writes are flushed in D1 batches; a batch failure THROWS,
 * so the run aborts without advancing the cursor and the chunk re-runs next tick. Every write is idempotent
 * (INSERT OR IGNORE on event_index / OR REPLACE on PK / balance updated_event_index high-water), so
 * re-applying a partially-committed chunk is exact. No silent drops, so no repair pass is needed.
 *
 * Reorg: hash-mismatch at our checkpoint -> cascade DELETE WHERE block_index > rollbackTo across all
 * tables, restore balances from the nearest snapshot, reset the event cursor, replay forward. Balance
 * snapshots are written only near the tip (FOLLOWING window) and pruned keep-one-below-cutoff.
 */
import type { Env } from "#api/env";
import { normalize } from "#api/indexer/codec";
import { type Ev, type Stmt, type Ctx } from "#api/indexer/events/context";
import { dispatch } from "#api/indexer/events/dispatch";
import { counterpartyJson } from "#api/integrations/counterparty";
import { createIdentitySet, dictionaryStatements } from "#api/indexer/dictionaries";
import { rebuildCoreAssetSignals } from "#api/indexer/core-asset-signals";
import { enqueueCoreSupply } from "#api/indexer/asset-supply";
import { enqueueCoreAddressSignals } from "#api/indexer/core-address-signals";
import { applyCompactBalanceDeltas } from "#api/indexer/balance-store";

const CHUNK = 1000; // events per API page
const MAX_EVENTS_PER_RUN = 50_000; // cap per invocation (backfill driven by repeated calls)
const SNAPSHOT_WINDOW = 1000; // blocks of balance snapshots to retain (reorg restore)
const LOCK_TTL = 120;
const DB_BATCH = 90; // D1 max ~100 stmts/batch

/* ---------- state + write helpers ---------- */

async function getCoreState(db: D1Database, key: string): Promise<string | null> {
  return (
    (await db.prepare(`SELECT value FROM core_state WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null
  );
}

function setCoreStateStmt(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO core_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(key, value);
}
// Flush statements in D1-sized batches. STRICT: a batch failure throws so the caller aborts the run
// without advancing the cursor; the chunk re-runs and idempotency re-applies it exactly. Never drops.
async function batchAll(db: D1Database, stmts: Stmt[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += DB_BATCH) {
    await db.batch(stmts.slice(i, i + DB_BATCH).map((f) => f(db)));
  }
}

/* ---------- Counterparty stream helpers ---------- */

/** tip event_index = result_count - 1 */
async function tipEventIndex(api: string): Promise<number> {
  const d = await counterpartyJson<{ result_count?: number }>(api, `/events?limit=1`);
  return (d.result_count ?? 0) - 1;
}
/** ascending chunk [from, from+CHUNK): request cursor=from+CHUNK-1 desc, reverse. */
async function fetchAsc(api: string, from: number): Promise<Ev[]> {
  const d = await counterpartyJson<{ result?: Ev[] }>(
    api,
    `/events?cursor=${from + CHUNK - 1}&limit=${CHUNK}&verbose=true`,
  );
  const rows: Ev[] = (d.result || []).filter((e) => e.event_index >= from);
  rows.sort((a, b) => a.event_index - b.event_index);
  return rows;
}
async function blockHash(api: string, n: number): Promise<string | null> {
  try {
    return (
      (await counterpartyJson<{ result?: { block_hash?: string } }>(api, `/blocks/${n}`)).result?.block_hash ?? null
    );
  } catch {
    return null;
  }
}
async function currentBlock(api: string): Promise<number> {
  const d = await counterpartyJson<{ result?: { block_index?: number } }>(api, `/blocks/last`);
  return d.result?.block_index ?? 0;
}

/** Replay Counterparty's canonical event stream from the durable local cursor. */
export async function syncCompactEvents(
  env: Pick<Env, "CORE_DB" | "COUNTERPARTY_API_BASE">,
  opts: { maxEvents?: number } = {},
): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const lockValue = String(now);
  const lock = await env.CORE_DB.prepare(
    `INSERT INTO core_state(key,value) VALUES('replay_lock',?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER) < ?`,
  )
    .bind(lockValue, now - LOCK_TTL)
    .run();
  if (lock.meta.changes === 0) return { skipped: "locked" };

  try {
    const [cursorValue, blockValue] = await Promise.all([
      getCoreState(env.CORE_DB, "last_event_index"),
      getCoreState(env.CORE_DB, "last_block_index"),
    ]);
    let lastIndex = Number.parseInt(cursorValue ?? "-1", 10);
    let lastBlock = Number.parseInt(blockValue ?? "0", 10);
    if (!Number.isSafeInteger(lastIndex) || lastIndex < -1) throw new Error("replay cursor is invalid");

    const tip = await tipEventIndex(env.COUNTERPARTY_API_BASE);
    const followingWindow = tip - lastIndex < 5 * CHUNK;
    if (followingWindow && lastBlock > 0) {
      const [storedHash, actualHash] = await Promise.all([
        getCoreState(env.CORE_DB, "last_block_hash"),
        blockHash(env.COUNTERPARTY_API_BASE, lastBlock),
      ]);
      if (storedHash && actualHash && storedHash !== actualHash) {
        const rollbackTo = lastBlock - 1;
        await rollbackCompactDatabase(env.CORE_DB, rollbackTo);
        lastIndex = await eventCursorBeforeBlock(env.COUNTERPARTY_API_BASE, lastIndex, rollbackTo);
        lastBlock = rollbackTo;
        await env.CORE_DB.batch([
          setCoreStateStmt(env.CORE_DB, "last_event_index", String(lastIndex)),
          setCoreStateStmt(env.CORE_DB, "last_block_index", String(lastBlock)),
        ]);
      }
    }
    const cap = Math.min(opts.maxEvents ?? MAX_EVENTS_PER_RUN, MAX_EVENTS_PER_RUN);
    let applied = 0;
    while (lastIndex < tip && applied < cap) {
      const events = await fetchAsc(env.COUNTERPARTY_API_BASE, lastIndex + 1);
      if (events.length === 0) break;
      const ctx: Ctx = {
        stmts: [],
        identities: createIdentitySet(),
        balDelta: new Map(),
        maxBlock: lastBlock,
        supplyDirty: new Set(),
      };
      for (const event of events) dispatch(event, ctx);
      await batchAll(env.CORE_DB, [...dictionaryStatements(ctx.identities), ...ctx.stmts]);
      await applyCompactBalanceDeltas(env.CORE_DB, ctx.balDelta, tip - lastIndex < 5 * CHUNK);
      await rebuildCoreAssetSignals(env.CORE_DB, ctx.identities.assets);
      await enqueueCoreAddressSignals(env.CORE_DB, ctx.identities.addresses);
      await enqueueCoreSupply(env.CORE_DB, ctx.supplyDirty);
      lastIndex = events[events.length - 1].event_index;
      lastBlock = Math.max(lastBlock, ctx.maxBlock);
      applied += events.length;
      await env.CORE_DB.batch([
        setCoreStateStmt(env.CORE_DB, "last_event_index", String(lastIndex)),
        setCoreStateStmt(env.CORE_DB, "last_block_index", String(lastBlock)),
      ]);
    }

    const caughtUp = lastIndex >= tip;
    if (caughtUp) {
      if (lastBlock > SNAPSHOT_WINDOW) await pruneCompactSnapshots(env.CORE_DB, lastBlock - SNAPSHOT_WINDOW);
      const checkpointHash = lastBlock > 0 ? await blockHash(env.COUNTERPARTY_API_BASE, lastBlock) : null;
      if (checkpointHash) await setCoreStateStmt(env.CORE_DB, "last_block_hash", checkpointHash).run();
    }
    return {
      applied,
      last_event_index: lastIndex,
      last_block: lastBlock,
      tip,
      caught_up: caughtUp,
    };
  } finally {
    await env.CORE_DB.prepare(`DELETE FROM core_state WHERE key='replay_lock' AND value=?`).bind(lockValue).run();
  }
}

/** Find the final event at or before a rollback block using Counterparty's descending cursor pages. */
async function eventCursorBeforeBlock(api: string, cursor: number, block: number): Promise<number> {
  let probe = cursor;
  for (;;) {
    const page = await counterpartyJson<{ result?: Ev[] }>(api, `/events?cursor=${probe}&limit=${CHUNK}&verbose=true`);
    const rows = page.result ?? [];
    const retained = rows.find((event) => event.block_index <= block);
    if (retained) return retained.event_index;
    if (rows.length === 0) return -1;
    probe = Math.min(...rows.map((event) => event.event_index)) - 1;
  }
}

/** Match the source mirror's rolling reorg window using compact holder identities. */
export async function pruneCompactSnapshots(db: D1Database, cutoff: number): Promise<void> {
  await db
    .prepare(
      `DELETE FROM balance_snapshots AS old
        WHERE old.block_index < ?
          AND EXISTS (
            SELECT 1 FROM balance_snapshots newer
             WHERE newer.asset_id=old.asset_id
               AND newer.block_index < ?
               AND newer.block_index > old.block_index
               AND (
                 (old.address_id IS NOT NULL AND newer.address_id=old.address_id) OR
                 (old.address_id IS NULL AND newer.utxo_tx_hash=old.utxo_tx_hash AND newer.utxo_vout=old.utxo_vout)
               )
          )`,
    )
    .bind(cutoff, cutoff)
    .run();
}

/* ---------- reorg rollback ---------- */

/** Delete every row with block_index > block from a table, in bounded batches. A single unbounded DELETE over a
 *  large range (e.g. a deep/erroneous rollback) allocates the whole change set at once and NOMEMs D1, so we
 *  loop with a rowid+LIMIT subquery until a short batch signals we're done. */
async function deleteAbove(db: D1Database, table: string, block: number): Promise<void> {
  const BATCH = 5000;
  for (;;) {
    const r = await db
      .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE block_index > ? LIMIT ${BATCH})`)
      .bind(block)
      .run();
    if ((r.meta.changes ?? 0) < BATCH) break;
  }
}

interface CompactBalanceIdentity {
  address_id: number | null;
  utxo_tx_hash: ArrayBuffer | null;
  utxo_vout: number | null;
  asset_id: number;
}

/** Remove one orphaned compact branch and restore every affected balance to its nearest retained snapshot. */
export async function rollbackCompactDatabase(db: D1Database, rollbackTo: number): Promise<void> {
  const tables = [
    "transactions",
    "sends",
    "issuances",
    "destructions",
    "dispensers",
    "dispenses",
    "dispenser_refills",
    "cancels",
    "orders",
    "order_matches",
    "btcpays",
    "sweeps",
    "burns",
    "dividends",
    "broadcasts",
    "fairminters",
    "fairmints",
    "pools",
    "pool_matches",
    "pool_liquidity",
    "bets",
    "bet_matches",
    "bet_match_resolutions",
    "rps",
    "rps_matches",
    "ledger_events",
    "blocks",
  ];
  for (const table of tables) await deleteAbove(db, table, rollbackTo);
  await db.prepare(`DELETE FROM trades WHERE venue IN ('dex','dispense') AND block_index>?`).bind(rollbackTo).run();
  await db
    .prepare(`UPDATE orders SET status='open',closed_block_index=NULL WHERE closed_block_index>?`)
    .bind(rollbackTo)
    .run();
  await db.prepare(`UPDATE dispensers SET closed_block_index=NULL WHERE closed_block_index>?`).bind(rollbackTo).run();

  const changed = await db
    .prepare(
      `SELECT DISTINCT address_id,utxo_tx_hash,utxo_vout,asset_id
       FROM balance_snapshots WHERE block_index>?`,
    )
    .bind(rollbackTo)
    .all<CompactBalanceIdentity>();
  const statements: Stmt[] = [];
  for (const identity of changed.results) {
    const snapshot = await db
      .prepare(
        `SELECT s.quantity,s.updated_event_index,
                CASE WHEN d.asset IN ('BTC','XCP') THEN 1 ELSE coalesce(a.divisible,0) END divisible
         FROM balance_snapshots s
         JOIN asset_dictionary d ON d.asset_id=s.asset_id
         LEFT JOIN assets a ON a.asset_id=s.asset_id
         WHERE s.asset_id=?
           AND ((? IS NOT NULL AND s.address_id=?) OR
                (? IS NULL AND s.utxo_tx_hash=? AND s.utxo_vout=?))
           AND s.block_index<=?
         ORDER BY s.block_index DESC LIMIT 1`,
      )
      .bind(
        identity.asset_id,
        identity.address_id,
        identity.address_id,
        identity.address_id,
        identity.utxo_tx_hash,
        identity.utxo_vout,
        rollbackTo,
      )
      .first<{ quantity: string; updated_event_index: number; divisible: number }>();
    const identityPredicate =
      identity.address_id == null
        ? `address_id IS NULL AND utxo_tx_hash=? AND utxo_vout=? AND asset_id=?`
        : `address_id=? AND asset_id=?`;
    const identityBinds =
      identity.address_id == null
        ? [identity.utxo_tx_hash, identity.utxo_vout, identity.asset_id]
        : [identity.address_id, identity.asset_id];
    if (snapshot) {
      statements.push((target) =>
        target
          .prepare(
            `UPDATE balances SET quantity=?,quantity_normalized=?,updated_block_index=?,updated_event_index=?
             WHERE ${identityPredicate}`,
          )
          .bind(
            snapshot.quantity,
            normalize(snapshot.quantity, snapshot.divisible === 1),
            rollbackTo,
            snapshot.updated_event_index,
            ...identityBinds,
          ),
      );
    } else {
      statements.push((target) =>
        target.prepare(`DELETE FROM balances WHERE ${identityPredicate}`).bind(...identityBinds),
      );
    }
  }
  statements.push((target) => target.prepare(`DELETE FROM balance_snapshots WHERE block_index>?`).bind(rollbackTo));
  await batchAll(db, statements);
  await db.batch([
    setCoreStateStmt(db, "last_block_index", String(rollbackTo)),
    setCoreStateStmt(db, "trades_cur_dex", String(rollbackTo)),
    setCoreStateStmt(db, "trades_cur_dispense", String(rollbackTo)),
  ]);
}
