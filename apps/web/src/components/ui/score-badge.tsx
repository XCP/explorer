// Unified tier-first display for Asset Rating and Address Reputation.
// NEVER red/green — those are market semantics only. Used on the tag-score pages (collections + /tag).
//
// FLAGGED (low_quality) rule: a low_quality asset is hard-CAPPED to the Speculative tier regardless of its
// raw/0-100 score (e.g. OXBT reads Speculative even though its percentile is high). Showing "Speculative 97"
// would present the suppressed number as if it were the ranking — dishonest. So when `flagged` is set, the
// number is dropped and replaced by a muted "flagged" affordance: the tier word leads, the score never shows.
// Pass flagged from the entity's low_quality (AssetQuality.low_quality / TagMemberRow.low_quality).

// Ranked tiers get progressively brighter; the elite carry the sky accent ring. Anything not listed
// (Untraded/Dormant/Exchange/Vault/Burn/… and any address non-ranked state) falls to QUIET.
const RAMP: Record<string, string> = {
  Bluechip: "text-zinc-100 ring-(--color-accent)/40 bg-(--color-accent)/10",
  Exceptional: "text-zinc-100 ring-(--color-accent)/40 bg-(--color-accent)/10",
  Strong: "text-zinc-200 ring-zinc-500/50 bg-zinc-800",
  Premium: "text-zinc-200 ring-zinc-500/50 bg-zinc-800", // asset rating (≈ address Established)
  Established: "text-zinc-200 ring-zinc-500/50 bg-zinc-800",
  Notable: "text-zinc-300 ring-zinc-600/60 bg-zinc-800/60", // asset rating (≈ address Active)
  Speculative: "text-zinc-400 ring-zinc-700 bg-zinc-900/60",
  Limited: "text-zinc-400 ring-zinc-700 bg-zinc-900/60",
};
const QUIET = "text-zinc-500 ring-zinc-800 bg-zinc-900/40";

export function ScoreBadge({
  tier,
  score,
  flagged = false,
  className = "",
}: {
  tier: string;
  score?: number | null;
  flagged?: boolean;
  className?: string;
}) {
  const ramp = RAMP[tier] ?? QUIET;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ramp} ${className}`}
    >
      <span>{tier}</span>
      {flagged ? (
        <span
          className="text-[10px] uppercase tracking-wide text-zinc-500"
          title="Flagged low-quality — capped to Speculative; score suppressed"
        >
          flagged
        </span>
      ) : (
        score != null && <span className="font-mono tabular-nums opacity-80">{score}</span>
      )}
    </span>
  );
}
