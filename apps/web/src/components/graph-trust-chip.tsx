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
      className="inline-flex items-center rounded-full border border-sky-700/60 bg-sky-900/15 px-2.5 py-px font-mono text-[11px] font-semibold uppercase tracking-wide text-sky-300">
      graph-trusted
    </span>
  ) : (
    <span title="Graph reputation: sits in a known scam/low-quality issuer neighborhood (Anti-TrustRank)"
      className="inline-flex items-center rounded-full border border-amber-700/60 bg-amber-900/15 px-2.5 py-px font-mono text-[11px] font-semibold uppercase tracking-wide text-amber-300">
      graph-distrusted
    </span>
  );
}
