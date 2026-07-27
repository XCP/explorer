"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

/** Collection logos are optional. Probe through fetch so an expected CDN 404 stays a quiet absence instead of
 * becoming a browser-level failed-image warning; mount the decorative image only after a successful response. */
function CollectionLogo({ tag }: { tag: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetch(`https://cdn.xcp.io/img/logo-icon/${encodeURIComponent(tag)}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [tag]);
  return src ? <img src={src} alt="" className="size-[22px] shrink-0 rounded-[3px] object-cover bg-zinc-900" /> : null;
}

const COLS: Col<CollectionProfile>[] = [
  {
    label: "Collection",
    weight: "primary",
    priority: 1,
    cell: (row) => (
      <span className="flex items-center gap-2 min-w-0">
        <CollectionLogo tag={row.tag} />
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
    label: "Rated",
    priority: 1,
    w: "130px",
    sortKey: "rated",
    cell: (row) => `${commas(row.rated_members)} · ${row.rated_pct}%`,
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
    label: "Median Rating",
    numeric: true,
    priority: 2,
    w: "120px",
    sortKey: "rating",
    cell: (row) => (row.median_rating == null ? "—" : `${row.median_rating.toFixed(1)} / 10`),
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
    label: "Holder overlap",
    numeric: true,
    priority: 3,
    w: "120px",
    sortKey: "overlap",
    cell: (row) => (row.holder_overlap_pct != null ? `${row.holder_overlap_pct}%` : "—"),
  },
  {
    label: "Realized USD",
    numeric: true,
    priority: 2,
    sortKey: "realized",
    cell: (row) => usd(row.total_realized_usd),
  },
  {
    label: "Top value share",
    numeric: true,
    priority: 4,
    w: "120px",
    sortKey: "concentration",
    cell: (row) => (row.top_asset_value_pct != null ? `${row.top_asset_value_pct}%` : "—"),
  },
  {
    label: "Integrity",
    numeric: true,
    priority: 2,
    sortKey: "integrity",
    cell: (row) => (row.integrity_assets > 0 ? `${row.integrity_assets} flagged` : "Clear"),
  },
];

const VALUE: Record<string, (row: CollectionProfile) => number> = {
  rated: (row) => row.rated_pct,
  members: (row) => row.members,
  rating: (row) => row.median_rating ?? -1,
  issuers: (row) => row.issuers,
  overlap: (row) => row.holder_overlap_pct ?? -1,
  realized: (row) => row.total_realized_usd,
  concentration: (row) => row.top_asset_value_pct ?? -1,
  integrity: (row) => row.integrity_assets,
};

export function Collections() {
  const { data, error, isLoading } = useSWR<Envelope<CollectionProfile[]>>(apiUrl("/v2/collections"));
  const [sort, setSort] = useState<SortState | undefined>();
  const sorted = [...(data?.result ?? [])].sort((a, b) => {
    if (!sort)
      return b.rated_pct - a.rated_pct || (b.median_rating ?? -1) - (a.median_rating ?? -1) || b.members - a.members;
    const value = VALUE[sort.key] ?? VALUE.rated;
    const difference = value(a) - value(b);
    return sort.dir === "asc" ? difference : -difference;
  });
  const onSort = (key: string) =>
    setSort((current) =>
      current?.key !== key ? { key, dir: "desc" } : current.dir === "desc" ? { key, dir: "asc" } : undefined,
    );

  return (
    <>
      <div className="pagehead">
        <h1>Collections</h1>
        <p>
          Counterparty projects described by Rating coverage, typical Rating, holder overlap, concentration, market
          activity, realized value, and integrity evidence. No collection score: every observed axis stays visible.
          Ranked by rated-member coverage; click a column to re-sort.{" "}
          <Link href="/collections/candidates" className="underline underline-offset-2">
            Discover untagged candidates →
          </Link>
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
