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
import { applyCoreBalanceDeltas } from "#api/indexer/balance-store";
import { runCoreBlockGated } from "#api/scheduler/core-block-gate";

const CHUNK = 1000; // events per API page
// A fetched page can contain hundreds of balance and signal writes. Checkpoint
// it in smaller durable slices so an execution-limit failure cannot make every
// cron retry the same all-or-nothing 1,000-event page forever. This does not
// increase Counterparty requests, and tip-following normally remains one slice.
// Fifty also bounds the aggregate placeholders produced by a dense page.
// Production showed that 250 could still cross D1's SQL-variable ceiling
// (`too many SQL variables`); following mode normally has fewer than fifty,
// so this only adds checkpoints while draining a backlog.
const APPLY_CHUNK = 50;
const MAX_EVENTS_PER_RUN = 50_000; // cap per invocation (backfill driven by repeated calls)
const SNAPSHOT_WINDOW = 1000; // blocks of balance snapshots to retain (reorg restore)
// Longer than the Worker's 300s CPU allowance. The cron ticks every two
// minutes, so a 120s lease could be stolen by the next tick while a dense
// replay was still alive, multiplying the very D1 pressure slowing it down.
const LOCK_TTL = 15 * 60;
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

/** Read the actual newest event index. Counterparty's event indices are
 * one-based on current nodes, while older fixtures and deployments exposed
 * count-like semantics; the row itself is authoritative in either case. */
async function tipEventIndex(api: string): Promise<number> {
  const d = await counterpartyJson<{ result_count?: number; result?: Pick<Ev, "event_index">[] }>(
    api,
    `/events?limit=1`,
  );
  const newest = d.result?.[0]?.event_index;
  if (Number.isSafeInteger(newest)) return Number(newest);
  return (d.result_count ?? 0) - 1;
}
/** ascending chunk [from, from+chunk): request cursor=from+chunk-1 desc, reverse.
 *  Non-verbose on purpose: verbose enrichment inlines each touched asset's full description (stamp
 *  assets carry multi-MB blobs — one page measured 142 MB, over Worker memory). Everything verbose
 *  added is derived locally instead: divisibility from our own asset rows (chunkAssetDivisibility),
 *  normalized quantities via normalize(), block_time tracked from NEW_BLOCK (dispatch).
 *  chunk still must never overshoot the tip: a cursor past the tip makes the API fill the page
 *  descending FROM the tip, re-downloading already-applied events. */
async function fetchAsc(api: string, from: number, chunk: number): Promise<Ev[]> {
  const d = await counterpartyJson<{ result?: Ev[] }>(api, `/events?cursor=${from + chunk - 1}&limit=${chunk}`, {
    malformedRetries: 0, // oversize/parse failures are deterministic; the caller shrinks chunk instead
  });
  const rows: Ev[] = (d.result || []).filter((e) => e.event_index >= from);
  rows.sort((a, b) => a.event_index - b.event_index);
  return rows;
}
/** The chunk's asset→divisible map. Issuance events inside the chunk state divisibility themselves
 *  (and always precede the chunk's uses of a brand-new asset — Counterparty emits ASSET_ISSUANCE
 *  before the asset's first CREDIT); every other referenced asset resolves from the mirror's own
 *  rows. A reset-reissuance changing divisibility mid-chunk resolves to the chunk's final state —
 *  acceptable because a reset zeroes supply and balances in the same breath. */
async function chunkAssetDivisibility(db: D1Database, events: Ev[]): Promise<Map<string, boolean>> {
  const known = new Map<string, boolean>();
  const wanted = new Set<string>();
  for (const event of events) {
    const p = (event.params ?? {}) as Record<string, unknown>;
    if (
      (event.event === "ASSET_ISSUANCE" || event.event === "ASSET_CREATION") &&
      typeof p.asset === "string" &&
      p.divisible != null
    ) {
      known.set(p.asset, Boolean(p.divisible));
    }
  }
  for (const event of events) {
    const p = (event.params ?? {}) as Record<string, unknown>;
    for (const name of [p.asset, p.dividend_asset]) {
      if (typeof name === "string" && name && name !== "XCP" && name !== "BTC" && !known.has(name)) wanted.add(name);
    }
  }
  const names = [...wanted];
  for (let i = 0; i < names.length; i += DB_BATCH) {
    const slice = names.slice(i, i + DB_BATCH);
    const rows = await db
      .prepare(
        `SELECT d.asset, COALESCE(a.divisible,0) divisible
           FROM asset_dictionary d LEFT JOIN assets a ON a.asset_id=d.asset_id
          WHERE d.asset IN (${slice.map(() => "?").join(",")})`,
      )
      .bind(...slice)
      .all<{ asset: string; divisible: number }>();
    for (const row of rows.results) known.set(row.asset, row.divisible === 1);
  }
  return known;
}
/** Fetch the next ascending chunk, shrinking the page size whenever the verbose payload is too large
 *  to buffer (Workers throws "Memory limit would be exceeded before EOF"). Returns the surviving chunk
 *  size so the rest of the run stays below the discovered ceiling. */
async function fetchAscAdaptive(
  api: string,
  from: number,
  remaining: number,
  chunk: number,
): Promise<{ events: Ev[]; chunk: number }> {
  for (;;) {
    const size = Math.max(1, Math.min(chunk, remaining));
    try {
      return { events: await fetchAsc(api, from, size), chunk };
    } catch (error) {
      if (size <= 1) throw error;
      chunk = Math.ceil(size / 4);
    }
  }
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
export async function syncCoreEvents(
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

    const [tip, sourceTipBlock] = await Promise.all([
      tipEventIndex(env.COUNTERPARTY_API_BASE),
      currentBlock(env.COUNTERPARTY_API_BASE),
    ]);
    // Persist the independently observed source height before replay. Even when a later event handler fails,
    // readiness must report the lag instead of comparing the local mirror to itself and claiming "synced".
    await setCoreStateStmt(env.CORE_DB, "source_tip_block", String(sourceTipBlock)).run();
    const followingWindow = tip - lastIndex < 5 * CHUNK;
    if (followingWindow && lastBlock > 0) {
      const [storedHash, actualHash] = await Promise.all([
        getCoreState(env.CORE_DB, "last_block_hash"),
        blockHash(env.COUNTERPARTY_API_BASE, lastBlock),
      ]);
      if (storedHash && actualHash && storedHash !== actualHash) {
        const rollbackTo = lastBlock - 1;
        await rollbackCoreDatabase(env.CORE_DB, rollbackTo);
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
    let chunk = CHUNK;
    // Events between the chunk start and its first NEW_BLOCK belong to the cursor block; its time
    // is already in our own blocks row. From there dispatch tracks NEW_BLOCK as the stream walks.
    let blockTime =
      lastBlock > 0
        ? ((
            await env.CORE_DB.prepare(`SELECT block_time FROM blocks WHERE block_index=?`)
              .bind(lastBlock)
              .first<{ block_time: number | null }>()
          )?.block_time ?? null)
        : null;
    while (lastIndex < tip && applied < cap) {
      const page = await fetchAscAdaptive(env.COUNTERPARTY_API_BASE, lastIndex + 1, tip - lastIndex, chunk);
      chunk = page.chunk;
      const events = page.events;
      if (events.length === 0) break;
      for (let offset = 0; offset < events.length; offset += APPLY_CHUNK) {
        const slice = events.slice(offset, offset + APPLY_CHUNK);
        const ctx: Ctx = {
          stmts: [],
          identities: createIdentitySet(),
          balDelta: new Map(),
          maxBlock: lastBlock,
          supplyDirty: new Set(),
          assetDivisibility: await chunkAssetDivisibility(env.CORE_DB, slice),
          blockTime,
        };
        for (const event of slice) dispatch(event, ctx);
        await batchAll(env.CORE_DB, [...dictionaryStatements(ctx.identities), ...ctx.stmts]);
        await applyCoreBalanceDeltas(env.CORE_DB, ctx.balDelta, tip - lastIndex < 5 * CHUNK);
        await rebuildCoreAssetSignals(env.CORE_DB, ctx.identities.assets);
        await enqueueCoreAddressSignals(env.CORE_DB, ctx.identities.addresses, ctx.identities.assets);
        await enqueueCoreSupply(env.CORE_DB, ctx.supplyDirty);
        lastIndex = slice[slice.length - 1].event_index;
        lastBlock = Math.max(lastBlock, ctx.maxBlock);
        blockTime = ctx.blockTime;
        applied += slice.length;
        await env.CORE_DB.batch([
          setCoreStateStmt(env.CORE_DB, "last_event_index", String(lastIndex)),
          setCoreStateStmt(env.CORE_DB, "last_block_index", String(lastBlock)),
        ]);
      }
    }

    const caughtUp = lastIndex >= tip;
    if (caughtUp) {
      // Gated, not every tick. The prune retains the newest snapshot per
      // holder+asset below the cutoff, and the cutoff trails the tip by
      // SNAPSHOT_WINDOW (1000 blocks, about a week) -- so nothing new becomes
      // prunable between two blocks, let alone between two 2-minute ticks.
      //
      // It ran on every caught-up tick, and this worker has two cron schedules
      // (*/2 and 1-59/2), so it fired 1,248 times a day. The table holds only
      // 41,712 rows but the correlated EXISTS probes one newer row per
      // candidate, so each run read 74,182 -- 93M rows/day, the largest live
      // query on this database, to delete what an hour of waiting would have
      // let it delete in one pass.
      //
      // Six blocks is roughly an hour. The table can only grow by an hour of
      // snapshots between runs, against a window that retains a week of them.
      if (lastBlock > SNAPSHOT_WINDOW) {
        await runCoreBlockGated(env.CORE_DB, "balance_snapshot_prune_blk", 6, () =>
          pruneCoreSnapshots(env.CORE_DB, lastBlock - SNAPSHOT_WINDOW),
        );
      }
      const checkpointHash = lastBlock > 0 ? await blockHash(env.COUNTERPARTY_API_BASE, lastBlock) : null;
      if (checkpointHash) await setCoreStateStmt(env.CORE_DB, "last_block_hash", checkpointHash).run();
    }
    return {
      applied,
      chunk,
      last_event_index: lastIndex,
      last_block: lastBlock,
      source_tip_block: sourceTipBlock,
      tip,
      caught_up: caughtUp,
    };
  } finally {
    await env.CORE_DB.prepare(`DELETE FROM core_state WHERE key='replay_lock' AND value=?`).bind(lockValue).run();
  }
}

/** Find the final event at or before a rollback block using Counterparty's descending cursor pages.
 *  Non-verbose on purpose: only event_index/block_index are read, and verbose pages can be huge. */
async function eventCursorBeforeBlock(api: string, cursor: number, block: number): Promise<number> {
  let probe = cursor;
  for (;;) {
    const page = await counterpartyJson<{ result?: Ev[] }>(api, `/events?cursor=${probe}&limit=${CHUNK}`);
    const rows = page.result ?? [];
    const retained = rows.find((event) => event.block_index <= block);
    if (retained) return retained.event_index;
    if (rows.length === 0) return -1;
    probe = Math.min(...rows.map((event) => event.event_index)) - 1;
  }
}

/** Maintain the rolling reorg window using canonical holder identities. */
export async function pruneCoreSnapshots(db: D1Database, cutoff: number): Promise<void> {
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

interface CoreBalanceIdentity {
  address_id: number | null;
  utxo_tx_hash: ArrayBuffer | null;
  utxo_vout: number | null;
  asset_id: number;
}

/** Remove one orphaned branch and restore every affected balance to its nearest retained snapshot. */
export async function rollbackCoreDatabase(db: D1Database, rollbackTo: number): Promise<void> {
  const tables = [
    "transactions",
    "transaction_outputs",
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
    .prepare(
      `DELETE FROM trade_legs WHERE venue IN ('dex','dispense')
       AND NOT EXISTS (SELECT 1 FROM trades WHERE trades.venue=trade_legs.venue AND trades.ref=trade_legs.trade_ref)`,
    )
    .run();
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
    .all<CoreBalanceIdentity>();
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
    setCoreStateStmt(db, "trades_cur_dispense_payments", String(rollbackTo)),
  ]);
}
