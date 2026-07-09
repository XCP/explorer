/**
 * GET /v2/radar — the "undervalued grail" board. Ranks assets by CONVICTION (who holds it + how scarce,
 * built purely from holder/scarcity/network signals — no market inputs) two ways: `undervalued` (realized
 * value still low — the discovery watchlist) and `buyable` (an open dispenser exists right now — the
 * actionable cut). Thin route over queries/radar.ts; D1-cached (low-cardinality key).
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { RadarPayload } from "@xcp/shared/radar";
import { router, cached } from "./respond";
import { radarUndervalued, radarBuyable } from "../queries/radar";
import { convictionScore } from "../reputation/score";

export const radar = router();

radar.get("/v2/radar", (c) =>
  cached(c, "radar", { ttl: 600, edge: 120 }, async (): Promise<Envelope<RadarPayload>> => {
    const [under, buy] = await Promise.all([
      radarUndervalued(c.env.DB).catch(() => []),
      radarBuyable(c.env.DB).catch(() => []),
    ]);
    // Rows arrive ranked by RAW conviction (SQL); map each raw to the calibrated 0-100 score for display.
    const undervalued = under.map((r) => ({ ...r, conviction: convictionScore(r.conviction) }));
    const buyable = buy.map((r) => ({ ...r, conviction: convictionScore(r.conviction) }));
    return { result: { undervalued, buyable } };
  }));
