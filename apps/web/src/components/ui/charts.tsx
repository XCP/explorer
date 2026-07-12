// Dependency-free SVG charts (sky accent) for the home/stats time-series. Charts are drawn in accent,
// never brand/market red — a red activity chart reads as an incident.

// Area chart with a date axis — for daily time-series.
export function AreaChart({ data, height = 200 }: { data: { t: number; v: number }[]; height?: number }) {
  if (data.length < 2) return <div style={{ height }} className="animate-pulse bg-zinc-900 rounded" />;
  const W = 800,
    H = height,
    pad = 4,
    n = data.length;
  const max = Math.max(...data.map((d) => d.v), 1);
  const X = (i: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = data.map((d, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(d.v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="xcpArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#xcpArea)" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
        <span>{day(data[0].t)}</span>
        <span className="text-zinc-400">peak {max.toLocaleString()}</span>
        <span>{day(data[n - 1].t)}</span>
      </div>
    </div>
  );
}
