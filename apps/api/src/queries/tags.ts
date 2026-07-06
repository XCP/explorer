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
import { q, one } from "../db";

/** The aggregate stats a query produces; the handler enriches with median_score/median_tier. */
export type TagStatsBase = Omit<TagStatsRow, "median_score" | "median_tier">;

// Shared aggregate SQL: `mem` = one row per (tag, entity); `asset_mem` = its asset members joined to
// signals (drops assets without a signals row so the median rank is over real, scored members only).
// `{WHERE}` is spliced empty (population) or `WHERE t.tag=?` (single tag). `${expr}` resolves against
// asset_signals `s` (its columns are unqualified in rawSqlExpr; `mem` shares no column names with it).
const AGG = (expr: string, whereTag: boolean) => `
  WITH mem AS (
    SELECT t.tag, t.entity_type, t.entity_id, MIN(t.source) source
    FROM tags t ${whereTag ? "WHERE t.tag=?" : ""}
    GROUP BY t.tag, t.entity_type, t.entity_id
  ),
  asset_mem AS (
    SELECT m.tag, (${expr}) raw, s.low_quality, s.max_realized_usd, s.holders
    FROM mem m JOIN asset_signals s ON m.entity_type='asset' AND s.asset=m.entity_id
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
      ROUND(100.0*SUM(low_quality)/COUNT(*), 1) pct_low_quality,
      ROUND(SUM(COALESCE(max_realized_usd, 0)), 2) total_realized_usd, SUM(COALESCE(holders, 0)) total_holders
    FROM asset_mem GROUP BY tag
  ),
  cnt AS (
    SELECT tag, MIN(entity_type) entity_type, MIN(source) source, COUNT(*) n,
      SUM(CASE WHEN entity_type='address' THEN 1 ELSE 0 END) n_addresses
    FROM mem GROUP BY tag
  )
  SELECT c.tag, c.entity_type, c.source, c.n, COALESCE(a.n_assets, 0) n_assets, c.n_addresses,
    a.mean_raw, m.median_raw, a.pct_low_quality,
    COALESCE(a.total_realized_usd, 0) total_realized_usd, COALESCE(a.total_holders, 0) total_holders
  FROM cnt c LEFT JOIN astat a ON a.tag=c.tag LEFT JOIN med m ON m.tag=c.tag`;

/** Population aggregate over EVERY distinct tag (asset + address). `expr` = config-driven raw-quality SQL. */
export function listTagStats(db: D1Database, expr: string): Promise<TagStatsBase[]> {
  return q<TagStatsBase>(db, `${AGG(expr, false)} ORDER BY c.tag`);
}

/** The aggregate row for a single tag (same math, scoped to one tag). Null when the tag doesn't exist. */
export function getTagStats(db: D1Database, expr: string, tag: string): Promise<TagStatsBase | null> {
  return one<TagStatsBase>(db, AGG(expr, true), tag);
}

/** Internal member row: the wire fields plus the state inputs (trades/dispenses) the handler needs to
 *  derive market state → tier. Only asset members exist (the JOIN yields nothing for address tags). */
export type TagMemberQueryRow = Omit<TagMemberRow, "score" | "tier"> & { trades: number; dispenses: number };

/** A page of a tag's asset members, best composed-quality first. `expr` = config-driven raw-quality SQL. */
export function listTagAssetMembers(
  db: D1Database, expr: string, tag: string, limit: number, offset: number
): Promise<TagMemberQueryRow[]> {
  return q<TagMemberQueryRow>(
    db,
    `SELECT s.asset, s.asset_longname, s.holders,
            (COALESCE(s.distinct_traders,0)+COALESCE(s.distinct_dispense_buyers,0)) buyers,
            ROUND(COALESCE(s.max_realized_usd,0), 2) max_realized_usd, ROUND((${expr}), 2) raw,
            s.trades, s.dispenses, COALESCE(s.low_quality,0) low_quality
     FROM tags t JOIN asset_signals s ON t.entity_type='asset' AND s.asset=t.entity_id
     WHERE t.tag=? ORDER BY (${expr}) DESC LIMIT ? OFFSET ?`,
    tag, limit, offset
  );
}
