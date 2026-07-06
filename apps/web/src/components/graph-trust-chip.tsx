"use client";
import useSWR from "swr";
import type { GraphEntityScore } from "@xcp/shared/graph";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api";

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
    <span title="Graph reputation: reachable from the curated trust circle (Min-k-PPR over on-chain relations)"
      className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300 ring-1 ring-inset ring-sky-500/30">
      graph-trusted
    </span>
  ) : (
    <span title="Graph reputation: sits in a known scam/low-quality issuer neighborhood (Anti-TrustRank)"
      className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/30">
      graph-distrusted
    </span>
  );
}
