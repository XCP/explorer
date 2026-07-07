"use client";
import { Flame, Landmark } from "lucide-react";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { blockCell, txCell, addrCell, timeCell } from "@/lib/cells";
import { ORDER_COLS, ASSET_LIST_COLS, DISPENSER_COLS } from "@/lib/registry";
import { commas, short } from "@/lib/format";

// The asset detail page's tabbed activity (holders, issuances, dispensers, …). A client island
// because the column `cell` renderers are functions — they can't cross the server→client boundary, so
// the whole tab definition is built here and handed to the interactive (SWR/pagination) DetailTabs.
export function AssetTabs({ asset, issuer, inBand = false }: { asset: string; issuer: string | null; inBand?: boolean }) {
  const base = `/v2/assets/${encodeURIComponent(asset)}`;
  const tabs: TabDef[] = [
    { label: "Holders", path: `${base}/balances`, cols: [
      { label: "Holder", cell: (r) => (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {r.holder_type === "address" ? addrCell(r.holder) : <span className="font-mono">{short(r.holder)}</span>}
          {r.is_burn ? <span className="inline-flex items-center gap-0.5 rounded bg-orange-500/10 text-orange-400 px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-orange-500/20 shrink-0"><Flame className="size-2.5" />burn</span> : null}
          {r.is_exchange ? <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/10 text-violet-300 px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-violet-500/20 shrink-0"><Landmark className="size-2.5" />exchange</span> : null}
        </span>
      ) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    ]},
    { label: "Issuances", path: `${base}/issuances`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) }, { label: "Time", cell: (r) => timeCell(r.block_time) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Issuer", cell: (r) => addrCell(r.issuer) }, { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS },
    { label: "Dispenses", path: `${base}/dispenses`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
      { label: "Buyer", cell: (r) => addrCell(r.destination) }, { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Orders", path: `${base}/orders`, cols: ORDER_COLS },
    { label: "Sends", path: `${base}/sends`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "From", cell: (r) => addrCell(r.source) }, { label: "To", cell: (r) => addrCell(r.destination) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) }, { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Subassets", path: `${base}/subassets`, cols: ASSET_LIST_COLS },
    ...(issuer ? [{ label: "From issuer", path: `/v2/addresses/${issuer}/issued`, cols: ASSET_LIST_COLS }] : []),
  ];
  return <DetailTabs tabs={tabs} inBand={inBand} />;
}
