"use client";
import useSWR from "swr";
import type { GraphEntityScore } from "@xcp/shared/graph";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api/url";

/**
 * Seeded money-flow network-standing chip (see apps/api/docs/graph-reputation.md). Display rules:
 *  - trusted    -> connected to all curated positive-seed subsets
 *  - distrusted -> reverse scam-seed mass dominates; a review flag, not a verdict
 *  - unscored   -> renders NOTHING ("no evidence" is not a badge; most entities are unscored)
 */
export function GraphTrustChip({ kind, id }: { kind: "addresses" | "assets"; id: string }) {
  const { data } = useSWR<Envelope<GraphEntityScore>>(apiUrl(`/v2/${kind}/${encodeURIComponent(id)}/graph`));
  const tier = data?.result?.tier;
  if (tier !== "trusted" && tier !== "distrusted") return null;
  return tier === "trusted" ? (
    <span title="Connected in the seeded money-flow graph" className="chip trusted">
      CONNECTED
    </span>
  ) : (
    <span title="Flagged by reverse scam-seed network standing" className="chip distrusted">
      FLAGGED
    </span>
  );
}
