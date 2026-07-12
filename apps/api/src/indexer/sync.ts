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
import { type Ev, type Stmt, type Ctx, bi, str } from "./events/context";
import { dispatch } from "./events/dispatch";
import { counterpartyJson } from "./counterparty";
import { hashToBytes } from "./compact-codec";

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

async function getLedgerState(db: D1Database, key: string): Promise<string | null> {
  return (await db.prepare(`SELECT value FROM ledger_state WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null;
}

async function setLedgerState(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(`INSERT INTO ledger_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key, value).run();
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

/* ---------- Counterparty stream helpers ---------- */

/** tip event_index = result_count - 1 */
async function tipEventIndex(api: string): Promise<number> {
  const d = await counterpartyJson<{ result_count?: number }>(api, `/events?limit=1`);
  return (d.result_count ?? 0) - 1;
}
/** ascending chunk [from, from+CHUNK): request cursor=from+CHUNK-1 desc, reverse. */
async function fetchAsc(api: string, from: number): Promise<Ev[]> {
  const d = await counterpartyJson<{ result?: Ev[] }>(api, `/events?cursor=${from + CHUNK - 1}&limit=${CHUNK}&verbose=true`);
  const rows: Ev[] = (d.result || []).filter((e) => e.event_index >= from);
  rows.sort((a, b) => a.event_index - b.event_index);
  return rows;
}
async function blockHash(api: string, n: number): Promise<string | null> {
  try { return (await counterpartyJson<{ result?: { block_hash?: string } }>(api, `/blocks/${n}`)).result?.block_hash ?? null; } catch { return null; }
}
async function currentBlock(api: string): Promise<number> {
  const d = await counterpartyJson<{ result?: { block_index?: number } }>(api, `/blocks/last`); return d.result?.block_index ?? 0;
}

/* ---------- credit/debit ledger backfill (isolated, non-destructive) ---------- */

/** One-off historical backfill of the credits/debits ledger (migration 0038). Pages the Counterparty
 *  event-TYPE endpoints /events/CREDIT and /events/DEBIT directly (next_cursor descending) so it fetches ONLY
 *  those ~4.3M + ~4M events instead of scanning the whole ~20M global stream — far fewer requests, far fewer
 *  429s. Per-type cursor + done flag in indexer_state. Isolated: INSERT-OR-IGNORE only, never touches
 *  balances/mirror/signals, so zero corruption risk. Idempotent on event_index. Loop /admin/backfill-ledger
 *  until {caught_up:true}. Forward capture (events/balance.ts) covers new events. */
const LEDGER_KINDS = [
  { type: "CREDIT", table: "credits", cursorKey: "ledger_credit_cursor", doneKey: "ledger_credit_done" },
  { type: "DEBIT", table: "debits", cursorKey: "ledger_debit_cursor", doneKey: "ledger_debit_done" },
] as const;

export async function backfillLedger(env: Env, opts: { maxEvents?: number } = {}): Promise<{ processed: number; written: number; credit_done: boolean; debit_done: boolean; caught_up: boolean }> {
  const api = env.COUNTERPARTY_API_BASE;
  const cap = Math.min(opts.maxEvents ?? 10000, MAX_EVENTS_PER_RUN);
  let processed = 0, written = 0;
  const done: Record<string, boolean> = {};
  for (const k of LEDGER_KINDS) {
    done[k.type] = (await getLedgerState(env.LEDGER_DB, k.doneKey)) === "1";
    if (done[k.type]) continue;
    let cursor = await getLedgerState(env.LEDGER_DB, k.cursorKey); // null on first pass = newest page
    while (processed < cap) {
      // Per-page durability: a 429/throw here ends the call, but every prior page is already committed and its
      // cursor persisted, so the next call resumes cleanly with no lost work. This is what makes it 429-resilient.
      const d = await counterpartyJson<{ result?: Ev[]; next_cursor?: number | null }>(
        api, `/events/${k.type}?verbose=true&limit=${CHUNK}${cursor != null ? `&cursor=${cursor}` : ""}`);
      const rows = d.result || [];
      const records: unknown[][] = [];
      const addresses = new Set<string>();
      const assets = new Set<string>();
      for (const ev of rows) {
        const p = ev.params;
        const holder = (p.utxo as string) || (p.address as string);
        if (holder && p.asset) {
          const utxoAddress = p.utxo ? str(p.utxo_address ?? null) : null;
          addresses.add(holder);
          assets.add(p.asset);
          if (utxoAddress) addresses.add(utxoAddress);
          records.push([
            ev.event_index, k.type === "CREDIT" ? 1 : 0, ev.block_index, hashToBytes(ev.tx_hash),
            holder, p.asset, str(p.quantity) ?? "0", str(p.calling_function ?? null), utxoAddress,
          ]);
          written++;
        }
        processed++;
      }
      if (records.length) {
        const dictionary: Stmt[] = [
          ...[...addresses].map((address): Stmt => (db) => db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES (?)`).bind(address)),
          ...[...assets].map((asset): Stmt => (db) => db.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES (?)`).bind(asset)),
        ];
        const page: Stmt[] = [];
        // Ten rows per statement stays below D1's bind-variable ceiling and cuts event-write
        // statements by 90% compared with one INSERT per row.
        for (let i = 0; i < records.length; i += 10) {
          const group = records.slice(i, i + 10);
          const values = group.map(() =>
            `(?,?,?,?,(SELECT address_id FROM address_dictionary WHERE address=?),` +
            `(SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,` +
            `(SELECT address_id FROM address_dictionary WHERE address=?))`).join(",");
          const binds = group.flat();
          page.push((db) => db.prepare(
            `INSERT OR IGNORE INTO ledger_events
               (event_index,direction,block_index,tx_hash,address_id,asset_id,quantity,calling_function,utxo_address_id)
             VALUES ${values}`,
          ).bind(...binds));
        }
        await batchAll(env.LEDGER_DB, [...dictionary, ...page]);
      }
      const nc = d.next_cursor;
      if (nc == null || rows.length === 0) { await setLedgerState(env.LEDGER_DB, k.doneKey, "1"); done[k.type] = true; break; }
      cursor = String(nc);
      await setLedgerState(env.LEDGER_DB, k.cursorKey, cursor);
    }
  }
  return { processed, written, credit_done: !!done["CREDIT"], debit_done: !!done["DEBIT"], caught_up: !!done["CREDIT"] && !!done["DEBIT"] };
}

/** Exact row-count gate before reads switch databases. Dual-write keeps both sides current. */
export async function verifyLedgerParity(env: Env): Promise<{ ok: boolean; legacy: number; compact: number }> {
  const legacyRow = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM credits)+(SELECT COUNT(*) FROM debits) n`,
  ).first<{ n: number }>();
  const compactRow = await env.LEDGER_DB.prepare(`SELECT COUNT(*) n FROM ledger_events`).first<{ n: number }>();
  const legacy = Number(legacyRow?.n ?? -1), compact = Number(compactRow?.n ?? -2);
  return { ok: legacy >= 0 && legacy === compact, legacy, compact };
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
    const binds: unknown[] = [];
    for (const k of slice) binds.push(k.holder, k.asset);
    const rows = await env.DB.prepare(`SELECT holder,asset,quantity,updated_event_index FROM balances WHERE ${ors}`).bind(...binds).all<{ holder: string; asset: string; quantity: string; updated_event_index: number | null }>();
    for (const r of rows.results) current.set(`${r.holder} ${r.asset}`, { qty: bi(r.quantity), uei: r.updated_event_index ?? 0 });
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
        `INSERT OR REPLACE INTO balance_snapshots (holder,asset,block_index,quantity,updated_event_index) VALUES (?,?,?,?,?)`
      ).bind(k.holder, k.asset, k.block, raw, k.evIdx));
    }
  }
  await batchAll(env.DB, stmts);
}

/* ---------- main replay loop ---------- */

export async function syncEvents(env: Env, opts: { maxEvents?: number } = {}): Promise<Record<string, unknown>> {
  const api = env.COUNTERPARTY_API_BASE;
  const now = Math.floor(Date.now() / 1000);

  // advisory lock
  const lock = await env.DB.prepare(
    `INSERT INTO indexer_state (key,value) VALUES ('sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER) < ?`
  ).bind(String(now), now - LOCK_TTL).run();
  if (lock.meta.changes === 0) return { skipped: "locked" };

  try {
    let lastIdx = parseInt((await getState(env.DB, "last_event_index")) || "-1", 10);
    // Full re-index (cursor reset to -1): wipe ALL DERIVED STATE so it recomputes from scratch. The general
    // hazard (learned from the negative-balance bug): any derived store with a per-row high-water or a "done"
    // flag survives a replay and silently blocks the rebuild from healing it. So on a fresh index we reset
    // EVERY such store. Raw mirror/event/row tables re-apply idempotently and are left alone.
    if (lastIdx < 0) {
      // 1) balances carry a per-balance event-index high-water → a replay is a no-op on existing rows. WIPE.
      await env.DB.prepare(`DELETE FROM balances`).run();
      await env.DB.prepare(`DELETE FROM balance_snapshots`).run();
      // 2) supply backfill is gated by a "done" flag (asset-supply.ts) — same class as the balance bug: a
      //    replay would skip the full backfill. Reset it + its cursor/queue so supply backfills cleanly.
      for (const k of ["asset_supply_done", "asset_supply_cursor", "asset_supply_queue"])
        await env.DB.prepare(`DELETE FROM indexer_state WHERE key=?`).bind(k).run();
      // 3) feature signal tables: no high-water, but stale rows would persist; the cascade cursor would also
      //    be stale. Wipe the tables + reset both signal cursors so the full rebuild reproduces them pristine.
      //    (Guarded: created lazily by the signal passes, so they may not exist on a brand-new DB.)
      for (const t of ["asset_signals", "address_signals"])
        await env.DB.prepare(`DELETE FROM ${t}`).run().catch(() => {});
      for (const k of ["signals_step", "signals_cascade_block"])
        await env.DB.prepare(`DELETE FROM indexer_state WHERE key=?`).bind(k).run();
    }
    const tip = await tipEventIndex(api);

    // Reorg check — ONLY when caught up / near tip. During historical backfill those blocks are immutable, and
    // last_block_hash is intentionally NOT maintained yet (see end of run), so running the check while
    // backfilling compares the checkpoint block's real hash against a stale tip hash, ALWAYS mismatches, and
    // fires rollback(checkpoint) — whose `block_index > checkpoint` DELETE spans millions of mirror rows and
    // NOMEMs the DB on every sync (the stuck-at-46999 bug). Gating on near-tip keeps any rollback range tiny.
    const ckBlock = parseInt((await getState(env.DB, "last_block_index")) || "0", 10);
    if (ckBlock > 0 && tip - lastIdx < 5 * CHUNK) {
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
      const ctx: Ctx = {
        stmts: [], ledgerStmts: [], ledgerAddresses: new Set(), ledgerAssets: new Set(),
        balDelta: new Map(), maxBlock: lastBlock, supplyDirty: new Set(),
      };
      for (const ev of evs) dispatch(ev, ctx);
      await batchAll(env.DB, ctx.stmts);
      const ledgerDictionary: Stmt[] = [
        ...[...ctx.ledgerAddresses].map((address): Stmt => (db) => db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES (?)`).bind(address)),
        ...[...ctx.ledgerAssets].map((asset): Stmt => (db) => db.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES (?)`).bind(asset)),
      ];
      await batchAll(env.LEDGER_DB, [...ledgerDictionary, ...ctx.ledgerStmts]);
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

    // Checkpoint hash for reorg detection — store the hash of OUR replayed checkpoint block (last_block_index),
    // NOT the chain tip. Only maintained once near tip; left untouched during backfill so the reorg gate above
    // stays off until we're actually following the tip. (Storing the tip hash here against a backfill checkpoint
    // index was the original inconsistency that produced the false reorg + NOMEM.)
    if (followingWindow && lastBlock > 0) {
      const ckHash = await blockHash(api, lastBlock);
      if (ckHash) await env.DB.batch([setStateStmt(env.DB, "last_block_hash", ckHash)]);
    }
    if (followingWindow && lastBlock > SNAPSHOT_WINDOW) await pruneSnapshots(env, lastBlock - SNAPSHOT_WINDOW);

    return { applied, last_event_index: lastIdx, last_block: lastBlock, tip, caught_up: lastIdx >= tip };
  } finally {
    await env.DB.prepare(`DELETE FROM indexer_state WHERE key='sync_lock'`).run();
  }
}

/* ---------- reorg rollback ---------- */

/** Delete every row with block_index > block from a table, in bounded batches. A single unbounded DELETE over a
 *  large range (e.g. a deep/erroneous rollback) allocates the whole change set at once and NOMEMs D1, so we
 *  loop with a rowid+LIMIT subquery until a short batch signals we're done. */
async function deleteAbove(db: D1Database, table: string, block: number): Promise<void> {
  const BATCH = 5000;
  for (;;) {
    const r = await db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE block_index > ? LIMIT ${BATCH})`).bind(block).run();
    if ((r.meta.changes ?? 0) < BATCH) break;
  }
}

/** cascade delete > rollbackTo across all tables; restore balances from snapshots <= rollbackTo. */
async function rollback(env: Env, rollbackTo: number, api: string): Promise<void> {
  const tables = ["transactions", "sends", "issuances", "destructions", "dispensers", "dispenses",
    "dispenser_refills", "cancels", "orders", "order_matches", "btcpays", "sweeps", "burns", "dividends", "broadcasts",
    "fairminters", "fairmints", "pools", "pool_matches", "pool_liquidity",
    "bets", "bet_matches", "bet_match_resolutions", "rps", "rps_matches", "credits", "debits", "blocks"];
  for (const t of tables) await deleteAbove(env.DB, t, rollbackTo);
  // reopen orders/dispensers closed after rollback
  await env.DB.prepare(`UPDATE orders SET status='open', closed_block_index=NULL WHERE closed_block_index > ?`).bind(rollbackTo).run();
  await env.DB.prepare(`UPDATE dispensers SET closed_block_index=NULL WHERE closed_block_index > ?`).bind(rollbackTo).run();
  // restore balances: for any (holder,asset) snapshotted after rollback, set to nearest snapshot <= rollbackTo (else delete)
  const changed = await env.DB.prepare(`SELECT DISTINCT holder,asset FROM balance_snapshots WHERE block_index > ?`).bind(rollbackTo).all<{ holder: string; asset: string }>();
  const stmts: Stmt[] = [];
  for (const c of changed.results) {
    const snap = await env.DB.prepare(`SELECT quantity, updated_event_index FROM balance_snapshots WHERE holder=? AND asset=? AND block_index <= ? ORDER BY block_index DESC LIMIT 1`)
      .bind(c.holder, c.asset, rollbackTo).first<{ quantity: string; updated_event_index: number }>();
    // restore quantity AND the event-index high-water from the snapshot, so the post-reorg replay re-applies
    // events after this point instead of being skipped by the idempotency guard (the negative-balance bug).
    if (snap) stmts.push((db) => db.prepare(`UPDATE balances SET quantity=?, updated_block_index=?, updated_event_index=? WHERE holder=? AND asset=?`).bind(snap.quantity, rollbackTo, snap.updated_event_index ?? 0, c.holder, c.asset));
    else stmts.push((db) => db.prepare(`DELETE FROM balances WHERE holder=? AND asset=?`).bind(c.holder, c.asset));
  }
  stmts.push((db) => db.prepare(`DELETE FROM balance_snapshots WHERE block_index > ?`).bind(rollbackTo));
  await batchAll(env.DB, stmts);
  await env.DB.batch([setStateStmt(env.DB, "last_block_index", String(rollbackTo))]);
  // back the event cursor up to the first event after rollbackTo by scanning the stream near there
  const tip = await tipEventIndex(api);
  let probe = parseInt((await getState(env.DB, "last_event_index")) || String(tip), 10);
  for (let i = 0; i < 20; i++) {
    const d = await counterpartyJson<{ result?: Ev[] }>(api, `/events?cursor=${probe}&limit=${CHUNK}&verbose=true`);
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
