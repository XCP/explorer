"use client";
import Link from "next/link";
import { useState } from "react";
import type { TagMemberRow } from "@xcp/shared/tags";
import { useTag } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";
import { ScoreBadge } from "@/components/ui/score-badge";
import { AssetIcon } from "@/components/ui/badges";
import { type Col } from "@/lib/cells";
import { commas, compact } from "@/lib/format";

// A tag's asset members, best composed-quality first — each row's tier/score is computed server-side.
// Client island (its own offset pagination); the server page owns the aggregate header + metadata.
const PAGE = 50;
const usd = (v: number) => (v > 0 ? `$${compact(v)}` : "—");

const COLS: Col<TagMemberRow>[] = [
  { label: "Asset", weight: "primary", cell: (r) => (
    <Link href={`/asset/${r.asset}`} className="inline-flex items-center gap-2 min-w-0">
      <AssetIcon asset={r.asset} size={16} /><span className="truncate">{r.asset_longname || r.asset}</span>
    </Link>
  ) },
  { label: "Score", cell: (r) => <ScoreBadge tier={r.tier} score={r.score} flagged={r.low_quality === 1} /> },
  { label: "Holders", numeric: true, cell: (r) => commas(r.holders) },
  { label: "Buyers", numeric: true, hideBelow: "sm", cell: (r) => commas(r.buyers) },
  { label: "Realized USD", numeric: true, cell: (r) => usd(r.max_realized_usd) },
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
          <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</SecondaryButton>
          <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
        </div>
      </AsyncContent>
    </Card>
  );
}
