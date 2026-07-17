"use client";
import { useState } from "react";
import type { TagMemberRow } from "@xcp/shared/tags";
import { useTag } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/features/records/components/record-table";
import { type Col, assetCell } from "@/features/records/cells";
import { commas, compact } from "@/lib/format";

// A tag's asset members, best composed-quality first — each row's tier/score is computed server-side.
// Client island (its own offset pagination); the server page owns the aggregate header + metadata.
const PAGE = 50;
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
    cell: (r) => (r.low_quality === 1 ? "Withheld" : r.rating == null ? "Not rated" : `${r.rating.toFixed(1)} / 10`),
  },
  { label: "Holders", numeric: true, priority: 2, cell: (r) => commas(r.holders) },
  { label: "Buyers", numeric: true, priority: 3, cell: (r) => commas(r.buyers) },
  { label: "Realized USD", numeric: true, priority: 1, cell: (r) => usd(r.max_realized_usd) },
];

export function TagMembers({ tag }: { tag: string }) {
  const [offset, setOffset] = useState(0);
  const { detail, nextOffset, error, isLoading } = useTag(tag, offset, PAGE);
  const rows = detail?.members ?? [];
  return (
    <Card title="Members">
      <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat="asset members">
        <RecordTable cols={COLS} rows={rows} />
        <div className="flex gap-2 mt-4">
          <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Prev
          </SecondaryButton>
          <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>
            Next
          </SecondaryButton>
        </div>
      </AsyncContent>
    </Card>
  );
}
