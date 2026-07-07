"use client";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { blockCell, txCell, addrCell, assetCell } from "@/lib/cells";
import { ASSET_LIST_COLS, DISPENSER_COLS } from "@/lib/registry";
import { commas } from "@/lib/format";

// The address detail page's tabbed activity (sends, issuances, dispensers, …). A client island: the
// column `cell` renderers are functions (can't cross the server→client boundary) and the direction/
// counterparty cells close over `address`, so the tabs are built here for the interactive DetailTabs.
export function AddressTabs({ address, inBand = false }: { address: string; inBand?: boolean }) {
  const base = `/v2/addresses/${encodeURIComponent(address)}`;
  const tabs: TabDef[] = [
    { label: "Sends", path: `${base}/sends`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Asset", cell: (r) => assetCell(r.asset) },
      { label: "Direction", cell: (r) => r.source === address ? <span className="text-red-400">out</span> : <span className="text-green-400">in</span> },
      { label: "Counterparty", cell: (r) => addrCell(r.source === address ? r.destination : r.source) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Issuances", path: `${base}/issuances`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Asset", cell: (r) => assetCell(r.asset) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS },
    { label: "Dispenses", path: `${base}/dispenses`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Asset", cell: (r) => assetCell(r.asset) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
      { label: "Counterparty", cell: (r) => addrCell(r.source === address ? r.destination : r.source) },
      { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Issued", path: `${base}/issued`, cols: ASSET_LIST_COLS },
  ];
  return <DetailTabs tabs={tabs} inBand={inBand} />;
}
