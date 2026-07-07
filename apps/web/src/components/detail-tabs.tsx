"use client";
import { useState } from "react";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api";
import { Skeleton } from "@/components/ui/feedback";
import { AsyncContent } from "@/components/ui/async-content";
import { SecondaryButton } from "@/components/ui/buttons";
import { RecordTable } from "@/components/record-table";
import type { Col } from "@/lib/cells";

export type TabDef = { label: string; path: string; cols: Col[] };

// Tabbed activity panel for detail pages — same look as the index pages (dense table desktop,
// stacked cards mobile). Only the active tab fetches (SWR), so it's cheap. Offset Prev/Next
// pagination mirrors IndexPage; the offset resets to 0 whenever the active tab changes.
export function DetailTabs({ tabs, pageSize = 50, inBand = false }: { tabs: TabDef[]; pageSize?: number; inBand?: boolean }) {
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);
  const tab = tabs[active];
  const { data, isLoading } = useSWR<Envelope<unknown[]>>(apiUrl(tab.path, { limit: pageSize, offset }));
  const rows = data?.result ?? [];
  const nextOffset = data?.next_offset;
  const select = (i: number) => { setActive(i); setOffset(0); };

  // inBand: the tab bar CONTINUES the section-header band (same full-bleed bg; the band's bottom
  // border lives here) while the data panel stays a normal card in the page flow below.
  const bar = (
    <div className={`flex flex-wrap overflow-x-auto ${inBand ? "gap-0.5" : "gap-1 border-b border-zinc-800 px-2 pt-2"}`}>
      {tabs.map((t, i) => (
        <button key={t.label} onClick={() => select(i)}
          className={`whitespace-nowrap px-3.5 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
            i === active ? "border-[--color-accent] text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}>{t.label}</button>
      ))}
    </div>
  );

  const panel = (
    <AsyncContent isLoading={isLoading} empty={rows.length === 0} emptyWhat={tab.label.toLowerCase()} loading={<Skeleton />}>
      <RecordTable cols={tab.cols} rows={rows} />
      <div className="flex gap-2 mt-4">
        <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Prev</SecondaryButton>
        <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
      </div>
    </AsyncContent>
  );

  if (inBand) {
    return (
      <>
        <div className="w-screen ml-[calc(50%-50vw)] !mt-0 border-b border-zinc-800 bg-[#0c0c0e]">
          <div className="mx-auto max-w-6xl px-4 pt-[14px]">{bar}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">{panel}</div>
      </>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      {bar}
      <div className="p-4">{panel}</div>
    </div>
  );
}
