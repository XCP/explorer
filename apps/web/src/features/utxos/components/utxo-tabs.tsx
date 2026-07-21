"use client";
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import type { UtxoEvent } from "@xcp/shared/utxos";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { type Col, addrCell, assetCell, timeCell, viewCell } from "@/features/records/cells";
import { commas, short } from "@/lib/format";

// The UTXO page's tabbed activity — the AssetTabs pattern at UTXO scale. A client island for the
// same reason: column `cell` renderers are functions and can't cross the server→client boundary.

/** A history party linked by its shape: "txid:vout" → /utxo (bookended mono), address → addrCell. */
const partyCell = (value?: string | null) =>
  value ? (
    /^[0-9a-f]{64}:\d+$/i.test(value) ? (
      <Link className="font-mono" href={`/utxo/${value}` as Route} title={value}>
        {short(value, 8, 6)}
      </Link>
    ) : (
      addrCell(value)
    )
  ) : (
    "—"
  );

const EVENT_LABEL: Record<UtxoEvent["type"], string> = {
  attach: "Attach",
  move: "Move",
  detach: "Detach",
};

const HISTORY_COLS: Col<UtxoEvent>[] = [
  { label: "Event", priority: 1, w: "70px", cell: (r) => EVENT_LABEL[r.type] ?? r.type },
  { label: "Asset", priority: 1, cell: (r) => assetCell(r.asset) },
  {
    label: "Quantity",
    numeric: true,
    priority: 1,
    w: "120px",
    cell: (r) => <span className="amt mono">{commas(r.quantity_normalized)}</span>,
  },
  { label: "From", priority: 2, cell: (r) => partyCell(r.source ?? r.source_address) },
  { label: "To", priority: 2, cell: (r) => partyCell(r.destination ?? r.destination_address) },
  { label: "Time", priority: 1, w: "110px", cell: (r) => timeCell(r.block_time) },
  { label: "View", priority: 1, w: "60px", cell: (r) => viewCell(r.tx_hash) },
];

export function UtxoTabs({ utxo, overview }: { utxo: string; overview?: ReactNode }) {
  const tabs: TabDef[] = [
    { label: "History", path: `/v2/utxos/${encodeURIComponent(utxo)}/history`, cols: HISTORY_COLS as Col[] },
  ];
  return <DetailTabs tabs={tabs} inBand overview={overview} context={{}} />;
}
