"use client";

import useSWR from "swr";
import type { GraphEntityScore } from "@xcp/shared/graph";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api/url";

/** Seeded money-flow network standing. Unscored means no evidence and intentionally renders no badge. */
export function NetworkStandingChip({ kind, id }: { kind: "addresses" | "assets"; id: string }) {
  const { data } = useSWR<Envelope<GraphEntityScore>>(apiUrl(`/v2/${kind}/${encodeURIComponent(id)}/graph`));
  const tier = data?.result?.tier;
  if (tier !== "connected" && tier !== "flagged") return null;
  return tier === "connected" ? (
    <span title="Connected in the seeded money-flow graph" className="chip trusted">
      CONNECTED
    </span>
  ) : (
    <span title="Flagged by reverse scam-seed network standing" className="chip distrusted">
      FLAGGED
    </span>
  );
}
