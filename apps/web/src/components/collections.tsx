"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import type { CollectionProfile } from "@xcp/shared/collections";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/features/records/components/record-table";
import { type Col, type SortState } from "@/features/records/cells";
import { commas, compact, collectionLabel } from "@/lib/format";

const usd = (value: number) => (value > 0 ? `$${compact(value)}` : "—");

const COLS: Col<CollectionProfile>[] = [
  {
    label: "Collection",
    weight: "primary",
    priority: 1,
    cell: (row) => (
      <span className="flex items-center gap-2 min-w-0">
        <Link href={`/tag/${encodeURIComponent(row.tag)}`} className="font-medium truncate">
          {row.name === row.tag ? collectionLabel(row.tag) : row.name}
        </Link>
        {row.site && (
          <a
            href={row.site}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 shrink-0"
            aria-label={`${row.name} project site`}
          >
            ↗
          </a>
        )}
      </span>
    ),
  },
  {
    label: "Market coverage",
    priority: 1,
    w: "130px",
    sortKey: "coverage",
    cell: (row) => `${row.market_pct}%`,
  },
  {
    label: "Members",
    numeric: true,
    priority: 3,
    w: "80px",
    sortKey: "members",
    cell: (row) => commas(row.members),
  },
  {
    label: "Median events",
    numeric: true,
    priority: 2,
    w: "120px",
    sortKey: "events",
    cell: (row) => compact(row.median_events),
  },
  {
    label: "Issuers",
    numeric: true,
    priority: 4,
    w: "90px",
    sortKey: "issuers",
    cell: (row) => commas(row.issuers),
  },
  {
    label: "Realized USD",
    numeric: true,
    priority: 2,
    sortKey: "realized",
    cell: (row) => usd(row.total_realized_usd),
  },
  {
    label: "Holders",
    numeric: true,
    priority: 4,
    sortKey: "holders",
    cell: (row) => commas(row.total_holders),
  },
];

const VALUE: Record<string, (row: CollectionProfile) => number> = {
  coverage: (row) => row.market_pct,
  members: (row) => row.members,
  events: (row) => row.median_events,
  issuers: (row) => row.issuers,
  realized: (row) => row.total_realized_usd,
  holders: (row) => row.total_holders,
};

export function Collections() {
  const { data, error, isLoading } = useSWR<Envelope<CollectionProfile[]>>(apiUrl("/v2/collections"));
  const [sort, setSort] = useState<SortState | undefined>();
  const sorted = [...(data?.result ?? [])].sort((a, b) => {
    if (!sort) return b.market_pct - a.market_pct || b.median_events - a.median_events || b.members - a.members;
    const value = VALUE[sort.key] ?? VALUE.coverage;
    const difference = value(a) - value(b);
    return sort.dir === "asc" ? difference : -difference;
  });
  const onSort = (key: string) =>
    setSort((current) =>
      current?.key !== key
        ? { key, dir: "desc" }
        : current.dir === "desc"
          ? { key, dir: "asc" }
          : undefined,
    );

  return (
    <>
      <div className="pagehead">
        <h1>Collections</h1>
        <p>
          Counterparty art &amp; collectible projects described by breadth, typical activity, issuers, holders, and
          realized value. No single collection grade: each axis stays visible and auditable. Ranked by market coverage;
          click a column to re-sort. <Link href="/collections/candidates">Discover untagged candidates →</Link>
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
