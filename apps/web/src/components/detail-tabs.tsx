"use client";
import { useState } from "react";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api";
import { Skeleton, Empty } from "@/components/ui";
import { RecordTable } from "@/components/record-table";
import type { Col } from "@/lib/columns";

export type TabDef = { label: string; path: string; cols: Col[] };

// Tabbed activity panel for detail pages — same look as the index pages (dense table desktop,
// stacked cards mobile). Only the active tab fetches (SWR), so it's cheap.
export function DetailTabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];
  const { data, isLoading } = useSWR<Envelope<any[]>>(apiUrl(tab.path, { limit: 50 }));
  const rows = data?.result ?? [];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap gap-1 border-b border-zinc-800 px-2 pt-2 overflow-x-auto">
        {tabs.map((t, i) => (
          <button key={t.label} onClick={() => setActive(i)}
            className={`whitespace-nowrap px-3 py-2 text-sm rounded-t -mb-px border-b-2 transition-colors ${
              i === active ? "border-[--color-xcp] text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}>{t.label}</button>
        ))}
      </div>
      <div className="p-4">
        {isLoading ? <Skeleton /> : rows.length === 0 ? <Empty what={tab.label.toLowerCase()} /> : <RecordTable cols={tab.cols} rows={rows} />}
      </div>
    </div>
  );
}
