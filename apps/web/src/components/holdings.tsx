"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, AssetArt, Skeleton, Empty } from "@/components/ui";
import { RecordTable } from "@/components/record-table";
import { assetCell } from "@/lib/columns";
import { commas } from "@/lib/format";

// Holdings as a visual collection (the owner's #1 want) — a wall of the actual card art, sorted by
// quantity, with a table toggle. This is the "lead with art, not a spreadsheet" upgrade.
export function Holdings({ address }: { address: string }) {
  const { data, isLoading } = useSWR<Envelope<any[]>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/balances`, { limit: 100 }));
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const rows = (data?.result ?? []).slice().sort((a, b) => Number(b.quantity_normalized) - Number(a.quantity_normalized));
  const tab = (k: typeof view, label: string) => (
    <button onClick={() => setView(k)} className={`text-xs px-2 py-0.5 rounded transition-colors ${view === k ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>{label}</button>
  );
  return (
    <Card title={`Holdings${rows.length ? ` · ${rows.length}` : ""}`}>
      <div className="absolute right-4 top-4 flex gap-1">{tab("gallery", "Gallery")}{tab("table", "Table")}</div>
      {isLoading ? <Skeleton rows={3} /> : rows.length === 0 ? <Empty what="holdings" /> : view === "gallery" ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {rows.map((b) => (
            <Link key={b.asset} href={`/asset/${b.asset}`}
              className="group relative overflow-hidden rounded-lg border border-zinc-800 hover:border-[--color-xcp] transition-colors">
              <AssetArt asset={b.asset} stamp={b.stamp} className="w-full aspect-[3/4] group-hover:scale-105 transition-transform" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-6 pb-1.5">
                <div className="text-[11px] font-medium text-zinc-100 truncate">{b.asset_longname || b.asset}</div>
                <div className="text-[10px] text-zinc-400 font-mono">{commas(b.quantity_normalized)}</div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <RecordTable rows={rows} cols={[
          { label: "Asset", cell: (r) => assetCell(r.asset) },
          { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
        ]} />
      )}
    </Card>
  );
}
