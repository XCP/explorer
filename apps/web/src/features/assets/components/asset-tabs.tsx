"use client";
import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  Flame,
  Landmark,
  Vault,
  ArrowDownToLine,
  Server,
  Fish,
  Layers,
  Hammer,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import type { AssetFeedCounts, BalanceRow, HolderRole } from "@xcp/shared/assets";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { RelatedTab } from "@/features/assets/components/related-tab";
import { AssetActivity } from "@/features/assets/components/asset-activity";
import { type Col, addrCell } from "@/features/records/cells";
import {
  POOL_COLS,
  ORDER_COLS,
  ASSET_LIST_COLS,
  DISPENSER_COLS,
  FAIRMINT_COLS,
  DIVIDEND_COLS,
  DESTRUCTION_COLS,
  REGISTRY,
} from "@/features/records/registry";
import { TRADE_COLS } from "@/components/trades";
import { commas, short, usdCompact } from "@/lib/format";
import { HoldersHeader } from "@/features/assets/components/holders-header";

// One badge per holder, keyed off the wire `role` — the SAME taxonomy the holder-makeup card buckets
// by, so "whale"/"collector" read identically in the aggregate and on the individual row. Custody
// (burn/exchange/vault/…) is amber/violet/cyan; behaviour (creator/whale/collector) is warm/teal/indigo.
const ROLE_BADGE: Record<HolderRole, { label: string; Icon: LucideIcon; className: string }> = {
  burn: { label: "burn", Icon: Flame, className: "bg-orange-500/10 text-orange-400 ring-orange-500/20" },
  exchange: { label: "exchange", Icon: Landmark, className: "bg-violet-500/10 text-violet-300 ring-violet-500/20" },
  vault: { label: "vault", Icon: Vault, className: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/20" },
  deposit: { label: "deposit", Icon: ArrowDownToLine, className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20" },
  service: { label: "service", Icon: Server, className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20" },
  creator: { label: "creator", Icon: Hammer, className: "bg-amber-500/10 text-amber-300 ring-amber-500/20" },
  whale: { label: "whale", Icon: Fish, className: "bg-teal-500/10 text-teal-300 ring-teal-500/20" },
  collector: { label: "collector", Icon: Layers, className: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20" },
  issuer: { label: "issuer", Icon: Hammer, className: "bg-amber-500/10 text-amber-300 ring-amber-500/20" },
  owner: { label: "owner", Icon: KeyRound, className: "bg-sky-500/10 text-sky-300 ring-sky-500/20" },
};

// The holders table shows identity badges, not behaviour scores: custody (burn/exchange/vault) plus
// the asset's own issuer and current owner. Whale/collector/deposit/service read as noise here —
// the holder-makeup card above the table already aggregates behaviour (owner call, 2026-07-29).
const HOLDER_TABLE_ROLES = new Set<HolderRole>(["burn", "exchange", "vault", "issuer", "owner"]);

function RoleBadge({ role }: { role: HolderRole }) {
  const badge = ROLE_BADGE[role];
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset shrink-0 ${badge.className}`}
    >
      <badge.Icon className="size-2.5" />
      {badge.label}
    </span>
  );
}

// v19 holders-table cells (.ht-*): rank counts from the page offset; % of supply answers the
// concentration question every cap-table reader is asking (the denominator is already on the page —
// audit #7).
// Divisibility-aware amount: indivisible assets are whole numbers; divisible ones drop the
// artificial eight-zero tail (0.5, not 0.50000000) — the numeric column stays right-aligned.
const holderAmount = (normalized: string | null, divisible: boolean): string => {
  if (normalized == null) return "—";
  if (!divisible) return commas(normalized.split(".")[0]);
  const trimmed = normalized.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const [whole, frac] = trimmed.split(".");
  return frac ? `${commas(whole)}.${frac}` : commas(whole);
};

const holderCols = (supply: number | null, divisible: boolean, unitPriceUsd: number | null): Col<BalanceRow>[] => [
  {
    label: "#",
    priority: 2,
    w: "30px",
    cell: (r, ctx, i) => <span className="ht-rank">{(ctx.offset ?? 0) + i + 1}</span>,
  },
  {
    label: "Holder",
    priority: 1,
    cell: (r) => (
      <span className="ht-address inline-flex items-center gap-1.5 min-w-0">
        {r.holder_type === "address" ? (
          addrCell(r.holder)
        ) : (
          <Link className="font-mono" href={`/utxo/${r.holder}` as Route} title={r.holder}>
            {short(r.holder)}
          </Link>
        )}
        {r.role && HOLDER_TABLE_ROLES.has(r.role) ? <RoleBadge role={r.role} /> : null}
      </span>
    ),
  },
  {
    label: "Amount",
    numeric: true,
    priority: 1,
    w: "150px",
    cell: (r) => <span className="ht-qty">{holderAmount(r.quantity_normalized, divisible)}</span>,
  },
  ...(unitPriceUsd != null
    ? [
        {
          label: "Value",
          numeric: true,
          priority: 2,
          w: "110px",
          cell: (r) => {
            const qty = Number(r.quantity_normalized);
            return Number.isFinite(qty) ? <span className="ht-qty">{usdCompact(qty * unitPriceUsd)}</span> : "—";
          },
        } satisfies Col<BalanceRow>,
      ]
    : []),
  {
    label: "% of supply",
    numeric: true,
    priority: 2,
    w: "110px",
    cell: (r) => {
      const qty = Number(r.quantity_normalized);
      if (!supply || !Number.isFinite(qty)) return "—";
      const pct = (qty / supply) * 100;
      return <span className="ht-pct">{pct > 0 && pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`}</span>;
    },
  },
];

// The asset detail page's tabbed activity (sales, holders, related, issuances, dispensers, …). A
// client island because the column `cell` renderers are functions — they can't cross the server→
// client boundary, so the whole tab definition is built here and handed to the interactive
// (SWR/pagination) DetailTabs. The server page's overview node and contextual band pass straight
// through. Feed tabs carry v19's mono counts (feed_counts on the asset detail; omitted when the
// count read failed); Related is a panel tab that fetches only while selected.
//
// Feed tabs reuse the registry's column layouts; the asset context suppresses the Asset column the
// page already answers (R4). Feed tabs are EARNED: any feed tab whose count is known and zero is
// omitted entirely, so a dormant asset shows only Overview, Related, and whatever activity it
// actually has. Tabs whose count is unknown (the count read failed) still render; Overview always
// renders, and Related renders unless the asset has known-zero supply (no holders → no co-holds).
export function AssetTabs({
  asset,
  collection = null,
  holderCount,
  supply = null,
  divisible = false,
  unitPriceUsd = null,
  feedCounts,
  inBand = false,
  overview,
  banner,
}: {
  asset: string;
  collection?: string | null;
  holderCount?: number | null;
  supply?: number | null;
  divisible?: boolean;
  unitPriceUsd?: number | null;
  feedCounts?: AssetFeedCounts | null;
  inBand?: boolean;
  overview?: ReactNode;
  banner?: ReactNode;
}) {
  const base = `/v2/assets/${encodeURIComponent(asset)}`;
  // Order: Holders leads the activity, the rest follow, then Trades sits second-to-last and Related is
  // pinned to the very end (Related is a panel with no count, so it always earns the final slot).
  const tabs: TabDef[] = [
    {
      label: "Holders",
      path: `${base}/balances`,
      count: holderCount,
      cols: holderCols(supply, divisible, unitPriceUsd),
      header: <HoldersHeader asset={asset} supply={supply} holderCount={holderCount ?? null} />,
    },
    { label: "Activity", panel: <AssetActivity asset={asset} /> },
    { label: "Issuances", path: `${base}/issuances`, count: feedCounts?.issuances, cols: REGISTRY.issuances!.cols },
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS, count: feedCounts?.dispensers },
    { label: "Dispenses", path: `${base}/dispenses`, count: feedCounts?.dispenses, cols: REGISTRY.dispenses!.cols },
    { label: "Orders", path: `${base}/orders`, cols: ORDER_COLS, count: feedCounts?.orders },
    { label: "Sends", path: `${base}/sends`, count: feedCounts?.sends, cols: REGISTRY.sends!.cols },
    { label: "Fairmints", path: `${base}/fairmints`, cols: FAIRMINT_COLS, count: feedCounts?.fairmints },
    { label: "Dividends", path: `${base}/dividends`, cols: DIVIDEND_COLS, count: feedCounts?.dividends },
    { label: "Destructions", path: `${base}/destructions`, cols: DESTRUCTION_COLS, count: feedCounts?.destructions },
    { label: "Subassets", path: `${base}/subassets`, cols: ASSET_LIST_COLS, count: feedCounts?.subassets },
    { label: "Pools", path: `${base}/pools`, cols: POOL_COLS, count: feedCounts?.pools },
    { label: "Trades", path: `${base}/trades`, cols: TRADE_COLS, count: feedCounts?.sales },
    // Related is co-holder overlap. An asset whose entire supply is escrowed can have positive
    // supply but zero current holders, so holder count—not issued supply—is the correct gate.
    ...(holderCount === 0 ? [] : [{ label: "Related", panel: <RelatedTab asset={asset} collection={collection} /> }]),
  ];
  // the zero-count rule: a feed tab with a KNOWN empty feed doesn't earn a spot in the bar.
  const earned = tabs.filter((t) => !("path" in t) || t.count == null || t.count > 0);
  return <DetailTabs tabs={earned} inBand={inBand} overview={overview} banner={banner} context={{ asset }} />;
}
