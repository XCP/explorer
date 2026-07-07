"use client";
import { Clock } from "lucide-react";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import { useAddressMempool, useAssetMempool } from "@/lib/hooks";
import { type Col, addrCell, assetCell, viewCell } from "@/lib/cells";
import { eventChip } from "@/lib/mempool";
import { commas } from "@/lib/format";
import { RecordTable } from "@/components/record-table";

// "Pending" island for an entity page (asset or address). Renders NOTHING when the entity has no
// unconfirmed actions — the common case, so it follows the return-null idiom of the relationship panels.
// The amber frame marks the rows as unconfirmed / in-mempool. Polls every 10s via the entity hook.
const COLS: Col<MempoolActionRow>[] = [
  { label: "Event", priority: 1, w: "130px", cell: (r) => eventChip(r.event) },
  { label: "Asset", weight: "primary", priority: 1, w: "minmax(0,1.2fr)", cell: (r) => assetCell(r.asset ?? undefined) },
  { label: "Quantity", numeric: true, priority: 1, cell: (r) => (r.quantity_normalized != null ? commas(r.quantity_normalized) : "—") },
  { label: "From", priority: 3, cell: (r) => addrCell(r.source ?? undefined) },
  { label: "To", priority: 3, cell: (r) => addrCell(r.destination ?? undefined) },
  { label: "View", srOnly: true, priority: 1, w: "44px", cell: (r) => viewCell(r.tx_hash ?? undefined) },
];

export function PendingActions({ address, asset }: { address?: string; asset?: string }) {
  // Exactly one of address/asset is set for a given page; the other hook receives undefined and its SWR
  // key is null, so it never fetches. Both hooks are always called (no conditional-hook violation).
  const byAddress = useAddressMempool(address);
  const byAsset = useAssetMempool(asset);
  const rows = address ? byAddress.rows : byAsset.rows;
  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-amber-500/20 bg-amber-500/[0.04]">
      <div className="flex items-center gap-2 border-b border-amber-500/10 px-4 py-2.5">
        <Clock className="size-4 shrink-0 text-amber-400" />
        <span className="text-sm font-medium text-zinc-200">Pending</span>
        <span className="text-xs text-amber-400/80">· unconfirmed · in mempool</span>
      </div>
      <div className="px-1 pb-1">
        <RecordTable cols={COLS} rows={rows} />
      </div>
    </div>
  );
}
