/**
 * Tag-score queries — the SQL behind the tag-scores surface (population aggregate + per-tag members).
 * Like queries/assets.ts, the config-driven raw-quality SQL (`expr`, from rawSqlExpr − the low_quality
 * penalty) is passed IN by the handler; this file never imports the reputation config. Score/tier mapping
 * (assetScore/assetTier) is applied in the handler — the query returns the raw and the state inputs.
 *
 * Aggregate math mirrors queries/assets.ts assetValidation: median via a per-tag window rank over the
 * asset members that have a signals row (nulls excluded from the rank so the middle index is exact).
 */
import type { TagStatsRow, TagMemberRow } from "@xcp/shared/tags";
import { q, one } from "#api/db";

/** The aggregate stats a query produces; the handler enriches with median_score/median_tier. */
export type TagStatsBase = Omit<TagStatsRow, "median_score" | "median_tier" | "conviction_score">;

// Shared aggregate SQL: `mem` = one row per (tag, entity); `asset_mem` = its asset members joined to
// signals (drops assets without a signals row so the median rank is over real, scored members only).
// `whereTag` scopes to one tag (population when false). `expr` = quality raw; `convExpr` = Conviction raw
// (the community/scarcity axis) — both resolve against asset_signals `s` (unqualified in rawSqlExpr; the
// `mem` CTE shares no column names with it). Beyond quality, we roll the per-asset community signals we
// already compute (Conviction, holder DEX-sophistication, creator-held %) UP to the collection, plus the
// collection's meta ({collection, site}) — so a tag reads as a COMMUNITY, not just a bag of cards.
const AGG = (expr: string, convExpr: string, whereTag: boolean) => `
  WITH mem AS (
    SELECT t.tag, e.entity_type, e.entity_key, t.entity_id, t.source, t.meta
    FROM tags t JOIN entity_dictionary e ON e.entity_id=t.entity_id
    ${whereTag ? "WHERE t.tag=?" : ""}
  ),
  asset_mem AS (
    SELECT m.tag, (${expr}) raw,
      (CASE WHEN s.low_quality=1 THEN 0 ELSE (${convExpr}) END) conv,
      s.avg_holder_dex holder_dex, s.pct_creator_holders creator_pct,
      s.low_quality, s.max_realized_usd, s.holders
    FROM mem m
    JOIN asset_dictionary d ON m.entity_type='asset' AND d.asset=m.entity_key
    JOIN asset_signals s ON s.asset_id=d.asset_id
  ),
  ranked AS (
    SELECT tag, raw, ROW_NUMBER() OVER (PARTITION BY tag ORDER BY raw) rn, COUNT(*) OVER (PARTITION BY tag) cnt
    FROM asset_mem
  ),
  med AS (
    SELECT tag, ROUND(AVG(CASE WHEN rn IN ((cnt+1)/2, (cnt/2)+1) THEN raw END), 2) median_raw FROM ranked GROUP BY tag
  ),
  astat AS (
    SELECT tag, COUNT(*) n_assets, ROUND(AVG(raw), 2) mean_raw,
      ROUND(AVG(conv), 2) avg_conviction, ROUND(AVG(holder_dex), 1) avg_holder_dex, ROUND(AVG(creator_pct)) avg_creator_pct,
      ROUND(100.0*SUM(low_quality)/COUNT(*), 1) pct_low_quality,
      ROUND(SUM(COALESCE(max_realized_usd, 0)), 2) total_realized_usd, SUM(COALESCE(holders, 0)) total_holders
    FROM asset_mem GROUP BY tag
  ),
  cnt AS (
    SELECT tag, MIN(entity_type) entity_type, MIN(source) source, MIN(meta) meta, COUNT(*) n,
      SUM(CASE WHEN entity_type='address' THEN 1 ELSE 0 END) n_addresses
    FROM mem GROUP BY tag
  )
  SELECT c.tag, c.entity_type, c.source, c.meta, c.n, COALESCE(a.n_assets, 0) n_assets, c.n_addresses,
    a.mean_raw, m.median_raw, a.avg_conviction, a.avg_holder_dex, a.avg_creator_pct, a.pct_low_quality,
    COALESCE(a.total_realized_usd, 0) total_realized_usd, COALESCE(a.total_holders, 0) total_holders
  FROM cnt c LEFT JOIN astat a ON a.tag=c.tag LEFT JOIN med m ON m.tag=c.tag`;

/** Population aggregate over EVERY distinct tag (asset + address). `expr`/`convExpr` = config-driven SQL. */
export function listTagStats(db: D1Database, expr: string, convExpr: string): Promise<TagStatsBase[]> {
  return q<TagStatsBase>(db, `${AGG(expr, convExpr, false)} ORDER BY c.tag`);
}

/** The aggregate row for a single tag (same math, scoped to one tag). Null when the tag doesn't exist. */
export function getTagStats(db: D1Database, expr: string, convExpr: string, tag: string): Promise<TagStatsBase | null> {
  return one<TagStatsBase>(db, AGG(expr, convExpr, true), tag);
}

/** Internal member row: the wire fields plus the state inputs (trades/dispenses) the handler needs to
 *  derive market state → tier. Only asset members exist (the JOIN yields nothing for address tags). */
export type TagMemberQueryRow = Omit<TagMemberRow, "score" | "tier"> & { trades: number; dispenses: number };

/** A page of a tag's asset members, best composed-quality first. `expr` = config-driven raw-quality SQL. */
export function listTagAssetMembers(
  db: D1Database,
  expr: string,
  tag: string,
  limit: number,
  offset: number,
): Promise<TagMemberQueryRow[]> {
  return q<TagMemberQueryRow>(
    db,
    `WITH s AS (
       SELECT d.asset, a.asset_longname, signal.*
       FROM tags t
       JOIN entity_dictionary e ON e.entity_id=t.entity_id AND e.entity_type='asset'
       JOIN asset_dictionary d ON d.asset=e.entity_key
       JOIN assets a ON a.asset_id=d.asset_id
       JOIN asset_signals signal ON signal.asset_id=d.asset_id
       WHERE t.tag=?
     )
     SELECT s.asset, s.asset_longname, s.holders,
            (COALESCE(s.distinct_traders,0)+COALESCE(s.distinct_dispense_buyers,0)) buyers,
            ROUND(COALESCE(s.max_realized_usd,0), 2) max_realized_usd, ROUND((${expr}), 2) raw,
            s.trades, s.dispenses, COALESCE(s.low_quality,0) low_quality
     FROM s ORDER BY (${expr}) DESC, s.asset LIMIT ? OFFSET ?`,
    tag,
    limit,
    offset,
  );
}
