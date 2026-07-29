/**
 * Tag/collection score surface — aggregate asset & address scores per tag (the derivative "tag scores"
 * layer: collection scoreboards, cohort stats). Handlers stay thin: they own the score COMPOSITION
 * (the same raw expr the asset-validation endpoint uses) and the raw→tier/percentile mapping, then defer
 * every SQL statement to queries/tags.ts. Parallel to read/assets.ts's /v2/featured + /v2/reputation/asset-*.
 */
import type { TagStatsRow, TagDetail } from "@xcp/shared/tags";
import { router, J, lim, off, cached } from "#api/read/respond";
import { rawSqlExpr, CONVICTION_FACTORS, convictionScore } from "#api/reputation/score";
import { listTagStats, getTagStats, listTagAssetMembers, type TagStatsBase } from "#api/queries/tags";
import { collectionHolderMakeup, getCollectionProfile, listCollectionProfiles } from "#api/queries/collections";

export const tags = router();

// The Conviction RAW expression (who holds it + scarcity, no market inputs) — the community-strength axis the
// aggregate rolls up per collection. The query zeroes it for low_quality members (mirrors scoreConviction).
const CONV_RAW = rawSqlExpr(CONVICTION_FACTORS, 0);

tags.get("/v2/collections", async (c) =>
  cached(c, "collections:profiles:v3", { ttl: 86400, edge: 300, swr: 86400 }, async () => ({
    result: await listCollectionProfiles(c.env.CORE_DB),
  })),
);

tags.get("/v2/collection-profiles/:tag", async (c) => {
  const tag = c.req.param("tag");
  const result = await getCollectionProfile(c.env.CORE_DB, tag);
  return result ? J(c, { result }, 300) : c.json({ error: "Collection not found" }, 404);
});

// Who HOLDS the collection, by global persona — the H3 persona-mix lens. The classification walks every
// holder of every member (~1.3s cold on the largest collection), and a holder base drifts slowly, so a
// 6-hour D1 cache with a day of stale-while-revalidate keeps the page instant without a builder table.
tags.get("/v2/collection-profiles/:tag/holder-makeup", async (c) => {
  const tag = c.req.param("tag");
  return cached(c, `collections:holder-makeup:v1:${tag}`, { ttl: 21600, edge: 600, swr: 86400 }, async () => ({
    result: await collectionHolderMakeup(c.env.CORE_DB, tag),
  }));
});

function enrich(r: TagStatsBase): TagStatsRow {
  return {
    ...r,
    conviction_score: r.avg_conviction != null ? convictionScore(r.avg_conviction) : null,
  };
}

// GET /v2/tags — every distinct tag with its population aggregate. A pure population read (no per-entity
// key), so it gets a daily D1 cache aligned with the daily full tag/signal self-heal. D1 Insights measured
// this population aggregation at ~8.5m rows / 14s; refreshing it hourly recomputed unchanged source data.
tags.get("/v2/tags", async (c) =>
  cached(c, "tags:all", { ttl: 86400, edge: 300, swr: 86400 }, async () => ({
    result: (await listTagStats(c.env.CORE_DB, CONV_RAW)).map(enrich),
  })),
);

// GET /v2/tags/:tag — the aggregate header + a page of asset members (each with a server-computed tier +
// percentile score). Standard envelope with null-terminated next_offset; the aggregate repeats per page.
tags.get("/v2/tags/:tag", async (c) => {
  const tag = c.req.param("tag");
  const stats = await getTagStats(c.env.CORE_DB, CONV_RAW, tag);
  if (!stats) return c.json({ error: "Tag not found" }, 404);
  // Cap 1000: collection pages fetch a whole membership in one page so client-side sorting and the
  // card view operate on the full set, not a 50-row window. Protocol-family tags still paginate.
  const limit = lim(c, 50, 1000),
    offset = off(c);
  const rows = await listTagAssetMembers(c.env.CORE_DB, tag, limit, offset);
  const body: TagDetail = { ...enrich(stats), members: rows };
  return J(c, { result: body, next_offset: rows.length === limit ? offset + limit : null }, 300);
});
