/** Deterministic supply and protocol-derived totals owned entirely by the canonical database. */
import type { Env } from "#api/env";
import { normalize } from "#api/indexer/codec";
import { getCoreState, setCoreState } from "#api/indexer/core-state";

const BACKFILL_BATCH = 2000;
const DIRTY_PER_RUN = 400;
export const SUPPLY_ID_LOOKUP_BATCH = 90;

async function numberQueue(db: D1Database): Promise<number[]> {
  const value = await getCoreState(db, "asset_supply_queue");
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

export async function enqueueCoreSupply(db: D1Database, assets: Iterable<string>): Promise<void> {
  const names = [...new Set(assets)].filter(Boolean);
  if (names.length === 0) return;
  const ids: number[] = [];
  for (let offset = 0; offset < names.length; offset += SUPPLY_ID_LOOKUP_BATCH) {
    const chunk = names.slice(offset, offset + SUPPLY_ID_LOOKUP_BATCH);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .prepare(`SELECT asset_id FROM asset_dictionary WHERE asset IN (${placeholders})`)
      .bind(...chunk)
      .all<{ asset_id: number }>();
    ids.push(...rows.results.map((row) => row.asset_id));
  }
  const queue = await numberQueue(db);
  const merged = [...new Set([...queue, ...ids])];
  await setCoreState(db, "asset_supply_queue", JSON.stringify(merged));
}

const SUPPLY_EXPR = `CAST((
  COALESCE((SELECT SUM(CAST(i.quantity AS INTEGER)) FROM issuances i
    WHERE i.asset_id=assets.asset_id AND i.status='valid'),0)
  - COALESCE((SELECT SUM(CAST(d.quantity AS INTEGER)) FROM destructions d
    WHERE d.asset_id=assets.asset_id AND d.status='valid'),0)
  ) AS TEXT)`;

async function normalizeAssets(db: D1Database, predicate: string, binds: unknown[]): Promise<void> {
  const rows = await db
    .prepare(`SELECT asset_id,supply,divisible FROM assets WHERE ${predicate} AND supply IS NOT NULL`)
    .bind(...binds)
    .all<{ asset_id: number; supply: string; divisible: number }>();
  for (let offset = 0; offset < rows.results.length; offset += 90) {
    await db.batch(
      rows.results
        .slice(offset, offset + 90)
        .map((row) =>
          db
            .prepare(`UPDATE assets SET supply_normalized=? WHERE asset_id=?`)
            .bind(normalize(row.supply, row.divisible === 1), row.asset_id),
        ),
    );
  }
}

async function recomputeXcp(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE assets SET supply=CAST((
        COALESCE((SELECT SUM(CAST(earned AS INTEGER)) FROM burns WHERE status='valid'),0)
        - COALESCE((SELECT SUM(CAST(d.quantity AS INTEGER)) FROM destructions d
          WHERE d.status='valid' AND d.asset_id=assets.asset_id),0)
        - COALESCE((SELECT SUM(CAST(fee_paid AS INTEGER)) FROM issuances WHERE status='valid'),0)
        - COALESCE((SELECT SUM(CAST(fee_paid AS INTEGER)) FROM dividends WHERE status='valid'),0)
        - COALESCE((SELECT SUM(CAST(fee_paid AS INTEGER)) FROM sweeps WHERE status='valid'),0)
      ) AS TEXT)
      WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')`,
    )
    .run();
  await normalizeAssets(db, `asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')`, []);
}

async function refreshFairminters(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE fairminters SET
        earned_quantity=CAST(COALESCE((SELECT SUM(CAST(m.earn_quantity AS INTEGER)) FROM fairmints m
          WHERE m.fairminter_tx_index=fairminters.tx_index AND m.status='valid'),0) AS TEXT),
        paid_quantity=CAST(COALESCE((SELECT SUM(CAST(m.paid_quantity AS INTEGER)) FROM fairmints m
          WHERE m.fairminter_tx_index=fairminters.tx_index AND m.status='valid'),0) AS TEXT)`,
    )
    .run();
  return result.meta.changes ?? 0;
}

async function refreshPools(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE pools SET
        lp_supply=(SELECT asset.supply FROM asset_dictionary dictionary
          JOIN assets asset ON asset.asset_id=dictionary.asset_id WHERE dictionary.asset=pools.lp_asset),
        price=CASE WHEN CAST(reserve_a AS REAL)>0 THEN CAST(reserve_b AS REAL)/CAST(reserve_a AS REAL) END`,
    )
    .run();
  return result.meta.changes ?? 0;
}

export async function crawlAssetSupply(env: Env): Promise<Record<string, unknown>> {
  const db = env.CORE_DB;
  if ((await getCoreState(db, "asset_supply_done")) !== "1") {
    const cursor = Number.parseInt((await getCoreState(db, "asset_supply_cursor")) ?? "0", 10);
    const top = await db
      .prepare(`SELECT MAX(asset_id) top FROM (SELECT asset_id FROM assets WHERE asset_id>? ORDER BY asset_id LIMIT ?)`)
      .bind(cursor, BACKFILL_BATCH)
      .first<{ top: number | null }>();
    if (top?.top == null) {
      await setCoreState(db, "asset_supply_done", 1);
      await recomputeXcp(db);
      return { phase: "backfill", complete: true };
    }
    await db
      .prepare(
        `UPDATE assets SET supply=${SUPPLY_EXPR}
         WHERE asset_id>? AND asset_id<=? AND asset_id<>(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')`,
      )
      .bind(cursor, top.top)
      .run();
    await normalizeAssets(
      db,
      `asset_id>? AND asset_id<=? AND asset_id<>(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')`,
      [cursor, top.top],
    );
    await setCoreState(db, "asset_supply_cursor", top.top);
    return { phase: "backfill", from: cursor, to: top.top };
  }

  const tip = Number((await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
  const derivedDue = Number.parseInt((await getCoreState(db, "asset_derived_tip")) ?? "-1", 10) < tip;
  const queue = await numberQueue(db);
  const todo = queue.slice(0, DIRTY_PER_RUN);
  // D1 caps a statement at ~100 bound variables; an issuance wave can push the dirty queue far past
  // that, so the IN list goes in bounded slices (one oversized statement threw every run, freezing
  // the queue AND the derived recompute below while the queue kept growing).
  for (let index = 0; index < todo.length; index += 90) {
    const chunk = todo.slice(index, index + 90);
    const placeholders = chunk.map(() => "?").join(",");
    await db
      .prepare(`UPDATE assets SET supply=${SUPPLY_EXPR} WHERE asset_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
    await normalizeAssets(db, `asset_id IN (${placeholders})`, chunk);
  }
  await setCoreState(db, "asset_supply_queue", JSON.stringify(queue.slice(DIRTY_PER_RUN)));
  if (derivedDue) {
    await recomputeXcp(db);
    const fairminters = await refreshFairminters(db);
    const pools = await refreshPools(db);
    await setCoreState(db, "asset_derived_tip", tip);
    return {
      phase: "maintenance",
      recomputed: todo.length,
      queue_remaining: Math.max(0, queue.length - todo.length),
      fairminters,
      pools,
    };
  }
  return {
    phase: "maintenance",
    recomputed: todo.length,
    queue_remaining: Math.max(0, queue.length - todo.length),
    derived: "current",
  };
}
