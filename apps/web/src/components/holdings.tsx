"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { AddressBalanceRow } from "@xcp/shared/addresses";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { AsyncContent } from "@/components/ui/async-content";
import { AssetArt } from "@/components/asset-art";
import { RecordTable } from "@/components/record-table";
import { assetCell } from "@/lib/cells";
import { commas } from "@/lib/format";

// Holdings as a visual collection (the owner's #1 want) — a wall of the actual card art, sorted by
// quantity, with a table toggle. This is the "lead with art, not a spreadsheet" upgrade.
export function Holdings({ address }: { address: string }) {
  const { data, isLoading } = useSWR<Envelope<AddressBalanceRow[]>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/balances`, { limit: 100 }));
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const rows = (data?.result ?? []).slice().sort((a, b) => Number(b.quantity_normalized) - Number(a.quantity_normalized));
  const tab = (k: typeof view, label: string) => (
    <button onClick={() => setView(k)} className={`text-xs px-2 py-0.5 rounded transition-colors ${view === k ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}>{label}</button>
  );
  return (
    <Card title={`Holdings${rows.length ? ` · ${rows.length}` : ""}`}>
      <div className="absolute right-4 top-4 flex gap-1">{tab("gallery", "Gallery")}{tab("table", "Table")}</div>
      <AsyncContent isLoading={isLoading} empty={rows.length === 0} emptyWhat="holdings" loading={<Skeleton rows={3} />}>
        {view === "gallery" ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {rows.map((b) => (
            <Link key={b.asset} href={`/asset/${b.asset}`}
              className="group relative overflow-hidden rounded-lg border border-zinc-800 hover:border-(--color-accent) transition-colors">
              <AssetArt asset={b.asset} stamp={!!b.stamp} className="w-full aspect-[3/4] group-hover:scale-105 transition-transform" />
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
      </AsyncContent>
    </Card>
  );
}
