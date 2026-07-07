"use client";
import { useState } from "react";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import { useMempool } from "@/lib/hooks";
import { type Col, addrCell, assetCell, timeCell, viewCell } from "@/lib/cells";
import { eventChip, kindOf, MEMPOOL_KINDS, type MempoolKind } from "@/lib/mempool";
import { commas } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";

// Protocol-wide live view of unconfirmed Counterparty actions. Client island (10s polling + kind filter)
// rendered by the thin server page that owns the static metadata — the reference idiom (see app/trades).
const COLS: Col<MempoolActionRow>[] = [
  { label: "Time", numeric: true, priority: 1, w: "76px", cell: (r) => timeCell(r.timestamp) },
  { label: "Event", priority: 1, w: "130px", cell: (r) => eventChip(r.event) },
  { label: "Asset", weight: "primary", priority: 1, w: "minmax(0,1.2fr)", cell: (r) => assetCell(r.asset ?? undefined) },
  { label: "Quantity", numeric: true, priority: 2, cell: (r) => (r.quantity_normalized != null ? commas(r.quantity_normalized) : "—") },
  { label: "From", priority: 3, cell: (r) => addrCell(r.source ?? undefined) },
  { label: "To", priority: 4, cell: (r) => addrCell(r.destination ?? undefined) },
  { label: "View", srOnly: true, priority: 2, w: "44px", cell: (r) => viewCell(r.tx_hash ?? undefined) },
];

export function MempoolFeed() {
  const [kind, setKind] = useState<MempoolKind | undefined>(undefined);
  const { rows } = useMempool();
  const shown = kind ? rows.filter((r) => kindOf(r.event) === kind) : rows;
  const txs = new Set(rows.map((r) => r.tx_hash)).size;

  return (
    <Card title="Mempool">
      <span className="absolute right-5 top-4 flex items-center gap-1.5 text-xs text-zinc-400">
        <span className="size-1.5 rounded-full bg-(--color-up) animate-pulse" /> live
      </span>
      <p className="-mt-2 mb-3 text-xs text-zinc-400">
        {rows.length === 0
          ? "Unconfirmed Counterparty actions in the Bitcoin mempool."
          : `${commas(rows.length)} pending action${rows.length === 1 ? "" : "s"} across ${commas(txs)} transaction${txs === 1 ? "" : "s"}.`}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {MEMPOOL_KINDS.map((k) => (
          <button
            key={k.label}
            onClick={() => setKind(k.key)}
            className={`rounded px-2.5 py-1 text-xs ring-1 ring-inset transition ${
              kind === k.key ? "bg-zinc-800 text-zinc-100 ring-zinc-600" : "text-zinc-400 ring-zinc-800 hover:text-zinc-200"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <AsyncContent empty={shown.length === 0} emptyWhat="pending actions">
        <RecordTable cols={COLS} rows={shown} />
      </AsyncContent>
    </Card>
  );
}
