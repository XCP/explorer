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
export function DetailTabs({ tabs, pageSize = 50 }: { tabs: TabDef[]; pageSize?: number }) {
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);
  const tab = tabs[active];
  const { data, isLoading } = useSWR<Envelope<unknown[]>>(apiUrl(tab.path, { limit: pageSize, offset }));
  const rows = data?.result ?? [];
  const nextOffset = data?.next_offset;
  const select = (i: number) => { setActive(i); setOffset(0); };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap gap-1 border-b border-zinc-800 px-2 pt-2 overflow-x-auto">
        {tabs.map((t, i) => (
          <button key={t.label} onClick={() => select(i)}
            className={`whitespace-nowrap px-3 py-2 text-sm rounded-t -mb-px border-b-2 transition-colors ${
              i === active ? "border-[--color-xcp] text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}>{t.label}</button>
        ))}
      </div>
      <div className="p-4">
        <AsyncContent isLoading={isLoading} empty={rows.length === 0} emptyWhat={tab.label.toLowerCase()} loading={<Skeleton />}>
          <RecordTable cols={tab.cols} rows={rows} />
          <div className="flex gap-2 mt-4">
            <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Prev</SecondaryButton>
            <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
          </div>
        </AsyncContent>
      </div>
    </div>
  );
}
