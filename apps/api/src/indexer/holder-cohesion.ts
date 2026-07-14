/** Interaction density among each asset's largest address holders. */
import type { Env } from "#api/env";

const STRONG_WEIGHT = 1.6;

export async function buildHolderCohesion(
  env: Env,
  after: string,
  limit: number,
): Promise<{ processed: number; next: string | null; sample: unknown[] }> {
  const cursor = Number.parseInt(after, 10) || 0;
  const candidates = await env.CORE_DB.prepare(
    `SELECT signal.asset_id,dictionary.asset FROM asset_signals signal
     JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
     WHERE signal.asset_id>? AND signal.holders BETWEEN 15 AND 800 AND signal.max_realized_usd>0
     ORDER BY signal.asset_id LIMIT ?`,
  )
    .bind(cursor, limit)
    .all<{ asset_id: number; asset: string }>();

  const sample: unknown[] = [];
  for (const candidate of candidates.results) {
    const result = await env.CORE_DB.prepare(
      `WITH holders AS (
         SELECT address_id FROM balances
         WHERE asset_id=? AND address_id IS NOT NULL AND CAST(quantity AS INTEGER)>0
         ORDER BY CAST(quantity AS INTEGER) DESC LIMIT 60
       ), active AS (
         SELECT CAST(value AS INTEGER) generation FROM core_state WHERE key='graph_generation'
       )
       SELECT COUNT(*) edges,
         COALESCE(SUM(CASE WHEN edge.weight>=? THEN 1 ELSE 0 END),0) strong,
         (SELECT COUNT(*) FROM holders) holders
       FROM graph_edges edge,active
       WHERE edge.generation=active.generation
         AND edge.source_entity_id IN (SELECT address_id FROM holders)
         AND edge.destination_entity_id IN (SELECT address_id FROM holders)
         AND edge.source_entity_id<>edge.destination_entity_id`,
    )
      .bind(candidate.asset_id, STRONG_WEIGHT)
      .first<{ edges: number; strong: number; holders: number }>();
    const edges = result?.edges ?? 0;
    const strong = result?.strong ?? 0;
    const cohesion = result?.holders ? Math.round((edges / result.holders) * 100) / 100 : 0;
    await env.CORE_DB.prepare(
      `UPDATE asset_signals SET holder_cohesion=?,cohesion_edges=?,cohesion_strong=? WHERE asset_id=?`,
    )
      .bind(cohesion, edges, strong, candidate.asset_id)
      .run();
    if (sample.length < 4) sample.push({ asset: candidate.asset, cohesion, edges, strong });
  }
  const last = candidates.results.at(-1);
  return { processed: candidates.results.length, next: last ? String(last.asset_id) : null, sample };
}
