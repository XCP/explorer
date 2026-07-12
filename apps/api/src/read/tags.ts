/**
 * Tag/collection score surface — aggregate asset & address scores per tag (the derivative "tag scores"
 * layer: collection scoreboards, cohort stats). Handlers stay thin: they own the score COMPOSITION
 * (the same raw expr the asset-validation endpoint uses) and the raw→tier/percentile mapping, then defer
 * every SQL statement to queries/tags.ts. Parallel to read/assets.ts's /v2/featured + /v2/reputation/asset-*.
 */
import type { TagStatsRow, TagDetail } from "@xcp/shared/tags";
import { router, J, lim, off, round, cached } from "#api/read/respond";
import {
  rawSqlExpr,
  ASSET_FACTORS,
  CONVICTION_FACTORS,
  assetScore,
  assetTier,
  convictionScore,
  type MarketState,
} from "#api/reputation/score";
import { ASSET_PENALTY } from "#api/reputation/config";
import { listTagStats, getTagStats, listTagAssetMembers, type TagStatsBase } from "#api/queries/tags";

export const tags = router();

// The composed asset-quality RAW expression — identical to /v2/reputation/asset-validation and /v2/featured
// (rawSqlExpr(ASSET_FACTORS) minus the flat low_quality penalty), so a tag's aggregate ranks on the exact
// same scale as a single asset's score. `low_quality` resolves against asset_signals in the query context.
const ASSET_RAW = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
// The Conviction RAW expression (who holds it + scarcity, no market inputs) — the community-strength axis the
// aggregate rolls up per collection. The query zeroes it for low_quality members (mirrors scoreConviction).
const CONV_RAW = rawSqlExpr(CONVICTION_FACTORS, 0);

// Enrich the aggregate with the headline tier + 0-100 scores derived from the median/mean raws (the single
// source of truth for raw→tier/percentile lives in reputation/score, so it's applied here, not in the web).
function enrich(r: TagStatsBase): TagStatsRow {
  return {
    ...r,
    median_score: r.median_raw != null ? assetScore(r.median_raw) : null,
    median_tier: r.median_raw != null ? assetTier(r.median_raw, "market") : null,
    conviction_score: r.avg_conviction != null ? convictionScore(r.avg_conviction) : null,
  };
}

// GET /v2/tags — every distinct tag with its population aggregate. A pure population read (no per-entity
// key), so it gets a daily D1 cache aligned with the daily full tag/signal self-heal. D1 Insights measured
// this population aggregation at ~8.5m rows / 14s; refreshing it hourly recomputed unchanged source data.
tags.get("/v2/tags", async (c) =>
  cached(c, "tags:all", { ttl: 86400, edge: 300, swr: 86400 }, async () => ({
    result: (await listTagStats(c.env.DB, ASSET_RAW, CONV_RAW)).map(enrich),
  })),
);

// GET /v2/tags/:tag — the aggregate header + a page of asset members (each with a server-computed tier +
// percentile score). Standard envelope with null-terminated next_offset; the aggregate repeats per page.
tags.get("/v2/tags/:tag", async (c) => {
  const tag = c.req.param("tag");
  const stats = await getTagStats(c.env.DB, ASSET_RAW, CONV_RAW, tag);
  if (!stats) return c.json({ error: "Tag not found" }, 404);
  const limit = lim(c),
    offset = off(c);
  const rows = await listTagAssetMembers(c.env.DB, ASSET_RAW, tag, limit, offset);
  const members = rows.map((r) => {
    // market state mirrors the asset-detail handler: ever traded/dispensed → ranked; held-only → Untraded; none → Dormant.
    const state: MarketState =
      (r.trades ?? 0) > 0 || (r.dispenses ?? 0) > 0 ? "market" : (r.holders ?? 0) > 0 ? "held" : "none";
    return {
      asset: r.asset,
      asset_longname: r.asset_longname,
      holders: r.holders,
      buyers: r.buyers,
      max_realized_usd: r.max_realized_usd,
      raw: round(r.raw, 2),
      score: state === "market" ? assetScore(r.raw) : null,
      tier: assetTier(r.raw, state, r.low_quality === 1),
      low_quality: r.low_quality,
    };
  });
  const body: TagDetail = { ...enrich(stats), members };
  return J(c, { result: body, next_offset: rows.length === limit ? offset + limit : null }, 300);
});
