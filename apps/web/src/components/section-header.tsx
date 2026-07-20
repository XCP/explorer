import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

/**
 * The section band under the global chrome — v19 design system (design-lab/v19-banner.html): each
 * section — asset, address, block — introduces ITSELF with a robust header while the global header
 * stays simple. Composition: identity row (.sh-top: visual · name+chips · actions), stat strip
 * (.sh-stats), and — when `flush` — the tab bar band that continues it (DetailTabs inBand).
 * Server component; interactive bits (copy buttons, live chips) arrive via the slots.
 */
/** Full-bleed breakout: escapes the layout's centered, padded <main> so the band reads as CHROME
 *  (background + border spanning the viewport), not as a card. -mt-4 cancels main's top padding. */
export const FULL_BLEED = "w-screen ml-[calc(50%-50vw)] -mt-4";

export function SectionHeader({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  // `flush`: the tab bar continues the band directly below and carries the bottom border instead. It must
  // sit FLUSH — `!mb-0` cancels <main>'s space-y-6 (Tailwind v4 emits it as margin-bottom on non-last
  // children), which would otherwise open a 24px page-background stripe between the stats and the tabs.
  return (
    <div
      className={`section-head ${FULL_BLEED}${flush ? " !mb-0" : ""}`}
      style={flush ? { borderBottom: "none" } : undefined}
    >
      <div className="sh-in" style={flush ? undefined : { paddingBottom: 18 }}>
        {children}
      </div>
    </div>
  );
}

/** The band's chip language — v19's .chip family (uppercase mono pills, tinted border + wash).
 *  grail/trusted/locked come from the lab file; open/og/neutral are app extensions in globals.css. */
export type SectionChipVariant = "grail" | "trusted" | "locked" | "open" | "og" | "neutral" | "collection";

export function SectionChip({
  variant = "neutral",
  href,
  children,
}: {
  variant?: SectionChipVariant;
  href?: Route;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className={`chip ${variant}`}>
        {children}
      </Link>
    );
  }
  return <span className={`chip ${variant}`}>{children}</span>;
}

export function SectionIdentity({
  visual,
  name,
  chips,
  actions,
  compact = false,
}: {
  visual?: ReactNode;
  name: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  /** Smaller h1 (16px) for long mono identifiers — addresses, tx hashes — vs the 22px display name. */
  compact?: boolean;
}) {
  return (
    <div className="sh-top">
      {visual}
      <div className="min-w-0">
        <h1 className="sh-name break-all" style={compact ? { fontSize: 16, fontWeight: 600 } : undefined}>
          {name}
        </h1>
        {chips && (
          <div className="chips" style={{ marginTop: 5 }}>
            {chips}
          </div>
        )}
      </div>
      {actions && <div className="sh-actions">{actions}</div>}
    </div>
  );
}

/** One entry in the stat strip. `hideOnMobile` caps the strip on small screens (v19 .mobile-hide). */
export type SectionStat = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hideOnMobile?: boolean;
  href?: string;
};

export function SectionStats({ stats }: { stats: SectionStat[] }) {
  return (
    <div className="sh-stats mono">
      {stats.map((s, i) => (
        <div key={i} className={`sh-stat${s.hideOnMobile ? " mobile-hide" : ""}`}>
          <div className="l">{s.label}</div>
          <div className="v">
            {s.href ? <Link href={s.href as Route}>{s.value}</Link> : s.value}
            {s.detail != null && (
              <>
                {" "}
                <small>{s.detail}</small>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
