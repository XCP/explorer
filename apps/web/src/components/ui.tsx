// Shared presentational helpers — converged design logic (see DESIGN.md): dark zinc-950 terminal
// (xcpdex family) + xcp brand accent, dense mono tables, Headless-UI-compatible interactions.
import type { ReactNode } from "react";

export const Loading = () => <div className="text-zinc-500 text-sm py-6">Loading…</div>;

// Asset icon from the CDN. Plain <img> on purpose — NOT next/image: these are tiny, immutable,
// already-sized CDN icons, and the optimizer just adds a failure point (cf. the xcpdex _next/image bug).
export const AssetIcon = ({ asset, size = 20 }: { asset: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`https://cdn.xcp.io/img/icon/${encodeURIComponent(asset)}`} alt="" width={size} height={size}
    loading="lazy" className="rounded-sm bg-zinc-800 shrink-0" />
);

// Full asset art (the actual card image) — client component: natural aspect ratio + pixelation for stamps.
export { AssetArt } from "./asset-art";

// Dashboard stat card (xcpdex-style grid) + skeleton loader (vs bare "Loading…").
export const Stat = ({ label, value, icon, sub }: { label: string; value: ReactNode; icon?: ReactNode; sub?: ReactNode }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3.5">
    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
      {icon && <span className="text-[--color-xcp] opacity-80">{icon}</span>}{label}
    </div>
    <div className="text-2xl font-semibold text-zinc-100 font-mono tabular-nums mt-1.5 leading-none">{value ?? "—"}</div>
    {sub && <div className="text-xs text-zinc-500 mt-1.5">{sub}</div>}
  </div>
);
export const Skeleton = ({ rows = 8 }: { rows?: number }) => (
  <div className="space-y-2 py-2">
    {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-6 rounded bg-zinc-900 animate-pulse" />)}
  </div>
);
export const ErrorBox = ({ error }: { error: unknown }) =>
  <div className="text-red-400 text-sm py-6">Error: {String((error as Error)?.message ?? error)}</div>;
export const Empty = ({ what = "results" }: { what?: string }) =>
  <div className="text-zinc-500 text-sm py-6">No {what}.</div>;

export const Card = ({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) => (
  <section className="relative rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
    {title && (
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-4">
        {icon && <span className="text-zinc-500">{icon}</span>}{title}
      </h2>
    )}
    {children}
  </section>
);

// Dependency-free SVG area chart (brand crimson) with date axis — for time-series on the home.
export function AreaChart({ data, height = 200 }: { data: { t: number; v: number }[]; height?: number }) {
  if (data.length < 2) return <div style={{ height }} className="animate-pulse bg-zinc-900 rounded" />;
  const W = 800, H = height, pad = 4, n = data.length;
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
            <stop offset="0%" stopColor="var(--color-xcp)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-xcp)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#xcpArea)" />
        <path d={line} fill="none" stroke="var(--color-xcp)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600 mt-1 font-mono">
        <span>{day(data[0].t)}</span><span className="text-zinc-500">peak {max.toLocaleString()}</span><span>{day(data[n - 1].t)}</span>
      </div>
    </div>
  );
}

// Dependency-free SVG bar sparkline (brand crimson) — for lightweight "pulse" charts on the home.
export function Sparkline({ data, height = 36 }: { data: number[]; height?: number }) {
  if (!data.length) return <div style={{ height }} className="animate-pulse bg-zinc-900 rounded" />;
  const max = Math.max(...data, 1), w = 240, n = data.length, bw = w / n;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      {data.map((v, i) => {
        const bh = Math.max(1, (v / max) * (height - 2));
        return <rect key={i} x={i * bw} y={height - bh} width={Math.max(0.5, bw * 0.7)} height={bh} rx={0.5} className="fill-[--color-xcp]" opacity={0.55} />;
      })}
    </svg>
  );
}

// Dense data table — the xcpdex recipe (sticky header, hover rows, mono numerics handled per-cell).
export type Head = string | { label: string; numeric?: boolean; hide?: string };
export function Table({ head, children }: { head: Head[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="sticky top-0 bg-zinc-950 z-10">
          <tr className="text-zinc-500 border-b border-zinc-800">
            {head.map((h) => {
              const label = typeof h === "string" ? h : h.label;
              const numeric = typeof h === "object" && h.numeric;
              const hide = typeof h === "object" ? h.hide : undefined;
              return <th key={label} className={`font-normal px-3 py-2 ${numeric ? "text-right" : "text-left"} ${hide ?? ""}`}>{label}</th>;
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// Row + cell primitives carry the hover/divider + numeric/mono conventions so pages stay terse.
export const Row = ({ children }: { children: ReactNode }) => (
  <tr className="border-b border-zinc-900 hover:bg-zinc-900 transition-colors">{children}</tr>
);
export const Cell = ({ children, numeric, muted, primary, hide }: { children: ReactNode; numeric?: boolean; muted?: boolean; primary?: boolean; hide?: string }) => (
  <td className={[
    "px-3 py-2",
    numeric ? "text-right font-mono tabular-nums" : "",
    muted ? "text-zinc-500" : numeric ? "text-zinc-300" : "",
    primary ? "text-zinc-100 font-medium" : "",
    hide ?? "",
  ].filter(Boolean).join(" ")}>{children}</td>
);

export const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex gap-3 py-1.5 border-b border-zinc-900 last:border-0">
    <div className="w-44 shrink-0 text-zinc-500">{k}</div>
    <div className="break-all">{v ?? "—"}</div>
  </div>
);

// Lock badge (Catalyst lock pill, recolored for the dark theme).
export const LockBadge = ({ locked }: { locked?: boolean | number }) => (
  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
    locked ? "bg-red-400/10 text-red-400 ring-red-400/20" : "bg-green-400/10 text-green-400 ring-green-400/20"
  }`}>{locked ? "locked" : "open"}</span>
);

// Buttons — xcp brand primary + zinc secondary, with extension-style focus rings.
const btnBase = "inline-flex items-center justify-center rounded font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
export const PrimaryButton = ({ children, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className={`${btnBase} px-4 py-2 bg-[--color-xcp] text-white hover:brightness-110 focus-visible:ring-[--color-xcp] ${className}`}>{children}</button>
);
export const SecondaryButton = ({ children, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className={`${btnBase} px-3 py-1.5 border border-zinc-700 text-zinc-200 hover:bg-zinc-900 focus-visible:ring-zinc-600 ${className}`}>{children}</button>
);
