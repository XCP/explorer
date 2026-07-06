// Card / KV / Stat — the panel + key-value + dashboard-stat surfaces of the xcpdex-family design
// (dark zinc-950 terminal + xcp brand accent). See DESIGN.md.
import type { ReactNode } from "react";

// Dashboard stat card (xcpdex-style grid).
export const Stat = ({ label, value, icon, sub }: { label: string; value: ReactNode; icon?: ReactNode; sub?: ReactNode }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3.5">
    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
      {icon && <span className="text-[--color-accent] opacity-80">{icon}</span>}{label}
    </div>
    <div className="text-2xl font-semibold text-zinc-100 font-mono tabular-nums mt-1.5 leading-none">{value ?? "—"}</div>
    {sub && <div className="text-xs text-zinc-400 mt-1.5">{sub}</div>}
  </div>
);

export const Card = ({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) => (
  <section className="relative rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
    {title && (
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-4">
        {icon && <span className="text-zinc-400">{icon}</span>}{title}
      </h2>
    )}
    {children}
  </section>
);

export const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex gap-3 py-1.5 border-b border-zinc-900 last:border-0">
    <div className="w-44 shrink-0 text-zinc-400">{k}</div>
    <div className="break-all">{v ?? "—"}</div>
  </div>
);
