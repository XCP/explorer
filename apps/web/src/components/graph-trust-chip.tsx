"use client";
import useSWR from "swr";
import type { GraphEntityScore } from "@xcp/shared/graph";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api/url";

/**
 * The graph-reputation trait chip (see apps/api/docs/graph-reputation.md). Tier display rules:
 *  - trusted    -> accent-ringed chip (the seeded trust web reaches this entity meaningfully)
 *  - distrusted -> amber chip (scam-seed neighborhood; amber not red — red is market semantics only)
 *  - unscored   -> renders NOTHING ("no evidence" is not a badge; most entities are unscored)
 */
export function GraphTrustChip({ kind, id }: { kind: "addresses" | "assets"; id: string }) {
  const { data } = useSWR<Envelope<GraphEntityScore>>(apiUrl(`/v2/${kind}/${encodeURIComponent(id)}/graph`));
  const tier = data?.result?.tier;
  if (tier !== "trusted" && tier !== "distrusted") return null;
  return tier === "trusted" ? (
    <span title="Money-flow graph trust" className="chip trusted">TRUSTED</span>
  ) : (
    <span title="Money-flow graph distrust" className="chip distrusted">DISTRUSTED</span>
  );
}
