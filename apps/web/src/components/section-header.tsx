import type { ReactNode } from "react";

/**
 * The contextual band under the global chrome (v3 direction, design-lab v10/v11): each section —
 * asset, address, block — introduces ITSELF with a robust header while the global header stays
 * simple. Composition: identity row (visual · name+chips · actions), stat strip, tab bar.
 * Server component; interactive bits (watch buttons, live chips) arrive via the slots.
 */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-zinc-800 bg-[#0c0c0e]">
      <div className="mx-auto max-w-6xl px-4 pt-5">{children}</div>
    </div>
  );
}

export function SectionIdentity({ visual, name, chips, actions }: {
  visual?: ReactNode;
  name: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      {visual}
      <div className="min-w-0">
        <h1 className="break-all font-mono text-[22px] font-bold text-zinc-100">{name}</h1>
        {chips && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{chips}</div>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** One entry in the stat strip. `hideOnMobile` caps the strip on small screens (no ragged wrap). */
export type SectionStat = { label: string; value: ReactNode; detail?: ReactNode; hideOnMobile?: boolean };

export function SectionStats({ stats }: { stats: SectionStat[] }) {
  return (
    <div className="mt-4 flex overflow-x-auto font-mono tabular-nums">
      {stats.map((s, i) => (
        <div
          key={i}
          className={`shrink-0 border-zinc-900 px-4 first:pl-0 sm:px-5 ${i < stats.length - 1 ? "border-r" : ""} ${s.hideOnMobile ? "hidden sm:block" : ""}`}
        >
          <div className="whitespace-nowrap text-[11px] uppercase tracking-wider text-zinc-500">{s.label}</div>
          <div className="mt-0.5 whitespace-nowrap text-[17px] font-semibold text-zinc-100">
            {s.value}
            {s.detail && <span className="ml-1.5 text-[11px] font-normal text-zinc-400">{s.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The section's own tab bar — plain links; the active tab is the caller's business. */
export function SectionTabs({ tabs, active }: { tabs: [label: string, href: string][]; active: string }) {
  return (
    <nav aria-label="Section" className="mt-3.5 flex gap-0.5 overflow-x-auto">
      {tabs.map(([label, href]) => (
        <a
          key={href}
          href={href}
          aria-current={label === active ? "page" : undefined}
          className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium !no-underline ${
            label === active ? "border-[--color-accent] !text-zinc-100" : "border-transparent !text-zinc-400 hover:!text-zinc-100"
          }`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
