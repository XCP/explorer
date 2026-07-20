"use client";
import { useState } from "react";
import type { TradeRow } from "@xcp/shared/trades";
import { useTrades, useTradeStats } from "@/lib/hooks";
import { type Col, blockCell, addrCell, assetCell, timeCell, viewCell } from "@/features/records/cells";
import { commas, compact } from "@/lib/format";
import { Stat } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/features/records/components/record-table";
import Link from "next/link";

// Unified sales feed across every venue — DEX order-matches, dispenser sales, Emblem-vault NFT sales.
// Typed end-to-end (TradeRow from @xcp/shared): the reference implementation for explorer pages. Client
// island (venue filter + pagination) rendered by the thin server page that owns the static metadata.
const PAGE = 50;

const VENUES = [
  { key: undefined, label: "All" },
  { key: "dex", label: "DEX" },
  { key: "dispense", label: "Dispensers" },
  { key: "emblem", label: "Emblem" },
  { key: "telegram", label: "Telegram auctions" },
  { key: "tokenly_swapbot", label: "Tokenly Swapbot" },
] as const;

// The v19 .venue pill (ported classes — dex / disp / emblem).
const VENUE_CLASS: Record<string, string> = { dex: "dex", dispense: "disp", emblem: "emblem", telegram: "emblem" };
const VENUE_LABEL: Record<string, string> = {
  dex: "DEX",
  dispense: "DISPENSER",
  emblem: "EMBLEM",
  telegram: "TELEGRAM",
  tokenly_swapbot: "SWAPBOT",
};
const venueChip = (v: string) => (
  <span className={`venue ${VENUE_CLASS[v] ?? "dex"}`}>{VENUE_LABEL[v] ?? v.toUpperCase()}</span>
);

const money = (n: number | null, currency: string | null) => {
  if (n == null) return "—";
  // ≥1: 2dp comma-grouped; small: 3 significant digits; dust: full 8dp (never scientific notation)
  const v = n >= 1 ? commas(n.toFixed(2)) : n >= 0.0001 ? n.toPrecision(3) : n.toFixed(8).replace(/0+$/, "");
  return `${v} ${currency ?? ""}`.trim();
};

// Exported: the asset page's Sales tab renders the same unified-ledger columns. Trading tape
// grammar (R15): Time first; the total carries its USD valuation as the v19 .xt-price sub-line.
export const TRADE_COLS: Col<TradeRow>[] = [
  { label: "Time", numeric: true, priority: 1, w: "76px", cell: (r) => timeCell(r.block_time ?? undefined) },
  {
    label: "Venue",
    priority: 2,
    w: "110px",
    cell: (r) => <span title={r.source_name ?? undefined}>{venueChip(r.venue)}</span>,
  },
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.2fr)",
    omitOn: "asset",
    cell: (r) =>
      r.asset ? (
        assetCell(r.asset)
      ) : r.sale_class === "bundle" && r.leg_count > 0 ? (
        <span className="font-mono text-xs text-zinc-300">{commas(r.leg_count)}-asset bundle</span>
      ) : (
        "—"
      ),
  },
  { label: "Price", numeric: true, priority: 3, cell: (r) => money(r.price, r.currency) },
  { label: "Qty", numeric: true, priority: 2, w: "90px", cell: (r) => (r.quantity != null ? commas(r.quantity) : "—") },
  {
    label: "Total",
    numeric: true,
    priority: 1,
    w: "150px",
    cell: (r) => (
      <>
        {money(r.total, r.currency)}
        {r.usd_value != null && (
          <small
            title={
              r.usd_basis === "direct_usd"
                ? "Direct USD-denominated payment"
                : `Approximate execution-day USD via ${r.usd_source ?? "historical price calendar"}`
            }
          >
            {r.usd_basis === "direct_usd" ? "$" : "≈$"}
            {commas(r.usd_value.toFixed(2))}
          </small>
        )}
      </>
    ),
  },
  { label: "Buyer", priority: 3, cell: (r) => addrCell(r.buyer ?? undefined) },
  { label: "Seller", priority: 4, cell: (r) => addrCell(r.seller ?? undefined) },
  {
    label: "Block",
    numeric: true,
    priority: 4,
    w: "90px",
    omitOn: "block",
    cell: (r) =>
      r.venue === "emblem"
        ? compact(r.block_index ?? 0)
        : r.venue === "telegram"
          ? "—"
          : blockCell(r.block_index as number),
  },
  {
    label: "View",
    srOnly: true,
    priority: 2,
    w: "44px",
    cell: (r) =>
      r.source_url ? (
        <a href={r.source_url} target="_blank" rel="noreferrer" title={r.source_name ?? "Source"}>
          ↗
        </a>
      ) : r.venue === "emblem" ? (
        "—"
      ) : (
        viewCell(r.tx_hash ?? undefined)
      ),
  },
];

export function Trades() {
  const [venue, setVenue] = useState<string | undefined>(undefined);
  const [includeLowQuality, setIncludeLowQuality] = useState(false);
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useTrades(
    { venue, include_low_quality: includeLowQuality ? 1 : undefined },
    offset,
    PAGE,
  );
  const { venues } = useTradeStats(includeLowQuality);

  return (
    <>
      {venues.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {venues.map((v) => (
            <Stat
              key={v.venue}
              label={`${v.venue} trades`}
              value={compact(v.trades)}
              sub={
                v.usd_known != null
                  ? `$${compact(v.usd_known)} known vol · ${compact(v.usd_unpriced_trades)} without USD`
                  : `${compact(v.usd_unpriced_trades)} without USD`
              }
            />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {VENUES.map((v) => (
            <button
              key={v.label}
              onClick={() => {
                setVenue(v.key);
                setOffset(0);
              }}
              className={`rounded px-2.5 py-1 text-xs ring-1 ring-inset transition ${
                venue === v.key
                  ? "bg-zinc-800 text-zinc-100 ring-zinc-600"
                  : "text-zinc-400 ring-zinc-800 hover:text-zinc-200"
              }`}
            >
              {v.label}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={includeLowQuality}
              onChange={(event) => {
                setIncludeLowQuality(event.target.checked);
                setOffset(0);
              }}
              className="accent-zinc-400"
            />
            Show low-quality and scam trades
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          USD totals include only admitted historical payment values; missing prices remain blank.{" "}
          <Link href="/usd-methodology">Read the USD methodology →</Link>
        </p>
        <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat="trades">
          <RecordTable cols={TRADE_COLS} rows={rows} />
          <div className="flex gap-2 mt-3">
            <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Prev
            </SecondaryButton>
            <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>
              Next
            </SecondaryButton>
          </div>
        </AsyncContent>
      </div>
    </>
  );
}
