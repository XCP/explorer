"use client";
import type { ReactNode } from "react";
import { Flame, Landmark } from "lucide-react";
import type { AssetFeedCounts } from "@xcp/shared/assets";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { RelatedTab } from "@/components/related-tab";
import { blockCell, txCell, addrCell, timeCell } from "@/lib/cells";
import { POOL_COLS, ORDER_COLS, ASSET_LIST_COLS, DISPENSER_COLS, FAIRMINT_COLS, DIVIDEND_COLS, DESTRUCTION_COLS } from "@/lib/registry";
import { TRADE_COLS } from "@/components/trades";
import { commas, short } from "@/lib/format";

// The asset detail page's tabbed activity (sales, holders, related, issuances, dispensers, …). A
// client island because the column `cell` renderers are functions — they can't cross the server→
// client boundary, so the whole tab definition is built here and handed to the interactive
// (SWR/pagination) DetailTabs. The server page's overview node and contextual band pass straight
// through. Feed tabs carry v19's mono counts (feed_counts on the asset detail; omitted when the
// count read failed); Related is a panel tab that fetches only while selected.
//
// Feed tabs are EARNED: any feed tab whose count is known and zero is omitted entirely, so a
// dormant asset shows only Overview, Related, and whatever activity it actually has. Tabs whose
// count is unknown (the count read failed) still render; Overview and Related always render.
export function AssetTabs({ asset, collection = null, holderCount, feedCounts, inBand = false, overview, banner }: {
  asset: string; collection?: string | null;
  holderCount?: number | null; feedCounts?: AssetFeedCounts | null;
  inBand?: boolean; overview?: ReactNode; banner?: ReactNode;
}) {
  const base = `/v2/assets/${encodeURIComponent(asset)}`;
  const tabs: TabDef[] = [
    { label: "Sales", path: `${base}/trades`, cols: TRADE_COLS, count: feedCounts?.sales },
    { label: "Holders", path: `${base}/balances`, count: holderCount, cols: [
      { label: "Holder", cell: (r) => (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {r.holder_type === "address" ? addrCell(r.holder) : <span className="font-mono">{short(r.holder)}</span>}
          {r.is_burn ? <span className="inline-flex items-center gap-0.5 rounded bg-orange-500/10 text-orange-400 px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-orange-500/20 shrink-0"><Flame className="size-2.5" />burn</span> : null}
          {r.is_exchange ? <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/10 text-violet-300 px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-violet-500/20 shrink-0"><Landmark className="size-2.5" />exchange</span> : null}
        </span>
      ) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    ]},
    { label: "Related", panel: <RelatedTab asset={asset} collection={collection} /> },
    { label: "Issuances", path: `${base}/issuances`, count: feedCounts?.issuances, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) }, { label: "Time", cell: (r) => timeCell(r.block_time) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Issuer", cell: (r) => addrCell(r.issuer) }, { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS, count: feedCounts?.dispensers },
    { label: "Dispenses", path: `${base}/dispenses`, count: feedCounts?.dispenses, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
      { label: "Buyer", cell: (r) => addrCell(r.destination) }, { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Orders", path: `${base}/orders`, cols: ORDER_COLS, count: feedCounts?.orders },
    { label: "Sends", path: `${base}/sends`, count: feedCounts?.sends, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "From", cell: (r) => addrCell(r.source) }, { label: "To", cell: (r) => addrCell(r.destination) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) }, { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Fairmints", path: `${base}/fairmints`, cols: FAIRMINT_COLS, count: feedCounts?.fairmints },
    { label: "Dividends", path: `${base}/dividends`, cols: DIVIDEND_COLS, count: feedCounts?.dividends },
    { label: "Destructions", path: `${base}/destructions`, cols: DESTRUCTION_COLS, count: feedCounts?.destructions },
    { label: "Subassets", path: `${base}/subassets`, cols: ASSET_LIST_COLS, count: feedCounts?.subassets },
    { label: "Pools", path: `${base}/pools`, cols: POOL_COLS, count: feedCounts?.pools },
  ];
  // the zero-count rule: a feed tab with a KNOWN empty feed doesn't earn a spot in the bar.
  const earned = tabs.filter((t) => !("path" in t) || t.count == null || t.count > 0);
  return <DetailTabs tabs={earned} inBand={inBand} overview={overview} banner={banner} />;
}
