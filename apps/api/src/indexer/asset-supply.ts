/**
 * Deterministic asset supply — computed from our own mirrored ledger, NOT refetched from Counterparty.
 *
 * Counterparty supply is a pure function of the event stream we replay. Verified 1:1 against Counterparty
 * (XCP exact to the satoshi; 252,466/252,475 assets exact — the rest were legacy float-precision
 * corruption, healed by re-index). The formulas are Counterparty's own (lib/ledger/supplies.py):
 *
 *   asset_supply(asset) = Σ(issuances.quantity) − Σ(destructions.quantity)        [status='valid']
 *   xcp_supply          = Σ(burns.earned)                                          [status='valid']
 *                         − Σ(destructions.quantity WHERE asset='XCP')
 *                         − Σ(issuances.fee_paid) − Σ(dividends.fee_paid) − Σ(sweeps.fee_paid)
 *
 * (Attach/detach gas fees are XCP ASSET_DESTRUCTIONs — already inside the XCP destructions term.)
 * supply_normalized uses the asset's CURRENT divisibility (a CIP03 reset can flip it; sync.ts keeps
 * assets.divisible tracking the latest valid issuance).
 *
 * Also recomputed deterministically here (gap-audit found these columns never populated):
 *   fairminters.earned_quantity/paid_quantity = Σ over that fairminter's valid fairmints
 *   pools.lp_supply = the LP token's own supply; pools.price = spot reserve ratio (b per a)
 *
 * Two phases (like the emblem crawler):
 *  - BACKFILL: stepped full recompute over all assets (rowid cursor) — one-time after a (re)index.
 *  - MAINTENANCE: recompute the dirty queue (assets touched by a supply-changing event, queued by
 *    sync.ts) + XCP every run, then the small fairminter/pool derivations.
 */
import type { Env } from "#api/env";
import {
  getIndexerState as getState,
  getIndexerStateStringArray,
  setIndexerState as setState,
} from "#api/indexer/state";
import { normalize } from "#api/indexer/codec";

const BACKFILL_BATCH = 2000; // assets per backfill step (per-asset SUM is asset-indexed)
const DIRTY_PER_RUN = 400; // dirty assets recomputed per maintenance tick

async function batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
}

// raw supply = Σ(valid issuances) − Σ(valid destructions); int64-exact via CAST(... AS TEXT). Excludes XCP.
const SUPPLY_EXPR = `CAST((COALESCE((SELECT SUM(CAST(i.quantity AS INTEGER)) FROM issuances i WHERE i.asset=assets.asset AND i.status='valid'),0)
       - COALESCE((SELECT SUM(CAST(d.quantity AS INTEGER)) FROM destructions d WHERE d.asset=assets.asset AND d.status='valid'),0)) AS TEXT)`;

// After raw supply is set, derive supply_normalized in JS via the same normalize() the sync uses (exact
// string math, no float) using each asset's current divisibility.
async function normalizePass(env: Env, where: string, binds: unknown[]): Promise<void> {
  const rows = await env.DB.prepare(`SELECT asset, supply, divisible FROM assets WHERE ${where} AND supply IS NOT NULL`)
    .bind(...binds)
    .all<{ asset: string; supply: string; divisible: number }>();
  const stmts = rows.results.map((r) =>
    env.DB.prepare(`UPDATE assets SET supply_normalized=? WHERE asset=?`).bind(
      normalize(r.supply, r.divisible === 1),
      r.asset,
    ),
  );
  if (stmts.length) await batch(env.DB, stmts);
}

// XCP is created by burns, not issuances — its supply uses the full fee-aware formula.
async function recomputeXcp(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE assets SET supply = CAST((
        COALESCE((SELECT SUM(CAST(earned AS INTEGER)) FROM burns WHERE status='valid'),0)
      - COALESCE((SELECT SUM(CAST(quantity AS INTEGER)) FROM destructions WHERE status='valid' AND asset='XCP'),0)
      - COALESCE((SELECT SUM(CAST(fee_paid AS INTEGER)) FROM issuances WHERE status='valid'),0)
      - COALESCE((SELECT SUM(CAST(fee_paid AS INTEGER)) FROM dividends WHERE status='valid'),0)
      - COALESCE((SELECT SUM(CAST(fee_paid AS INTEGER)) FROM sweeps WHERE status='valid'),0)
      ) AS TEXT) WHERE asset='XCP'`,
  ).run();
  await normalizePass(env, "asset='XCP'", []);
}

export async function crawlAssetSupply(env: Env): Promise<Record<string, unknown>> {
  // ---- BACKFILL phase: stepped full recompute over all assets ----
  if ((await getState(env.DB, "asset_supply_done")) !== "1") {
    const cursor = parseInt((await getState(env.DB, "asset_supply_cursor")) || "0", 10);
    const top = await env.DB.prepare(
      `SELECT MAX(rid) m FROM (SELECT rowid rid FROM assets WHERE rowid > ? ORDER BY rowid LIMIT ?)`,
    )
      .bind(cursor, BACKFILL_BATCH)
      .first<{ m: number | null }>();
    if (top?.m == null) {
      await setState(env.DB, "asset_supply_done", "1");
      await recomputeXcp(env);
      return { phase: "backfill", complete: true };
    }
    const hi = top.m;
    await env.DB.prepare(`UPDATE assets SET supply = ${SUPPLY_EXPR} WHERE rowid > ? AND rowid <= ? AND asset!='XCP'`)
      .bind(cursor, hi)
      .run();
    await normalizePass(env, "rowid > ? AND rowid <= ? AND asset!='XCP'", [cursor, hi]);
    await setState(env.DB, "asset_supply_cursor", String(hi));
    return { phase: "backfill", from: cursor, to: hi };
  }

  // ---- MAINTENANCE phase: dirty queue + tip-gated global derivations ----
  // Cron runs every 2 minutes while Bitcoin changes roughly every 10. XCP/fairminter/pool state can only
  // change with a mirrored block, so do not rescan their full histories five times at the same tip.
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const derivedDue = parseInt((await getState(env.DB, "asset_derived_tip")) || "-1", 10) < tip;
  if (derivedDue) await recomputeXcp(env);
  const queue = await getIndexerStateStringArray(env.DB, "asset_supply_queue");
  const todo = queue.slice(0, DIRTY_PER_RUN).filter((a) => a && a !== "XCP");
  let recomputed = 0;
  if (todo.length) {
    const ph = todo.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE assets SET supply = ${SUPPLY_EXPR} WHERE asset IN (${ph})`)
      .bind(...todo)
      .run();
    await normalizePass(env, `asset IN (${ph})`, todo);
    recomputed = todo.length;
  }
  await setState(env.DB, "asset_supply_queue", JSON.stringify(queue.slice(DIRTY_PER_RUN)));

  const fm = derivedDue
    ? await refreshFairminters(env).catch((e) => ({ error: String(e).slice(0, 80) }))
    : { skipped: true };
  const pl = derivedDue ? await refreshPools(env).catch((e) => ({ error: String(e).slice(0, 80) })) : { skipped: true };
  if (derivedDue && !("error" in fm) && !("error" in pl)) await setState(env.DB, "asset_derived_tip", String(tip));
  return {
    phase: "maintenance",
    recomputed,
    queue_remaining: Math.max(0, queue.length - DIRTY_PER_RUN),
    fairminters: fm,
    pools: pl,
  };
}

// Fairminter running totals = Σ over that fairminter's valid fairmints (deterministic, from our ledger).
async function refreshFairminters(env: Env): Promise<{ updated: number }> {
  const r = await env.DB.prepare(
    `UPDATE fairminters SET
       earned_quantity = CAST(COALESCE((SELECT SUM(CAST(f.earn_quantity AS INTEGER)) FROM fairmints f WHERE f.fairminter_tx_hash=fairminters.tx_hash AND f.status='valid'),0) AS TEXT),
       paid_quantity   = CAST(COALESCE((SELECT SUM(CAST(f.paid_quantity AS INTEGER)) FROM fairmints f WHERE f.fairminter_tx_hash=fairminters.tx_hash AND f.status='valid'),0) AS TEXT)`,
  ).run();
  return { updated: r.meta.changes ?? 0 };
}

// Pools: lp_supply = the LP token's own supply; price = spot reserve ratio (asset_b per asset_a).
async function refreshPools(env: Env): Promise<{ updated: number }> {
  const r = await env.DB.prepare(
    `UPDATE pools SET
       lp_supply = (SELECT supply FROM assets WHERE assets.asset = pools.lp_asset),
       price = CASE WHEN CAST(reserve_a AS REAL) > 0 THEN CAST(reserve_b AS REAL) / CAST(reserve_a AS REAL) ELSE NULL END`,
  ).run();
  return { updated: r.meta.changes ?? 0 };
}
