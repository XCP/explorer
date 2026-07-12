"use client";
import { useState } from "react";
import { useAssets } from "@/lib/hooks";
import { AsyncContent } from "@/components/ui/async-content";
import { SecondaryButton } from "@/components/ui/buttons";
import { RecordTable } from "@/features/records/components/record-table";
import { assetCell, addrCell, blockCell, lockStateCell, type Col, type SortState } from "@/features/records/cells";
import type { AssetIndexRow } from "@xcp/shared/assets";
import { commas } from "@/lib/format";

// The searchable, paginated asset index (v20 grammar). Server-side sort on the browse path (a fixed
// whitelist — created / supply / asset); search keeps relevance order. Client island; the thin
// server page owns the metadata.
const COLS: Col<AssetIndexRow>[] = [
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(160px,1.4fr)",
    sortKey: "asset",
    cell: (r) => assetCell(r.asset, r.asset_longname),
  },
  {
    label: "Description",
    priority: 3,
    w: "minmax(0,1.6fr)",
    cell: (r) => <span className="desc">{r.description || "—"}</span>,
  },
  {
    label: "Supply",
    numeric: true,
    cellClass: "qty",
    priority: 1,
    w: "130px",
    sortKey: "supply",
    cell: (r) => commas(r.supply_normalized),
  },
  { label: "Issuer", priority: 2, w: "minmax(120px,1fr)", cell: (r) => addrCell(r.issuer) },
  {
    label: "Created",
    numeric: true,
    priority: 2,
    w: "96px",
    sortKey: "created",
    cell: (r) => blockCell(r.last_issuance_block_index),
  },
  { label: "Supply lock", priority: 2, w: "104px", cell: (r) => lockStateCell(r.locked) },
];

export function AssetIndex() {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState | undefined>(undefined);
  const searching = query.trim().length > 0;
  const { rows, nextOffset, error, isLoading } = useAssets(query || undefined, offset, 50, sort?.key, sort?.dir);

  // tri-state: desc → asc → default; sorting resets pagination. Search suppresses sort (relevance wins).
  const onSort = (k: string) => {
    setOffset(0);
    setSort((s) => (s?.key !== k ? { key: k, dir: "desc" } : s.dir === "desc" ? { key: k, dir: "asc" } : undefined));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="pagehead">
        <h1>Assets</h1>
      </div>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOffset(0);
        }}
        placeholder="Filter assets…"
        aria-label="Filter assets by name"
        autoComplete="off"
        spellCheck={false}
        className="w-full max-w-sm rounded-md border border-[#262a33] bg-[#101216] px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-(--color-accent)"
      />
      <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat="assets">
        <RecordTable
          cols={COLS}
          rows={rows}
          label="assets"
          sort={searching ? undefined : sort}
          onSort={searching ? undefined : onSort}
        />
        <div className="flex gap-2 mt-1">
          <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Prev
          </SecondaryButton>
          <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>
            Next
          </SecondaryButton>
        </div>
      </AsyncContent>
    </div>
  );
}
