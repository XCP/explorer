"use client";
import Link from "next/link";
import { useState } from "react";
import type { TagStatsRow } from "@xcp/shared/tags";
import { useTags } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";
import { ScoreBadge } from "@/components/ui/score-badge";
import { type Col, type SortState } from "@/lib/cells";
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
  { label: "Members", numeric: true, priority: 2, w: "90px", sortKey: "members", cell: (r) => commas(r.n_assets) },
  { label: "Median score", priority: 1, w: "130px", sortKey: "score", cell: (r) => (r.median_tier ? <ScoreBadge tier={r.median_tier} score={r.median_score} /> : "—") },
  { label: "% low-quality", numeric: true, priority: 3, sortKey: "lowq", cell: (r) => (r.pct_low_quality != null ? `${r.pct_low_quality}%` : "—") },
  { label: "Realized USD", numeric: true, priority: 1, sortKey: "realized", cell: (r) => usd(r.total_realized_usd) },
  { label: "Holders", numeric: true, priority: 4, sortKey: "holders", cell: (r) => commas(r.total_holders) },
];

// client-side comparators — the whole board is in memory (no pagination), so sorting is correct
// and instant. Default order is median quality descending (the scoreboard's editorial ranking).
const VALUE: Record<string, (r: TagStatsRow) => number> = {
  members: (r) => r.n_assets,
  score: (r) => r.median_raw ?? -Infinity,
  lowq: (r) => r.pct_low_quality ?? -1,
  realized: (r) => r.total_realized_usd,
  holders: (r) => r.total_holders,
};

export function Collections() {
  const { rows, error, isLoading } = useTags();
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const board = rows.filter(isScoreboard);
  const sorted = [...board].sort((a, b) => {
    if (!sort) return (b.median_raw ?? -Infinity) - (a.median_raw ?? -Infinity);
    const f = VALUE[sort.key] ?? VALUE.score;
    const d = f(a) - f(b);
    return sort.dir === "asc" ? d : -d;
  });
  // tri-state cycle: desc → asc → default (undefined)
  const onSort = (k: string) =>
    setSort((s) => (s?.key !== k ? { key: k, dir: "desc" } : s.dir === "desc" ? { key: k, dir: "asc" } : undefined));

  return (
    <>
      <div className="pagehead">
        <h1>Collections</h1>
        <p>
          Curated series and protocol families, scored as a group. <b>Median</b> is the composed-quality
          tier of a typical member — real demand, realized value, durability — not price. Ranked by that
          median; click a column to re-sort.
        </p>
      </div>
      <Card>
        <AsyncContent isLoading={isLoading} error={error} empty={sorted.length === 0} emptyWhat="collections">
          <RecordTable cols={COLS} rows={sorted} label="collections" sort={sort} onSort={onSort} />
        </AsyncContent>
      </Card>
    </>
  );
}
