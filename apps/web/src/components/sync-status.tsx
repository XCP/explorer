"use client";
import { useStats, useMempoolCount } from "@/lib/hooks";
import { commas } from "@/lib/format";

// The explorer's heartbeat — a live sync line in the footer on every page: "Synced to block N · n
// pending" with a pulsing accent-green dot. Client island so the footer itself stays server-rendered.
export function SyncStatus() {
  const { item: stats } = useStats();
  const pending = useMempoolCount();
  const tip = stats?.tip ?? (stats?.indexed_block ? Number(stats.indexed_block) : null);
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span className="size-1.5 rounded-full bg-(--color-up) animate-pulse" aria-hidden="true" />
      {tip != null ? (
        <span>
          Synced to block <span className="font-mono tabular-nums text-zinc-300">{commas(tip)}</span>
          {" · "}
          <span className="font-mono tabular-nums text-zinc-300">{commas(pending)}</span> pending
        </span>
      ) : (
        <span>Connecting to the node…</span>
      )}
    </div>
  );
}
