"use client";
import Link from "next/link";
import { useState } from "react";
import type { TagStatsRow } from "@xcp/shared/tags";
import { useTags } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/features/records/components/record-table";
import { ScoreBadge } from "@/components/ui/score-badge";
import { type Col, type SortState } from "@/features/records/cells";
import { commas, compact, collectionLabel } from "@/lib/format";

// Just the collection tags: curated art & collectible PROJECTS (pepe.wtf 'collection' + the tokenscan
// directory). Each is scored as a COMMUNITY — the per-asset "who holds it" signals (Conviction, creator-held)
// rolled up, so the board reads relative community strength, not just a card count. n≥3 keeps it real.
const COLLECTION_SOURCES = new Set(["collection", "tokenscan", "digirare", "discovered"]);
const isCollection = (t: TagStatsRow) =>
  t.entity_type === "asset" && t.n_assets >= 3 && COLLECTION_SOURCES.has(t.source);

const usd = (v: number) => (v > 0 ? `$${compact(v)}` : "—");

// {collection, site} sidecar (tokenscan meta). pepe.wtf 'collection' tags carry no meta → slug label, no site.
function projectMeta(t: TagStatsRow): { name: string; site: string | null } {
  try {
    const m = t.meta ? (JSON.parse(t.meta) as { collection?: string; site?: string }) : null;
    return { name: m?.collection || collectionLabel(t.tag), site: m?.site || null };
  } catch { return { name: collectionLabel(t.tag), site: null }; }
}

// A compact 0-100 bar — the collection's community/scarcity Conviction, the headline relative-strength axis.
function StrengthBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-zinc-600">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-(--color-xcp)" style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-zinc-300 w-6">{score}</span>
    </div>
  );
}

const COLS: Col<TagStatsRow>[] = [
  { label: "Collection", weight: "primary", priority: 1, cell: (r) => {
    const m = projectMeta(r);
    return (
      <span className="flex items-center gap-2 min-w-0">
        <Link href={`/tag/${encodeURIComponent(r.tag)}`} className="font-medium truncate">{m.name}</Link>
        {m.site && (
          <a href={m.site} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-300 shrink-0"
             aria-label={`${m.name} project site`}>↗</a>
        )}
      </span>
    );
  } },
  { label: "Strength", priority: 1, w: "130px", sortKey: "strength", cell: (r) => <StrengthBar score={r.conviction_score} /> },
  { label: "Members", numeric: true, priority: 3, w: "80px", sortKey: "members", cell: (r) => commas(r.n_assets) },
  { label: "Quality", priority: 2, w: "120px", sortKey: "score", cell: (r) => (r.median_tier ? <ScoreBadge tier={r.median_tier} score={r.median_score} /> : "—") },
  { label: "Creators", numeric: true, priority: 4, w: "90px", sortKey: "creators", cell: (r) => (r.avg_creator_pct != null ? `${r.avg_creator_pct}%` : "—") },
  { label: "Realized USD", numeric: true, priority: 2, sortKey: "realized", cell: (r) => usd(r.total_realized_usd) },
  { label: "Holders", numeric: true, priority: 4, sortKey: "holders", cell: (r) => commas(r.total_holders) },
];

// client-side comparators — the whole board is in memory (no pagination), so sorting is instant. Default
// order is community strength descending (the scoreboard's editorial ranking).
const VALUE: Record<string, (r: TagStatsRow) => number> = {
  strength: (r) => r.conviction_score ?? -Infinity,
  members: (r) => r.n_assets,
  score: (r) => r.median_raw ?? -Infinity,
  creators: (r) => r.avg_creator_pct ?? -1,
  realized: (r) => r.total_realized_usd,
  holders: (r) => r.total_holders,
};

export function Collections() {
  const { rows, error, isLoading } = useTags();
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  // A project can appear under both sources (pepe.wtf 'bitcorn' + tokenscan 'bitcorns'). Prefer the curated
  // pepe.wtf 'collection' row and drop the tokenscan duplicate, matched on a normalized slug (strip
  // non-alphanumerics + a trailing plural 's'). Tokenscan projects pepe.wtf doesn't cover pass through.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  const board = rows.filter(isCollection);
  const curatedKeys = new Set(board.filter((t) => t.source === "collection").map((t) => norm(t.tag)));
  const deduped = board.filter((t) => t.source === "collection" || !curatedKeys.has(norm(t.tag)));
  const sorted = [...deduped].sort((a, b) => {
    if (!sort) return (b.conviction_score ?? -Infinity) - (a.conviction_score ?? -Infinity);
    const f = VALUE[sort.key] ?? VALUE.strength;
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
          Counterparty art &amp; collectible projects, scored as <b>communities</b>. <b>Strength</b> rolls up
          who holds the cards — sophisticated collectors, proven creators, genuine scarcity, standing in the
          trusted network — into one 0&ndash;100 signal, independent of price. <b>Quality</b> is the typical
          member&rsquo;s composed tier. Ranked by community strength; click a column to re-sort.{" "}
          <Link href="/collections/candidates">Discover untagged candidates →</Link>
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
