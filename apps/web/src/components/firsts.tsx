"use client";
import Link from "next/link";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { AssetIcon } from "@/components/ui/badges";
import { Skeleton } from "@/components/ui/feedback";
import { short, commas } from "@/lib/format";

interface First {
  key: string;
  label: string;
  block: number;
  time: number;
  date: string;
  ref: string;
  type: string;
}

// the linkable entity behind a "first", by its type
function Entity({ type, ref }: { type: string; ref: string }) {
  if (type === "asset")
    return (
      <Link href={`/asset/${ref}`} className="flex items-center gap-1.5 min-w-0">
        <AssetIcon asset={ref} size={16} />
        <span className="truncate">{ref}</span>
      </Link>
    );
  if (type === "address")
    return (
      <Link href={`/address/${ref}`} className="font-mono break-all">
        {ref}
      </Link>
    );
  if (type === "tx")
    return (
      <Link href={`/tx/${ref}`} className="font-mono">
        {short(ref)}
      </Link>
    );
  if (type === "block")
    return (
      <Link href={`/block/${ref}`} className="font-mono">
        #{ref}
      </Link>
    );
  return <span className="truncate">{ref}</span>;
}

// Counterparty's earliest-of-each-kind timeline. Client island rendered by the thin server page that
// owns the static metadata.
export function Firsts() {
  const { data } = useSWR<Envelope<First[]>>(apiUrl("/v2/firsts"));
  const rows = data?.result ?? [];

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Firsts</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Counterparty&apos;s origin story — the earliest of each kind of on-chain moment, in order.
        </p>
      </div>

      <Card bodyClassName="overflow-hidden p-0">
        {rows.length === 0 ? (
          <div className="p-4">
            <Skeleton rows={12} />
          </div>
        ) : (
          <div role="table" aria-label="Counterparty firsts" className="text-sm">
            <div
              role="row"
              className="hidden grid-cols-[6.75rem_6rem_minmax(0,1fr)_minmax(12rem,1fr)] gap-x-4 border-b border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500 sm:grid"
            >
              <span role="columnheader">Date</span>
              <span role="columnheader">Block</span>
              <span role="columnheader">First</span>
              <span role="columnheader">Milestone</span>
            </div>
            <ol role="rowgroup">
              {rows.map((r) => (
                <li
                  key={r.key}
                  role="row"
                  className="relative ml-3 grid grid-cols-1 gap-y-1.5 border-b border-l border-zinc-800 py-3 pl-4 pr-3 last:border-b-0 before:absolute before:-left-1 before:top-[1.15rem] before:size-2 before:rounded-full before:bg-(--color-accent) sm:ml-0 sm:grid-cols-[6.75rem_6rem_minmax(0,1fr)_minmax(12rem,1fr)] sm:items-center sm:gap-x-4 sm:gap-y-0 sm:border-l-0 sm:border-zinc-900 sm:px-4 sm:py-2.5 sm:before:hidden"
                >
                  <span role="cell" className="grid grid-cols-[4.5rem_minmax(0,1fr)] sm:block">
                    <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600 sm:hidden">
                      Date
                    </span>
                    <time className="font-mono text-xs text-zinc-400">{r.date}</time>
                  </span>
                  <span role="cell" className="grid grid-cols-[4.5rem_minmax(0,1fr)] sm:block">
                    <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600 sm:hidden">
                      Block
                    </span>
                    <Link
                      href={`/block/${r.block}`}
                      className="truncate font-mono text-xs !text-zinc-500 hover:!text-zinc-300"
                    >
                      #{commas(r.block)}
                    </Link>
                  </span>
                  <span role="cell" className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] sm:block">
                    <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600 sm:hidden">
                      First
                    </span>
                    <span className="min-w-0 overflow-hidden text-zinc-200 [&_a]:!text-zinc-200">
                      <Entity type={r.type} ref={r.ref} />
                    </span>
                  </span>
                  <span role="cell" className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] sm:block">
                    <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600 sm:hidden">
                      Milestone
                    </span>
                    <span className="text-xs leading-4 text-zinc-400 sm:text-sm sm:text-zinc-300">{r.label}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>
    </>
  );
}
