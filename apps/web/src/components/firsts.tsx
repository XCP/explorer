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

      <Card>
        {rows.length === 0 ? (
          <Skeleton rows={12} />
        ) : (
          <ol className="text-sm">
            {rows.map((r) => (
              <li
                key={r.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 border-b border-zinc-900 last:border-0"
              >
                <time className="font-mono text-xs text-zinc-400 w-[5.5rem] shrink-0">{r.date}</time>
                <span className="text-zinc-200 flex-1 min-w-0">{r.label}</span>
                <span className="text-zinc-300 min-w-0 max-w-[55%]">
                  <Entity type={r.type} ref={r.ref} />
                </span>
                <Link
                  href={`/block/${r.block}`}
                  className="font-mono text-[10px] text-zinc-500 hover:text-zinc-200 w-16 text-right shrink-0"
                >
                  #{commas(r.block)}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
