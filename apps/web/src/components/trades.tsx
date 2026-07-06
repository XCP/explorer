"use client";
import { useState } from "react";
import type { TradeRow } from "@xcp/shared/trades";
import { useTrades, useTradeStats } from "@/lib/hooks";
import { type Col, blockCell, txCell, addrCell, assetCell, timeCell } from "@/lib/cells";
import { commas, compact } from "@/lib/format";
import { Card, Stat } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";

// Unified sales feed across every venue — DEX order-matches, dispenser sales, Emblem-vault NFT sales.
// Typed end-to-end (TradeRow from @xcp/shared): the reference implementation for explorer pages. Client
// island (venue filter + pagination) rendered by the thin server page that owns the static metadata.
const PAGE = 50;

const VENUES = [
  { key: undefined, label: "All" },
  { key: "dex", label: "DEX" },
  { key: "dispense", label: "Dispensers" },
  { key: "emblem", label: "Emblem" },
] as const;

const VENUE_STYLE: Record<string, string> = {
  dex: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  dispense: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  emblem: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
};

const venueChip = (v: string) => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${VENUE_STYLE[v] ?? "bg-zinc-800 text-zinc-300 ring-zinc-700"}`}>
    {v}
  </span>
);

const money = (n: number | null, currency: string | null) => {
  if (n == null) return "—";
  const v = n >= 1 ? commas(n.toFixed(2)) : n.toPrecision(3);
  return `${v} ${currency ?? ""}`.trim();
};

const usd = (n: number | null) => (n == null ? "—" : `$${commas(n.toFixed(2))}`);

const TRADE_COLS: Col<TradeRow>[] = [
  { label: "Time", cell: (r) => timeCell(r.block_time ?? undefined) },
  { label: "Venue", cell: (r) => venueChip(r.venue) },
  { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset ?? undefined) },
  { label: "Qty", numeric: true, cell: (r) => (r.quantity != null ? commas(r.quantity) : "—") },
  { label: "Total", numeric: true, cell: (r) => money(r.total, r.currency) },
  { label: "USD", numeric: true, cell: (r) => usd(r.usd_value), hideBelow: "sm" },
  { label: "Buyer", cell: (r) => addrCell(r.buyer ?? undefined), hideBelow: "md" },
  { label: "Block", numeric: true, cell: (r) => (r.venue === "emblem" ? compact(r.block_index ?? 0) : blockCell(r.block_index as number)), hideBelow: "lg" },
  { label: "Tx", cell: (r) => (r.venue === "emblem" ? "—" : txCell(r.tx_hash ?? undefined)), hideBelow: "sm" },
];

export function Trades() {
  const [venue, setVenue] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useTrades({ venue }, offset, PAGE);
  const { venues } = useTradeStats();

  return (
    <>
      {venues.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {venues.map((v) => (
            <Stat key={v.venue} label={`${v.venue} trades`} value={compact(v.trades)} sub={v.usd_known != null ? `$${compact(v.usd_known)} known vol` : `${compact(v.assets)} assets`} />
          ))}
        </div>
      )}
      <Card title="Trades">
        <div className="flex gap-1.5 mb-3">
          {VENUES.map((v) => (
            <button
              key={v.label}
              onClick={() => { setVenue(v.key); setOffset(0); }}
              className={`rounded px-2.5 py-1 text-xs ring-1 ring-inset transition ${
                venue === v.key ? "bg-zinc-800 text-zinc-100 ring-zinc-600" : "text-zinc-400 ring-zinc-800 hover:text-zinc-200"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat="trades">
          <RecordTable cols={TRADE_COLS} rows={rows} />
          <div className="flex gap-2 mt-4">
            <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</SecondaryButton>
            <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
          </div>
        </AsyncContent>
      </Card>
    </>
  );
}
