"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Skeleton } from "@/components/ui/feedback";
import { AsyncContent } from "@/components/ui/async-content";
import { SecondaryButton } from "@/components/ui/buttons";
import { RecordTable } from "@/components/record-table";
import type { Col, RecordContext } from "@/lib/cells";
import { useStats } from "@/lib/hooks";

/** A tab is either a record feed (path + columns + optional mono count) or a self-contained panel
 *  (e.g. the asset Related tab) that mounts only while selected. */
export type TabDef =
  | { label: string; path: string; cols: Col[]; count?: number | null }
  | { label: string; panel: ReactNode };

// SSR renders client components too; useLayoutEffect on the server is a dev warning, so fall back.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The v19 tab-bar overflow: measure the bar after fonts settle and on every resize; when the row
 * overflows, re-measure leaving room for the More trigger and move the tail into the .more-menu.
 * React translation of v19-banner.html's layout() — same two-pass measure, same +2px gap, same
 * `|| 80` More-width fallback — with DOM moves replaced by state (`overflowStart`).
 */
function useTabOverflow(tabCount: number) {
  const barRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [overflowStart, setOverflowStart] = useState(-1); // -1 = everything fits (no More)
  const [measureTick, setMeasureTick] = useState(0);
  // reset to the all-in-bar state, then re-measure (pre-paint, so no visible flash)
  const requestLayout = useCallback(() => { setOverflowStart(-1); setMeasureTick((t) => t + 1); }, []);

  useIsomorphicLayoutEffect(() => {
    if (overflowStart !== -1) return; // only the all-in-bar state measures
    const bar = barRef.current, more = moreRef.current;
    if (!bar || !more) return;
    more.style.display = "none";
    const avail = bar.clientWidth;
    const widths = itemRefs.current.slice(0, tabCount).map((el) => (el ? el.offsetWidth : 0));
    let used = 0, start = -1;
    for (let i = 0; i < widths.length; i++) {
      used += widths[i] + 2;
      if (used > avail) { start = i; break; }
    }
    if (start === -1) return; // everything fits, no More
    // re-measure with More visible: it takes room too
    more.style.display = "";
    const moreW = more.offsetWidth || 80;
    used = 0;
    for (let j = 0; j < widths.length; j++) {
      used += widths[j] + 2;
      if (used > avail - moreW) { start = j; break; }
    }
    setOverflowStart(start);
  }, [overflowStart, measureTick, tabCount]);

  // v19's triggers: run after fonts settle so widths are true (+ the 300ms safety pass), and on resize.
  useEffect(() => {
    if (document.fonts?.ready) document.fonts.ready.then(requestLayout);
    const safety = setTimeout(requestLayout, 300);
    const ro = new ResizeObserver(requestLayout);
    if (barRef.current) ro.observe(barRef.current);
    return () => { clearTimeout(safety); ro.disconnect(); };
  }, [requestLayout]);

  return { barRef, itemRefs, moreRef, overflowStart, requestLayout };
}

// Tabbed activity panel for detail pages, v19 markup (.tabs / .count / .more / .more-menu). Only the
// active tab fetches (SWR), so it's cheap. Offset Prev/Next pagination mirrors IndexPage; the offset
// resets to 0 whenever the active tab changes.
//
// `overview` (optional) prepends an "Overview" tab at index 0 whose panel renders the node BARE —
// no card wrapper; the overview content brings its own cards. Works with server-rendered nodes:
// the RSC page passes the ReactNode across the client boundary as a prop.
// `banner` (optional, inBand only) renders between the tab-bar band and the panel — the v19
// contextual band slot; it shows ONLY while the Overview tab is active (current === null).
// `context` is the page subject (asset/address) — RecordTable suppresses the columns the page
// already answers and signs quantities from the subject's perspective (R4).
export function DetailTabs({ tabs, pageSize = 50, inBand = false, overview, banner, context }: {
  tabs: TabDef[]; pageSize?: number; inBand?: boolean; overview?: ReactNode; banner?: ReactNode; context?: RecordContext;
}) {
  const hasOverview = overview != null;
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);
  // null = the Overview entry; everything else is a TabDef
  const entries: (TabDef | null)[] = [...(hasOverview ? [null] : []), ...tabs];
  const current = entries[active] ?? null;
  const feed = current && "path" in current ? current : null;
  const { data, isLoading } = useSWR<Envelope<unknown[]>>(feed ? apiUrl(feed.path, { limit: pageSize, offset }) : null);
  const tip = useStats().item?.tip;
  const rows = data?.result ?? [];
  const nextOffset = data?.next_offset;
  const select = (i: number) => { setActive(i); setOffset(0); };

  const { barRef, itemRefs, moreRef, overflowStart, requestLayout } = useTabOverflow(entries.length);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, moreRef]);

  const visibleCount = overflowStart === -1 ? entries.length : overflowStart;
  const activeInMenu = overflowStart !== -1 && active >= overflowStart;

  const tabLink = (i: number, inMenu: boolean) => {
    const entry = entries[i];
    const label = entry === null ? "Overview" : entry.label;
    const count = entry && "path" in entry && entry.count != null ? entry.count : null;
    return (
      <a key={label} href="#"
        ref={inMenu ? undefined : (el) => { itemRefs.current[i] = el; }}
        className={i === active ? "active" : undefined}
        aria-current={i === active ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          select(i);
          if (inMenu) { setMenuOpen(false); requestLayout(); }
        }}>
        {label}{count != null && <> <span className="count">{count.toLocaleString()}</span></>}
      </a>
    );
  };

  const bar = (
    <nav className="tabs" aria-label="Section" ref={barRef}>
      {entries.map((_, i) => (i < visibleCount ? tabLink(i, false) : null))}
      <div className={`more${menuOpen ? " open" : ""}`} ref={moreRef}
        style={overflowStart === -1 ? { display: "none" } : undefined}>
        <a href="#" aria-haspopup="true" aria-expanded={menuOpen}
          className={activeInMenu ? "active" : undefined}
          onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}>
          More <span className="chev">▾</span>
        </a>
        <div className="more-menu" role="menu">
          {entries.map((_, i) => (i >= visibleCount ? tabLink(i, true) : null))}
        </div>
      </div>
    </nav>
  );

  // Feed panels render the dense v19 .xtable directly (it brings its own card chrome). The page
  // context travels with the current offset so rank columns can count from it; the chain tip feeds
  // lifetime cells (order Expires) — same SWR key as the footer heartbeat, so it's deduped.
  const feedPanel = feed && (
    <AsyncContent isLoading={isLoading} empty={rows.length === 0} emptyWhat={feed.label.toLowerCase()} loading={<Skeleton />}>
      <RecordTable cols={feed.cols} rows={rows} context={{ ...context, tip: tip ?? undefined, offset }} />
      <div className="flex gap-2">
        <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Prev</SecondaryButton>
        <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
      </div>
    </AsyncContent>
  );
  const panelBody = current === null ? overview : "panel" in current ? current.panel : feedPanel;

  // inBand: the tab bar CONTINUES the section-header band (same .section-head chrome; the band's
  // bottom border lives here) while the panel stays in the page flow below. flow-root keeps the
  // .tabs 14px top margin inside the band (no margin collapse leaking page background between bands).
  if (inBand) {
    return (
      <>
        <div className="section-head flow-root w-screen ml-[calc(50%-50vw)] !mt-0">
          <div className="sh-in" style={{ paddingTop: 0, paddingBottom: 0 }}>{bar}</div>
        </div>
        {current === null && banner}
        <div className="panel">{panelBody}</div>
      </>
    );
  }

  return (
    <div className="card">
      {bar}
      <div className="panel" style={{ padding: 14 }}>{panelBody}</div>
    </div>
  );
}
