/**
 * Graph-reputation read surface (Phase C) — the standalone Min-k-PPR trust trait. See docs/graph-reputation.md.
 *
 * Serves PLAIN JSON shapes (no @xcp/shared wire types yet — those land in a later wave; the shapes below are
 * the contract to formalize then):
 *   GET /v2/reputation/graph            -> { result: GraphOverview }   (tier distribution incl. the zero-coverage
 *                                          fraction, + top-20 trusted/distrusted addresses AND assets). cached 600.
 *   GET /v2/addresses/:address/graph       -> { result: { trust, distrust, tier } }  (60s)
 *   GET /v2/assets/:asset/graph         -> { result: { trust, distrust, tier } }  (60s)
 * `tier` is the pure graphTier() classifier (trusted / distrusted / unscored — never a continuum).
 */
import type { GraphSubgraph } from "@xcp/shared/graph";
import { router, cached, J } from "#api/read/respond";
import { graphOverview, graphScore, graphCuts } from "#api/queries/graph";
import { addressEgo, assetHolders } from "#api/queries/graph-extract";
import { graphTier } from "#api/indexer/graph-core";

export const graph = router();

// Bounded, renderable sub-graphs for the viz experiment. limit clamps the node budget so a hub can't return
// its whole neighbourhood. GET /v2/graph/address/:a (ego-network) · /v2/graph/asset/:a (holder star).
const clampLimit = (v: string | undefined, def: number, max: number) =>
  Math.min(Math.max(parseInt(v || "", 10) || def, 1), max);

graph.get("/v2/graph/address/:address", async (c) => {
  const address = c.req.param("address");
  const { nodes, edges, stats } = await addressEgo(c.env.CORE_DB, address, clampLimit(c.req.query("limit"), 60, 200));
  return J(c, { result: { center: address, scope: "address-ego", nodes, edges, stats } as GraphSubgraph }, 120);
});

graph.get("/v2/graph/asset/:asset", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const { nodes, edges, stats } = await assetHolders(c.env.CORE_DB, asset, clampLimit(c.req.query("limit"), 80, 300));
  return J(c, { result: { center: asset, scope: "asset-holders", nodes, edges, stats } as GraphSubgraph }, 120);
});

graph.get("/v2/reputation/graph", (c) =>
  cached(c, "reputation_graph", { ttl: 600, edge: 120 }, async () => ({ result: await graphOverview(c.env.CORE_DB) })),
);

graph.get("/v2/addresses/:address/graph", async (c) => {
  const [s, cuts] = await Promise.all([
    graphScore(c.env.CORE_DB, "address", c.req.param("address")),
    graphCuts(c.env.CORE_DB),
  ]);
  const trust = s?.trust ?? 0,
    distrust = s?.distrust ?? 0;
  return J(c, { result: { trust, distrust, tier: graphTier(trust, distrust, cuts.address) } }, 60);
});

graph.get("/v2/assets/:asset/graph", async (c) => {
  const [s, cuts] = await Promise.all([
    graphScore(c.env.CORE_DB, "asset", c.req.param("asset")),
    graphCuts(c.env.CORE_DB),
  ]);
  const trust = s?.trust ?? 0,
    distrust = s?.distrust ?? 0;
  return J(c, { result: { trust, distrust, tier: graphTier(trust, distrust, cuts.asset) } }, 60);
});
