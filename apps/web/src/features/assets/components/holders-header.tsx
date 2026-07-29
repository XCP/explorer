"use client";
import useSWR from "swr";
import type { BalanceRow } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { commas } from "@/lib/format";

/**
 * The holders tab header: concentration at a glance (top 10 / 11–30 / 31–50 / the rest, as shares
 * of supply) plus the holder base over time, reconstructed from the credit/debit ledger. The
 * distribution reuses the table's own first page (same SWR key → one request); the sparkline has
 * its own six-hour-cached endpoint.
 */
const BANDS = [
  { label: "Top 10", to: 10, color: "bg-fuchsia-400" },
  { label: "11–30", to: 30, color: "bg-fuchsia-700" },
  { label: "31–50", to: 50, color: "bg-zinc-500" },
] as const;

function Sparkline({ points }: { points: { day: number; holders: number }[] }) {
  if (points.length < 2) return null;
  const width = 560;
  const height = 56;
  const min = Math.min(...points.map((p) => p.holders));
  const max = Math.max(...points.map((p) => p.holders));
  const span = Math.max(1, max - min);
  const step = width / (points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 4 - ((p.holders - min) / span) * (height - 8)).toFixed(1)}`,
    )
    .join("");
  const first = points[0];
  const last = points[points.length - 1];
  const year = (d: { day: number }) => new Date(d.day * 86400 * 1000).getUTCFullYear();
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-zinc-400">Holders over time</span>
        <span className="font-mono text-xs text-zinc-500">
          {commas(min)}–{commas(max)}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-14 w-full" preserveAspectRatio="none" aria-hidden>
        <path
          d={path}
          fill="none"
          stroke="var(--color-xcp, #e11d63)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-zinc-600">
        <span>{year(first)}</span>
        <span>{year(last)}</span>
      </div>
    </div>
  );
}

export function HoldersHeader({
  asset,
  supply,
  holderCount,
}: {
  asset: string;
  supply: number | null;
  holderCount: number | null;
}) {
  const base = `/v2/assets/${encodeURIComponent(asset)}`;
  // Same key as the table's first page — SWR dedupes, so the header costs zero extra requests.
  const { data: page } = useSWR<Envelope<BalanceRow[]>>(apiUrl(`${base}/balances`, { limit: 50, offset: 0 }));
  const { data: history } = useSWR<Envelope<{ day: number; holders: number }[]>>(apiUrl(`${base}/holder-history`));

  const rows = page?.result ?? [];
  const points = history?.result ?? [];
  if (!supply || rows.length === 0) return null;

  const quantities = rows.map((r) => Number(r.quantity_normalized) || 0);
  const shareTo = (n: number) => quantities.slice(0, n).reduce((sum, q) => sum + q, 0) / supply;
  const segments: { label: string; color: string; pct: number }[] = [];
  let previous = 0;
  for (const band of BANDS) {
    if (quantities.length <= (segments.length === 0 ? 0 : BANDS[segments.length - 1].to)) break;
    const cumulative = Math.min(1, shareTo(band.to));
    const pct = Math.max(0, cumulative - previous);
    if (pct > 0) segments.push({ label: band.label, color: band.color, pct });
    previous = cumulative;
  }
  const rest = Math.max(0, 1 - previous);
  if (rest > 0) segments.push({ label: "The rest", color: "bg-zinc-800", pct: rest });

  return (
    <div className="mb-4 flex flex-col gap-5 rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-zinc-400">Distribution of supply</span>
          {holderCount != null ? (
            <span className="font-mono text-xs text-zinc-500">{commas(holderCount)} holders</span>
          ) : null}
        </div>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-zinc-900" aria-label="Supply distribution">
          {segments.map((segment) => (
            <div key={segment.label} className={segment.color} style={{ width: `${100 * segment.pct}%` }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
          {segments.map((segment) => (
            <span key={segment.label} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${segment.color}`} />
              {segment.label} {(100 * segment.pct).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>
      <Sparkline points={points} />
    </div>
  );
}
