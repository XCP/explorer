/**
 * GET /v2/radar — the "undervalued grail" board. Ranks assets by CONVICTION (who holds it + how scarce,
 * built purely from holder/scarcity/network signals — no market inputs) two ways: `undervalued` (realized
 * value still low — the discovery watchlist) and `buyable` (an open dispenser exists right now — the
 * actionable cut). Thin route over queries/radar.ts; D1-cached (low-cardinality key).
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { AssetEmergencePayload, EmergenceEvidence, RadarPayload } from "@xcp/shared/radar";
import { router, cached } from "#api/read/respond";
import { radarUndervalued, radarBuyable } from "#api/queries/radar";
import { listEmergingAssets, listFreshAssets } from "#api/queries/asset-emergence";
import { convictionScore } from "#api/reputation/score";

export const radar = router();

const explain = <T extends Omit<EmergenceEvidence, "reason">>(row: T): T & { reason: string } => {
  const market = `${row.buyers} buyer${row.buyers === 1 ? "" : "s"} across ${row.active_days} active day${row.active_days === 1 ? "" : "s"}`;
  const primary = row.minters
    ? `; ${row.minters} Fairminter${row.minters === 1 ? "" : "s"}${row.paid_minters ? ` (${row.paid_minters} XCP-priced)` : ""}`
    : "";
  return { ...row, reason: `${market}${primary}` };
};

radar.get("/v2/radar/emergence", (c) =>
  cached(c, "radar:emergence", { ttl: 600, edge: 120 }, async (): Promise<{ result: AssetEmergencePayload }> => {
    const observedAt = Math.floor(Date.now() / 1000);
    const [fresh, emerging] = await Promise.all([
      listFreshAssets(c.env.CORE_DB, observedAt),
      listEmergingAssets(c.env.CORE_DB, observedAt),
    ]);
    return {
      result: {
        model: "new-radar-2026-07",
        observed_at: observedAt,
        fresh: fresh.map(explain),
        emerging: emerging.map(explain),
      },
    };
  }),
);

radar.get("/v2/radar", (c) =>
  cached(c, "radar:conviction", { ttl: 600, edge: 120 }, async (): Promise<Envelope<RadarPayload>> => {
    const [under, buy] = await Promise.all([radarUndervalued(c.env.CORE_DB), radarBuyable(c.env.CORE_DB)]);
    // Rows arrive ranked by RAW conviction (SQL); map each raw to the calibrated 0-100 score for display.
    const undervalued = under.map((r) => ({ ...r, conviction: convictionScore(r.conviction) }));
    const buyable = buy.map((r) => ({ ...r, conviction: convictionScore(r.conviction) }));
    return { result: { undervalued, buyable } };
  }),
);
