"use client";
import type { ReactNode } from "react";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { ASSET_LIST_COLS, DISPENSER_COLS, REGISTRY } from "@/lib/registry";

// The address detail page's tabbed activity (sends, issuances, dispensers, …). A client island: the
// column `cell` renderers are functions (can't cross the server→client boundary). Feed tabs reuse
// the registry's column layouts; the address context suppresses the Source/Issuer columns the page
// already answers and signs quantities from the address's perspective (R4).
export function AddressTabs({ address, inBand = false, overview }: { address: string; inBand?: boolean; overview?: ReactNode }) {
  const base = `/v2/addresses/${encodeURIComponent(address)}`;
  const tabs: TabDef[] = [
    { label: "Sends", path: `${base}/sends`, cols: REGISTRY.sends!.cols },
    { label: "Issuances", path: `${base}/issuances`, cols: REGISTRY.issuances!.cols },
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS },
    { label: "Dispenses", path: `${base}/dispenses`, cols: REGISTRY.dispenses!.cols },
    { label: "Issued", path: `${base}/issued`, cols: ASSET_LIST_COLS },
  ];
  return <DetailTabs tabs={tabs} inBand={inBand} overview={overview} context={{ address }} />;
}
