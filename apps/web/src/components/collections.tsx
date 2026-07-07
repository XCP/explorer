"use client";
import Link from "next/link";
import type { TagStatsRow } from "@xcp/shared/tags";
import { useTags } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";
import { ScoreBadge } from "@/components/ui/score-badge";
import { type Col } from "@/lib/cells";
import { commas, compact } from "@/lib/format";

// The collection scoreboard — curated/collection/protocol asset tags (Rare Pepe, Fake Rare, grails, stamp
// families …) ranked by the MEDIAN composed-quality of their members. The population read (/v2/tags)
// carries every tag; we keep the collection-shaped ones with a real membership (n≥3) and sort by median.
const SCOREBOARD_SOURCES = new Set(["collection", "curated", "protocol"]);
const isScoreboard = (t: TagStatsRow) =>
  t.entity_type === "asset" && t.n_assets >= 3 && SCOREBOARD_SOURCES.has(t.source);

const usd = (v: number) => (v > 0 ? `$${compact(v)}` : "—");

const COLS: Col<TagStatsRow>[] = [
  { label: "Tag", weight: "primary", priority: 1, cell: (r) => <Link href={`/tag/${encodeURIComponent(r.tag)}`} className="font-medium">{r.tag}</Link> },
  { label: "Members", numeric: true, priority: 2, w: "90px", cell: (r) => commas(r.n_assets) },
  { label: "Median score", priority: 1, w: "130px", cell: (r) => (r.median_tier ? <ScoreBadge tier={r.median_tier} score={r.median_score} /> : "—") },
  { label: "% low-quality", numeric: true, priority: 3, cell: (r) => (r.pct_low_quality != null ? `${r.pct_low_quality}%` : "—") },
  { label: "Realized USD", numeric: true, priority: 1, cell: (r) => usd(r.total_realized_usd) },
  { label: "Holders", numeric: true, priority: 4, cell: (r) => commas(r.total_holders) },
];

export function Collections() {
  const { rows, error, isLoading } = useTags();
  const board = rows
    .filter(isScoreboard)
    .sort((a, b) => (b.median_raw ?? -Infinity) - (a.median_raw ?? -Infinity));
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Collections</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Curated series and protocol families, scored as a group. Median is the composed-quality tier of a
          typical member — real demand, realized value, durability — not price. Ranked by that median.
        </p>
      </div>
      <Card>
        <AsyncContent isLoading={isLoading} error={error} empty={board.length === 0} emptyWhat="collections">
          <RecordTable cols={COLS} rows={board} />
        </AsyncContent>
      </Card>
    </>
  );
}
