import type { ReactNode } from "react";

/**
 * The contextual band under the global chrome (v3 direction, design-lab v10/v11): each section —
 * asset, address, block — introduces ITSELF with a robust header while the global header stays
 * simple. Composition: identity row (visual · name+chips · actions), stat strip, tab bar.
 * Server component; interactive bits (watch buttons, live chips) arrive via the slots.
 */
/** Full-bleed breakout: escapes the layout's centered, padded <main> so the band reads as CHROME
 *  (background + border spanning the viewport), not as a card. -mt-4 cancels main's top padding. */
export const FULL_BLEED = "w-screen ml-[calc(50%-50vw)] -mt-4";

export function SectionHeader({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return (
    <div className={`${FULL_BLEED} bg-[#0c0c0e] ${flush ? "" : "border-b border-zinc-800"}`}>
      <div className={`mx-auto max-w-6xl px-4 pt-[18px] ${flush ? "pb-0" : "pb-5"}`}>{children}</div>
    </div>
  );
}

/** The band's chip language: uppercase mono pills, tinted border + wash. One family, one look. */
const CHIP_VARIANTS = {
  grail: "text-amber-300 border-amber-700/60 bg-amber-900/15",
  trusted: "text-sky-300 border-sky-700/60 bg-sky-900/15",
  locked: "text-red-300 border-red-800/60 bg-red-900/15",
  open: "text-green-300 border-green-800/60 bg-green-900/15",
  og: "text-violet-300 border-violet-700/60 bg-violet-900/15",
  neutral: "text-zinc-300 border-zinc-700 bg-zinc-800/30",
} as const;

export function SectionChip({ variant = "neutral", children }: { variant?: keyof typeof CHIP_VARIANTS; children: ReactNode }) {
  return (
    <span className={`rounded-full border px-2.5 py-px font-mono text-[11px] font-semibold uppercase tracking-wide ${CHIP_VARIANTS[variant]}`}>
      {children}
    </span>
  );
}

export function SectionIdentity({ visual, name, chips, actions, compact = false }: {
  visual?: ReactNode;
  name: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  /** Smaller h1 (16px) for long mono identifiers — addresses, tx hashes — vs the 22px display name. */
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      {visual}
      <div className="min-w-0">
        <h1 className={`break-all font-mono text-zinc-100 ${compact ? "text-base font-semibold" : "text-[22px] font-bold"}`}>{name}</h1>
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
          className={`shrink-0 border-zinc-900 px-4 first:pl-0 sm:px-[22px] ${i < stats.length - 1 ? "border-r" : ""} ${s.hideOnMobile ? "hidden sm:block" : ""}`}
        >
          <div className="whitespace-nowrap text-[11px] uppercase tracking-wider text-zinc-400">{s.label}</div>
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
            label === active ? "border-(--color-accent) !text-zinc-100" : "border-transparent !text-zinc-400 hover:!text-zinc-100"
          }`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
