"use client";
import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import type { TagMemberRow } from "@xcp/shared/tags";
import { useTag } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/features/records/components/record-table";
import { type Col, type SortState, assetCell } from "@/features/records/cells";
import { AssetArt } from "@/features/assets/components/asset-art";
import { ART_WIDTH } from "@/lib/art";
import { commas, compact } from "@/lib/format";

// A tag's asset members — table AND card views over the same sorted set. One 1000-row page covers
// every collection whole (memorychain 152, rare-pepe 1,037), so sorting reorders the full
// membership client-side; only protocol-family tags (stamp, src20…) ever page. Server default
// order = composed quality, best first.
const PAGE = 1000;
const usd = (v: number) => (v > 0 ? `$${compact(v)}` : "—");

const COLS: Col<TagMemberRow>[] = [
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.4fr)",
    cell: (r) => assetCell(r.asset, r.asset_longname),
  },
  {
    label: "Rating",
    priority: 1,
    w: "130px",
    sortKey: "rating",
    cell: (r) => (r.low_quality === 1 ? "Withheld" : r.rating == null ? "Not rated" : `${r.rating.toFixed(1)} / 10`),
  },
  { label: "Holders", numeric: true, priority: 2, sortKey: "holders", cell: (r) => commas(r.holders) },
  { label: "Buyers", numeric: true, priority: 3, sortKey: "buyers", cell: (r) => commas(r.buyers) },
  { label: "Realized USD", numeric: true, priority: 1, sortKey: "realized", cell: (r) => usd(r.max_realized_usd) },
];

const VALUE: Record<string, (r: TagMemberRow) => number> = {
  rating: (r) => r.rating ?? -1,
  holders: (r) => r.holders,
  buyers: (r) => r.buyers,
  realized: (r) => r.max_realized_usd,
};

export function TagMembers({ tag }: { tag: string }) {
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<"table" | "cards">("table");
  const [sort, setSort] = useState<SortState | undefined>();
  const { detail, nextOffset, error, isLoading } = useTag(tag, offset, PAGE);
  const rows = [...(detail?.members ?? [])];
  if (sort) {
    const value = VALUE[sort.key] ?? VALUE.rating;
    rows.sort((a, b) => (sort.dir === "asc" ? value(a) - value(b) : value(b) - value(a)));
  }
  const onSort = (key: string) =>
    setSort((current) =>
      current?.key !== key ? { key, dir: "desc" } : current.dir === "desc" ? { key, dir: "asc" } : undefined,
    );

  const viewToggle = (
    <div className="flex gap-1" role="tablist" aria-label="Members view">
      {(["table", "cards"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={view === mode}
          onClick={() => setView(mode)}
          className={`rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ring-1 ring-inset transition-colors ${
            view === mode
              ? "bg-white/10 text-zinc-200 ring-white/20"
              : "bg-white/[0.03] text-zinc-500 ring-white/10 hover:text-zinc-300"
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );

  return (
    <Card title="Members" action={viewToggle}>
      <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat="asset members">
        {view === "table" ? (
          <RecordTable cols={COLS} rows={rows} sort={sort} onSort={onSort} />
        ) : (
          <>
            {/* Card sorting rides the same comparator; the sort control lives in the table header, so
                surface a compact chip row here for the same four keys. */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide">
              <span className="text-zinc-600">sort</span>
              {Object.keys(VALUE).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSort(key)}
                  className={`rounded px-2 py-0.5 ring-1 ring-inset transition-colors ${
                    sort?.key === key
                      ? "bg-white/10 text-zinc-200 ring-white/20"
                      : "bg-white/[0.03] text-zinc-500 ring-white/10 hover:text-zinc-300"
                  }`}
                >
                  {key}
                  {sort?.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {rows.map((r) => (
                <Link key={r.asset} className="g-card" href={`/asset/${encodeURIComponent(r.asset)}` as Route}>
                  <div className="g-art">
                    <AssetArt asset={r.asset} w={ART_WIDTH.card} className="size-full" />
                  </div>
                  <div className="g-meta">
                    <div className="g-name">{r.asset_longname || r.asset}</div>
                    <div className="g-why">
                      {r.low_quality === 1
                        ? "Withheld"
                        : r.rating == null
                          ? "Not rated"
                          : `${r.rating.toFixed(1)} / 10`}
                      {r.max_realized_usd > 0 ? ` · ${usd(r.max_realized_usd)}` : ""}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
        {(offset > 0 || nextOffset != null) && (
          <div className="flex gap-2 mt-4">
            <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Prev
            </SecondaryButton>
            <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>
              Next
            </SecondaryButton>
          </div>
        )}
      </AsyncContent>
    </Card>
  );
}
