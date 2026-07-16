/** Current-state Radar/Conviction graph ablation. Descriptive only; performs no writes. */
import type { Env } from "#api/env";
import { q } from "#api/db";
import { CONVICTION_FACTORS } from "#api/reputation/config";
import { rawSqlExpr } from "#api/reputation/score";

const fullConviction = rawSqlExpr(CONVICTION_FACTORS, 0);
const noGraphConviction = rawSqlExpr(
  CONVICTION_FACTORS.filter((factor) => factor.key !== "__graph_trust"),
  0,
);
const baseEligible = `signal.low_quality=0 AND signal.holders>=15
  AND NOT EXISTS (
    SELECT 1 FROM entity_dictionary entity JOIN tags tag ON tag.entity_id=entity.entity_id
    WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tag.tag='numeric'
  )`;

interface AblationRow {
  variant: string;
  rank: number;
  asset: string;
  score: number;
  graph_trust: number;
  graph_distrust: number;
  holders: number;
  market_usd: number;
}

interface PopulationRow {
  base_assets: number;
  graph_admitted: number;
  graph_excluded: number;
  graph_admitted_seeds: number;
}

export function summarizeGraphAblations(rows: AblationRow[]): Record<string, unknown> {
  const variants = new Map<string, AblationRow[]>();
  for (const row of rows) {
    const bucket = variants.get(row.variant) ?? [];
    bucket.push(row);
    variants.set(row.variant, bucket);
  }
  const current = variants.get("current") ?? [];
  const currentRanks = new Map(current.map((row) => [row.asset, row.rank]));
  return Object.fromEntries(
    [...variants].map(([variant, ranked]) => {
      const ranks = new Map(ranked.map((row) => [row.asset, row.rank]));
      const entrants = ranked.filter((row) => !currentRanks.has(row.asset));
      const exits = current.filter((row) => !ranks.has(row.asset));
      const common = ranked.filter((row) => currentRanks.has(row.asset));
      return [
        variant,
        {
          overlap_with_current: common.length,
          mean_absolute_rank_change: common.length
            ? common.reduce((sum, row) => sum + Math.abs(row.rank - currentRanks.get(row.asset)!), 0) / common.length
            : null,
          entrants: entrants.slice(0, 15).map(({ asset, rank, score }) => ({ asset, rank, score })),
          exits: exits.slice(0, 15).map(({ asset, rank, score }) => ({ asset, rank, score })),
          top: ranked.slice(0, 15).map(({ asset, rank, score, holders, market_usd }) => ({
            asset,
            rank,
            score,
            holders,
            market_usd,
          })),
        },
      ];
    }),
  );
}

export async function graphInfluenceEval(env: Env): Promise<Record<string, unknown>> {
  const population = await env.CORE_DB.prepare(
    `WITH active(generation) AS (
       SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_generation'
     ),base AS (
       SELECT signal.*,entity.entity_id FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
       WHERE ${baseEligible}
     )
     SELECT COUNT(*) base_assets,SUM(graph_trust>graph_distrust) graph_admitted,
       SUM(graph_trust<=graph_distrust) graph_excluded,
       SUM(graph_trust>graph_distrust AND EXISTS(
         SELECT 1 FROM graph_seed seed,active
         WHERE seed.generation=active.generation AND seed.entity_id=base.entity_id AND seed.slot<3
       )) graph_admitted_seeds
     FROM base`,
  ).first<PopulationRow>();

  const rows = await q<AblationRow>(
    env.CORE_DB,
    `WITH base AS MATERIALIZED (
       SELECT dictionary.asset,(${fullConviction}) full_score,(${noGraphConviction}) no_graph_score,
         signal.graph_trust,signal.graph_distrust,signal.holders,
         COALESCE(signal.max_realized_usd,0) market_usd
       FROM asset_signals signal JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       WHERE ${baseEligible} AND COALESCE(signal.max_realized_usd,0)<500
     ),variant AS (
       SELECT 'current' variant,asset,full_score score,graph_trust,graph_distrust,holders,market_usd
         FROM base WHERE graph_trust>graph_distrust
       UNION ALL
       SELECT 'no_gate',asset,full_score,graph_trust,graph_distrust,holders,market_usd FROM base
       UNION ALL
       SELECT 'no_factor',asset,no_graph_score,graph_trust,graph_distrust,holders,market_usd
         FROM base WHERE graph_trust>graph_distrust
       UNION ALL
       SELECT 'no_graph',asset,no_graph_score,graph_trust,graph_distrust,holders,market_usd FROM base
     ),ranked AS (
       SELECT variant,asset,ROUND(score,4) score,graph_trust,graph_distrust,holders,market_usd,
         ROW_NUMBER() OVER(PARTITION BY variant ORDER BY score DESC,asset) rank
       FROM variant
     )
     SELECT * FROM ranked WHERE rank<=40 ORDER BY variant,rank`,
  );
  return {
    methodology: {
      population: "non-low-quality, non-numeric assets with at least 15 holders",
      market_ceiling_usd: 500,
      variants: {
        current: "graph gate and graph Conviction factor",
        no_gate: "graph factor retained; graph gate removed",
        no_factor: "graph gate retained; graph factor removed",
        no_graph: "both graph gate and graph factor removed",
      },
      warning: "current-state ranking ablation; not a historical causal or predictive evaluation",
    },
    population: population ?? {},
    comparisons: summarizeGraphAblations(rows),
  };
}
