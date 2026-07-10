/**
 * Holder cohesion as a stored signal — interaction edges among an asset's top holders ÷ holder count. A wash /
 * sybil / clique ring runs many× an organic asset because the same wallets trade among themselves; an organic
 * crowd sits under ~1. Batch-computed per asset (one COUNT over graph_edges scoped to the top holders) and
 * upserted onto asset_signals so the whole dataset is sortable by it, no graph render needed.
 *
 * Cursored (asset-name) so a driver can walk the candidate set across calls without a per-run timeout.
 */
import type { Env } from "../index";

const inList = (ids: string[]) => ids.filter((s) => /^[a-zA-Z0-9._]+$/.test(s)).map((s) => `'${s}'`).join(",") || "''";
const STRONG_W = 1.6; // ln(1+n) ≥ 1.6 ⇔ ~4+ repeated interactions between the pair

export async function buildHolderCohesion(env: Env, after: string, limit: number): Promise<{ processed: number; next: string | null; sample: unknown[] }> {
  // Candidate = a measurable holder base (15–800) that has TRADED — that's where coordination/wash is meaningful
  // and it keeps the batch tractable (untraded cards don't need a wash signal). Cursor on asset name.
  const cands = (await env.DB.prepare(
    `SELECT asset FROM asset_signals WHERE asset > ? AND holders BETWEEN 15 AND 800 AND COALESCE(max_realized_usd,0) > 0 ORDER BY asset LIMIT ?`
  ).bind(after, limit).all<{ asset: string }>()).results || [];

  const sample: unknown[] = [];
  for (const { asset } of cands) {
    const holders = (await env.DB.prepare(
      `SELECT holder FROM balances WHERE asset=? AND holder_type='address' AND CAST(quantity AS INTEGER)>0 ORDER BY CAST(quantity AS INTEGER) DESC LIMIT 60`
    ).bind(asset).all<{ holder: string }>()).results || [];
    const ids = holders.map((h) => h.holder);
    let cohesion = 0, edges = 0, strong = 0;
    if (ids.length >= 2) {
      const set = inList(ids);
      const e = await env.DB.prepare(
        `SELECT COUNT(*) e, COALESCE(SUM(CASE WHEN w>=${STRONG_W} THEN 1 ELSE 0 END),0) s FROM graph_edges WHERE src IN (${set}) AND dst IN (${set}) AND src<>dst`
      ).first<{ e: number; s: number }>();
      edges = e?.e ?? 0; strong = e?.s ?? 0;
      cohesion = Math.round((edges / ids.length) * 100) / 100;
    }
    await env.DB.prepare(`UPDATE asset_signals SET holder_cohesion=?, cohesion_edges=?, cohesion_strong=? WHERE asset=?`)
      .bind(cohesion, edges, strong, asset).run();
    if (sample.length < 4) sample.push({ asset, cohesion, edges, strong });
  }
  return { processed: cands.length, next: cands.length ? cands[cands.length - 1].asset : null, sample };
}
