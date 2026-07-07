"use client";
import { useStats, useMempoolCount } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { commas } from "@/lib/format";

/**
 * The thin data strip above the global header — chain state on the LEFT (sync dot, tip block,
 * mempool), market on the RIGHT (BTC, XCP). Two logical clusters, justified apart; the market
 * cluster drops on mobile where chain state is the one thing worth the pixels.
 */
function Cell({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <span className={`px-3 first:pl-0 ${last ? "" : "border-r border-zinc-900"}`}>{children}</span>
  );
}

function Delta({ chg }: { chg: number | null }) {
  if (chg == null) return null;
  return (
    <span className={chg >= 0 ? "text-(--color-up)" : "text-(--color-down)"}>
      {" "}{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%
    </span>
  );
}

export function StatusStrip() {
  const { item: stats } = useStats();
  const pending = useMempoolCount();
  const { btc, btcChange, xcp, xcpChange } = usePrices();
  const tip = stats?.tip ?? (stats?.indexed_block ? Number(stats.indexed_block) : null);

  return (
    <div className="border-b border-zinc-900 bg-[#0c0c0e] font-mono text-[11px] tabular-nums">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 overflow-hidden whitespace-nowrap px-4 py-1">
        <span className="flex items-center">
          <Cell>
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-(--color-up) align-[1px] motion-safe:animate-pulse" aria-hidden="true" />
            <span className="font-medium text-zinc-300">{tip != null ? "synced" : "connecting…"}</span>
          </Cell>
          {tip != null && (
            <Cell>
              <span className="text-zinc-500">block</span>{" "}
              <span className="font-medium text-zinc-300">{commas(tip)}</span>
            </Cell>
          )}
          <Cell last>
            <span className="text-zinc-500">mempool</span>{" "}
            <span className={`font-medium ${pending > 0 ? "text-amber-400" : "text-zinc-300"}`}>{commas(pending)}</span>
          </Cell>
        </span>
        <span className="hidden items-center md:flex">
          <Cell>
            <span className="text-zinc-500">BTC</span>{" "}
            <span className="font-medium text-zinc-300">{btc != null ? `$${btc.toLocaleString()}` : "—"}</span>
            <Delta chg={btcChange} />
          </Cell>
          <Cell last>
            <span className="text-zinc-500">XCP</span>{" "}
            <span className="font-medium text-zinc-300">{xcp != null ? `$${xcp < 10 ? xcp.toFixed(2) : xcp.toLocaleString()}` : "—"}</span>
            <Delta chg={xcpChange} />
          </Cell>
        </span>
      </div>
    </div>
  );
}
