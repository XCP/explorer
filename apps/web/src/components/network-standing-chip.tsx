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
    <span
      title="Connected to selected regions of the money-flow graph; this is relationship evidence, not verification"
      className="chip trusted"
    >
      CONNECTED
    </span>
  ) : (
    <span
      title="Proximate to selected risk seeds in the reverse money-flow graph; review the relationship evidence"
      className="chip distrusted"
    >
      FLAGGED
    </span>
  );
}
