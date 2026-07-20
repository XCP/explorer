/**
 * Unified trades/sales read surface — a flat read over the materialized `trades` ledger.
 *   GET /v2/trades                 recent trades across all venues (?venue=, ?asset=, ?currency=)
 *   GET /v2/assets/:asset/trades   one card's full sales history
 *   GET /v2/trades/stats           per-venue counts + totals (for headers/tiles)
 *   GET /v2/trades/ring-candidates reciprocal-pair wash evidence for curation review
 * Standard envelope ({ result, next_offset }); SQL lives in queries/trades.ts.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { RingCandidate, TradeRow, TradeVenueStats } from "@xcp/shared/trades";
import { router, J, cached, lim, off } from "#api/read/respond";
import { listTrades, ringCandidates, tradeVenueStats } from "#api/queries/trades";

export const trades = router();

trades.get("/v2/trades", async (c) => {
  const limit = lim(c, 50, 200);
  const offset = off(c);
  const rows = await listTrades(c.env.CORE_DB, {
    venue: c.req.query("venue"),
    asset: c.req.query("asset"),
    currency: c.req.query("currency"),
    limit,
    offset,
    includeLowQuality: c.req.query("include_low_quality") === "1",
  });
  const body: Envelope<TradeRow[]> = {
    result: rows,
    next_offset: rows.length === limit ? offset + limit : null,
  };
  return J(c, body);
});

trades.get("/v2/assets/:asset/trades", async (c) => {
  const limit = lim(c, 50, 200);
  const offset = off(c);
  const rows = await listTrades(c.env.CORE_DB, {
    asset: c.req.param("asset"),
    limit,
    offset,
    includeLowQuality: c.req.query("include_low_quality") === "1",
  });
  const body: Envelope<TradeRow[]> = {
    result: rows,
    next_offset: rows.length === limit ? offset + limit : null,
  };
  return J(c, body);
});

// Curation review board: assets whose volume concentrates in reciprocal address pairs (wash rings
// the self-fill exclusion cannot see). Read-only evidence for the owner — never feeds any rating.
trades.get("/v2/trades/ring-candidates", (c) =>
  cached(
    c,
    "trades:ring-candidates:2", // bump when a board find gets flagged so it leaves the board promptly
    { ttl: 86_400, edge: 3_600, swr: 604_800 },
    async (): Promise<Envelope<RingCandidate[]>> => ({ result: await ringCandidates(c.env.CORE_DB) }),
  ),
);

// Global aggregation → D1-cached (low-cardinality key, per the cached() contract in respond.ts).
trades.get("/v2/trades/stats", (c) => {
  const includeLowQuality = c.req.query("include_low_quality") === "1";
  return (
    // Lifetime venue aggregates scan the full ledger; hourly freshness is ample beside the live trade feed.
    cached(
      c,
      `trades:stats:${includeLowQuality ? "all" : "clean"}`,
      { ttl: 3600, swr: 86400 },
      async (): Promise<Envelope<TradeVenueStats[]>> => ({
        result: await tradeVenueStats(c.env.CORE_DB, includeLowQuality),
      }),
    )
  );
});
