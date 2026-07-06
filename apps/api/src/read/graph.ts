/**
 * Graph-reputation read surface (Phase C) — the standalone Min-k-PPR trust trait. See docs/graph-reputation.md.
 *
 * Serves PLAIN JSON shapes (no @xcp/shared wire types yet — those land in a later wave; the shapes below are
 * the contract to formalize then):
 *   GET /v2/reputation/graph            -> { result: GraphOverview }   (tier distribution incl. the zero-coverage
 *                                          fraction, + top-20 trusted/distrusted addresses AND assets). cached 600.
 *   GET /v2/addresses/:addr/graph       -> { result: { trust, distrust, tier } }  (60s)
 *   GET /v2/assets/:asset/graph         -> { result: { trust, distrust, tier } }  (60s)
 * `tier` is the pure graphTier() classifier (trusted / distrusted / unscored — never a continuum).
 */
import { router, cached, J } from "./respond";
import { graphOverview, graphScore, graphCuts } from "../queries/graph";
import { graphTier } from "../indexer/graph-core";

export const graph = router();

graph.get("/v2/reputation/graph", (c) =>
  cached(c, "reputation_graph", { ttl: 600, edge: 120 }, async () => ({ result: await graphOverview(c.env.DB) })));

graph.get("/v2/addresses/:addr/graph", async (c) => {
  const [s, cuts] = await Promise.all([
    graphScore(c.env.DB, "address_signals", "addr", c.req.param("addr")),
    graphCuts(c.env.DB),
  ]);
  const trust = s?.trust ?? 0, distrust = s?.distrust ?? 0;
  return J(c, { result: { trust, distrust, tier: graphTier(trust, distrust, cuts.addr) } }, 60);
});

graph.get("/v2/assets/:asset/graph", async (c) => {
  const [s, cuts] = await Promise.all([
    graphScore(c.env.DB, "asset_signals", "asset", c.req.param("asset")),
    graphCuts(c.env.DB),
  ]);
  const trust = s?.trust ?? 0, distrust = s?.distrust ?? 0;
  return J(c, { result: { trust, distrust, tier: graphTier(trust, distrust, cuts.asset) } }, 60);
});
