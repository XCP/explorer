// Card / KV / Stat — the panel + key-value + dashboard-stat surfaces of the xcpdex-family design
// (dark zinc-950 terminal + xcp brand accent). See DESIGN.md.
import type { ReactNode } from "react";

// Dashboard stat card (xcpdex-style grid).
export const Stat = ({ label, value, icon, sub }: { label: string; value: ReactNode; icon?: ReactNode; sub?: ReactNode }) => (
  <div className="rounded-lg border border-[#1a1d24] bg-[#101216] px-4 py-3.5">
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#a3adbc]">
      {icon && <span className="text-(--color-accent) opacity-80">{icon}</span>}{label}
    </div>
    <div className="text-2xl font-semibold text-zinc-100 font-mono tabular-nums mt-1.5 leading-none">{value ?? "—"}</div>
    {sub && <div className="text-xs text-zinc-400 mt-1.5">{sub}</div>}
  </div>
);

export const Card = ({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) => (
  // v19 .card grammar: rounded-lg, --border2, --panel; title is a mono uppercase header with a
  // bottom rule; the body carries the padding. Converges every <Card> call site onto the design.
  <section className="relative rounded-lg border border-[#1a1d24] bg-[#101216]">
    {title && (
      <h2 className="flex items-center gap-1.5 border-b border-[#1a1d24] px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-[#a3adbc]">
        {icon && <span className="text-zinc-400">{icon}</span>}{title}
      </h2>
    )}
    <div className="p-4">{children}</div>
  </section>
);

export const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex gap-3 py-1.5 border-b border-zinc-900 last:border-0">
    <div className="w-44 shrink-0 text-zinc-400">{k}</div>
    <div className="break-all">{v ?? "—"}</div>
  </div>
);
