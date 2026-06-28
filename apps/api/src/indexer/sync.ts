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
import type { Env } from "../index";
import { normalize } from "./codec";
import { type Ev, type Stmt, type Ctx, bi } from "./events/context";
import { dispatch } from "./events/dispatch";
import { cpJson } from "./cp";

const CHUNK = 1000;                 // events per API page
const MAX_EVENTS_PER_RUN = 50_000;  // cap per invocation (backfill driven by repeated calls)
const SNAPSHOT_WINDOW = 1000;       // blocks of balance snapshots to retain (reorg restore)
const LOCK_TTL = 120;
const DB_BATCH = 90;                // D1 max ~100 stmts/batch

/* ---------- state + write helpers ---------- */

async function getState(db: D1Database, k: string): Promise<string | null> {
  return (await db.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value ?? null;
}
function setStateStmt(db: D1Database, k: string, v: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v);
}

// Flush statements in D1-sized batches. STRICT: a batch failure throws so the caller aborts the run
// without advancing the cursor; the chunk re-runs and idempotency re-applies it exactly. Never drops.
async function batchAll(db: D1Database, stmts: Stmt[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += DB_BATCH) {
    await db.batch(stmts.slice(i, i + DB_BATCH).map((f) => f(db)));
  }
}

// Durable supply-recompute queue (indexer_state 'asset_supply_queue'). Assets land here when a
// supply-changing event (issuance/reset/destruction/fairmint) is mirrored; the cron recomputes their
// supply deterministically from our own ledger (see asset-supply.ts maintenance phase).
async function enqueueSupply(db: D1Database, assets: string[]): Promise<void> {
  if (!assets.length) return;
  const cur: string[] = JSON.parse((await getState(db, "asset_supply_queue")) || "[]");
  const set = new Set<string>(cur);
  for (const a of assets) if (a) set.add(a);
  const capped = [...set].slice(-3000); // bound the queue; drained per run by the maintenance phase
  await setStateStmt(db, "asset_supply_queue", JSON.stringify(capped)).run();
}

/* ---------- CP stream helpers ---------- */

/** tip event_index = result_count - 1 */
async function tipEventIndex(api: string): Promise<number> {
  const d = await cpJson(api, `/events?limit=1`);
  return (d.result_count ?? 0) - 1;
}
/** ascending chunk [from, from+CHUNK): request cursor=from+CHUNK-1 desc, reverse. */
async function fetchAsc(api: string, from: number): Promise<Ev[]> {
  const d = await cpJson(api, `/events?cursor=${from + CHUNK - 1}&limit=${CHUNK}&verbose=true`);
  const rows: Ev[] = (d.result || []).filter((e: Ev) => e.event_index >= from);
  rows.sort((a, b) => a.event_index - b.event_index);
  return rows;
}
async function blockHash(api: string, n: number): Promise<string | null> {
  try { return (await cpJson(api, `/blocks/${n}`)).result?.block_hash ?? null; } catch { return null; }
}
async function currentBlock(api: string): Promise<number> {
  const d = await cpJson(api, `/blocks/last`); return d.result?.block_index ?? 0;
}

/* ---------- balances: apply netted deltas for a chunk ---------- */

async function applyBalances(env: Env, ctx: Ctx, snapshot: boolean): Promise<void> {
  if (ctx.balDelta.size === 0) return;
  const keys = [...ctx.balDelta.values()];
  // read current balances for affected (holder,asset) in chunks
  const current = new Map<string, { qty: bigint; uei: number }>();
  for (let i = 0; i < keys.length; i += 50) {
    const slice = keys.slice(i, i + 50);
    const ors = slice.map(() => `(holder=? AND asset=?)`).join(" OR ");
    const binds: any[] = [];
    for (const k of slice) binds.push(k.holder, k.asset);
    const rows = await env.DB.prepare(`SELECT holder,asset,quantity,updated_event_index FROM balances WHERE ${ors}`).bind(...binds).all<{ holder: string; asset: string; quantity: string }>();
    for (const r of rows.results) current.set(`${r.holder} ${r.asset}`, { qty: bi(r.quantity), uei: (r as any).updated_event_index ?? 0 });
  }
  const stmts: Stmt[] = [];
  for (const k of keys) {
    const key = `${k.holder} ${k.asset}`;
    const cur = current.get(key);
    if (cur && k.evIdx <= cur.uei) continue; // already applied past this chunk -> idempotent skip
    const next = (cur?.qty ?? 0n) + k.delta;
    const raw = next.toString();
    const norm = normalize(raw, k.divisible);
    stmts.push((db) => db.prepare(
      `INSERT INTO balances (holder,asset,holder_type,quantity,quantity_normalized,updated_block_index,updated_event_index,utxo_address) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(holder,asset) DO UPDATE SET quantity=excluded.quantity, quantity_normalized=excluded.quantity_normalized, updated_block_index=excluded.updated_block_index, updated_event_index=excluded.updated_event_index, utxo_address=COALESCE(excluded.utxo_address,balances.utxo_address)`
    ).bind(k.holder, k.asset, k.htype, raw, norm, k.block, k.evIdx, k.utxoAddr ?? null));
    if (snapshot) {
      stmts.push((db) => db.prepare(
        `INSERT OR REPLACE INTO balance_snapshots (holder,asset,block_index,quantity) VALUES (?,?,?,?)`
      ).bind(k.holder, k.asset, k.block, raw));
    }
  }
  await batchAll(env.DB, stmts);
}

/* ---------- main replay loop ---------- */

export async function syncEvents(env: Env, opts: { maxEvents?: number } = {}): Promise<any> {
  const api = env.CP_API_BASE;
  const now = Math.floor(Date.now() / 1000);

  // advisory lock
  const lock = await env.DB.prepare(
    `INSERT INTO indexer_state (key,value) VALUES ('sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER) < ?`
  ).bind(String(now), now - LOCK_TTL).run();
  if (lock.meta.changes === 0) return { skipped: "locked" };

  try {
    let lastIdx = parseInt((await getState(env.DB, "last_event_index")) || "-1", 10);
    const tip = await tipEventIndex(api);
    const tipBlockHash = await blockHash(api, await currentBlock(api));

    // reorg check (only meaningful once caught up): our checkpoint block hash still valid?
    const ckBlock = parseInt((await getState(env.DB, "last_block_index")) || "0", 10);
    if (ckBlock > 0) {
      const stored = await getState(env.DB, "last_block_hash");
      const actual = await blockHash(api, ckBlock);
      if (stored && actual && stored !== actual) {
        await rollback(env, ckBlock - 1, api);
        lastIdx = parseInt((await getState(env.DB, "last_event_index")) || "-1", 10);
      }
    }

    const cap = opts.maxEvents ?? MAX_EVENTS_PER_RUN;
    let applied = 0, lastBlock = parseInt((await getState(env.DB, "last_block_index")) || "0", 10);
    const followingWindow = tip - lastIdx < 5 * CHUNK; // near tip -> snapshot balances

    while (lastIdx < tip && applied < cap) {
      const evs = await fetchAsc(api, lastIdx + 1);
      if (!evs.length) break;
      const ctx: Ctx = { stmts: [], balDelta: new Map(), maxBlock: lastBlock, supplyDirty: new Set() };
      for (const ev of evs) dispatch(ev, ctx);
      await batchAll(env.DB, ctx.stmts);
      await applyBalances(env, ctx, followingWindow);
      if (ctx.supplyDirty.size > 0) await enqueueSupply(env.DB, [...ctx.supplyDirty]);

      lastIdx = evs[evs.length - 1].event_index;
      lastBlock = Math.max(lastBlock, ctx.maxBlock);
      applied += evs.length;
      await env.DB.batch([
        setStateStmt(env.DB, "last_event_index", String(lastIdx)),
        setStateStmt(env.DB, "last_block_index", String(lastBlock)),
      ]);
    }

    // checkpoint block hash for reorg detection + prune snapshots
    if (tipBlockHash) await env.DB.batch([setStateStmt(env.DB, "last_block_hash", tipBlockHash)]);
    if (followingWindow && lastBlock > SNAPSHOT_WINDOW) await pruneSnapshots(env, lastBlock - SNAPSHOT_WINDOW);

    return { applied, last_event_index: lastIdx, last_block: lastBlock, tip, caught_up: lastIdx >= tip };
  } finally {
    await env.DB.prepare(`DELETE FROM indexer_state WHERE key='sync_lock'`).run();
  }
}

/* ---------- reorg rollback ---------- */

/** cascade delete > rollbackTo across all tables; restore balances from snapshots <= rollbackTo. */
async function rollback(env: Env, rollbackTo: number, api: string): Promise<void> {
  const tables = ["transactions", "sends", "issuances", "destructions", "dispensers", "dispenses",
    "dispenser_refills", "cancels", "orders", "order_matches", "btcpays", "sweeps", "burns", "dividends", "broadcasts",
    "fairminters", "fairmints", "pools", "pool_matches", "pool_liquidity",
    "bets", "bet_matches", "bet_match_resolutions", "rps", "rps_matches", "blocks"];
  for (const t of tables) await env.DB.prepare(`DELETE FROM ${t} WHERE block_index > ?`).bind(rollbackTo).run();
  // reopen orders/dispensers closed after rollback
  await env.DB.prepare(`UPDATE orders SET status='open', closed_block_index=NULL WHERE closed_block_index > ?`).bind(rollbackTo).run();
  await env.DB.prepare(`UPDATE dispensers SET closed_block_index=NULL WHERE closed_block_index > ?`).bind(rollbackTo).run();
  // restore balances: for any (holder,asset) snapshotted after rollback, set to nearest snapshot <= rollbackTo (else delete)
  const changed = await env.DB.prepare(`SELECT DISTINCT holder,asset FROM balance_snapshots WHERE block_index > ?`).bind(rollbackTo).all<{ holder: string; asset: string }>();
  const stmts: Stmt[] = [];
  for (const c of changed.results) {
    const snap = await env.DB.prepare(`SELECT quantity FROM balance_snapshots WHERE holder=? AND asset=? AND block_index <= ? ORDER BY block_index DESC LIMIT 1`)
      .bind(c.holder, c.asset, rollbackTo).first<{ quantity: string }>();
    if (snap) stmts.push((db) => db.prepare(`UPDATE balances SET quantity=?, updated_block_index=? WHERE holder=? AND asset=?`).bind(snap.quantity, rollbackTo, c.holder, c.asset));
    else stmts.push((db) => db.prepare(`DELETE FROM balances WHERE holder=? AND asset=?`).bind(c.holder, c.asset));
  }
  stmts.push((db) => db.prepare(`DELETE FROM balance_snapshots WHERE block_index > ?`).bind(rollbackTo));
  await batchAll(env.DB, stmts);
  await env.DB.batch([setStateStmt(env.DB, "last_block_index", String(rollbackTo))]);
  // back the event cursor up to the first event after rollbackTo by scanning the stream near there
  const tip = await tipEventIndex(api);
  let probe = parseInt((await getState(env.DB, "last_event_index")) || String(tip), 10);
  for (let i = 0; i < 20; i++) {
    const d = await cpJson(api, `/events?cursor=${probe}&limit=${CHUNK}&verbose=true`);
    const rows: Ev[] = d.result || [];
    const firstAfter = [...rows].reverse().find((e) => e.block_index > rollbackTo);
    if (firstAfter) { await env.DB.batch([setStateStmt(env.DB, "last_event_index", String(firstAfter.event_index - 1))]); return; }
    if (!rows.length) break;
    probe = rows[rows.length - 1].event_index - 1;
  }
}

async function pruneSnapshots(env: Env, cutoff: number): Promise<void> {
  // delete snapshots below cutoff EXCEPT the latest per (holder,asset) below cutoff (always a restore point)
  await env.DB.prepare(
    `DELETE FROM balance_snapshots WHERE block_index < ? AND block_index NOT IN (
       SELECT MAX(block_index) FROM balance_snapshots bs2 WHERE bs2.holder=balance_snapshots.holder AND bs2.asset=balance_snapshots.asset AND bs2.block_index < ?
     )`
  ).bind(cutoff, cutoff).run();
}
