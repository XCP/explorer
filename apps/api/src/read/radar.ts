/** Established holder Conviction, current availability, and early market formation. */
import type { Envelope } from "@xcp/shared/envelope";
import type { AssetEmergencePayload, EmergenceEvidence, RadarPayload } from "@xcp/shared/radar";
import { router, cached } from "#api/read/respond";
import { radarAvailable, radarEstablished } from "#api/queries/radar";
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
  cached(c, "radar:established", { ttl: 600, edge: 120 }, async (): Promise<Envelope<RadarPayload>> => {
    const [establishedRows, availableRows] = await Promise.all([
      radarEstablished(c.env.CORE_DB),
      radarAvailable(c.env.CORE_DB),
    ]);
    const established = establishedRows.map((row) => ({ ...row, conviction: convictionScore(row.conviction) }));
    const available = availableRows.map((row) => ({ ...row, conviction: convictionScore(row.conviction) }));
    return { result: { established, available } };
  }),
);
