"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import useSWR from "swr";
import type { DispenseRow, DispenserRow, IssuanceRow, OrderRow, TransactionRow } from "@xcp/shared/records";
import type { FeaturedAsset } from "@xcp/shared/assets";
import type { TradeRow } from "@xcp/shared/trades";
import { apiUrl, type Envelope } from "@/lib/api";
import { useStats, useBlocks, useIndex, useMempool, useTrades } from "@/lib/hooks";
import { Card } from "@/components/ui/card";
import { Table, Row, Cell, type Head } from "@/components/ui/table";
import { Skeleton, Empty } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { AssetArt } from "@/components/asset-art";
import { ActivityChart } from "@/components/activity-chart";
import { SearchBox } from "@/components/search-box";
import { eventLabel } from "@/lib/mempool";
import { commas, short, timeAgo, ts } from "@/lib/format";
import { orderView } from "@/lib/trading-pair";

// A "now" panel: a titled card with a View-all link and an optional live indicator, for the three
// happening-now feeds. Freshness is the product here, so each row leads with content and ends in a time.
function NowPanel({ title, href, live, children }: { title: string; href: string; live?: "green" | "amber"; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="absolute right-4 top-4 flex items-center gap-2 text-xs">
        {live && (
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className={`size-1.5 rounded-full animate-pulse ${live === "amber" ? "bg-amber-400" : "bg-(--color-up)"}`} /> live
          </span>
        )}
        <Link href={href} className="!text-zinc-400 hover:!text-(--color-accent)">View all →</Link>
      </div>
      {children}
    </Card>
  );
}

const assetLink = (asset: string, name?: string | null) => (
  <Link href={`/asset/${asset}`} className="flex items-center gap-2 min-w-0"><AssetIcon asset={asset} size={16} /><span className="truncate">{name || asset}</span></Link>
);
const addrLink = (a?: string | null) => (a ? <Link href={`/address/${a}`} className="font-mono">{short(a)}</Link> : "—");

// Venue label for the sales feed (dex / dispense / emblem) — a small colour-coded chip.
const VENUE_STYLE: Record<string, string> = {
  dex: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  dispense: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  emblem: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
};
const venueChip = (v: string) => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${VENUE_STYLE[v] ?? "bg-zinc-800 text-zinc-300 ring-zinc-700"}`}>{v}</span>
);
// USD-first value for a sale: real dollars where known, else the native total in its currency.
const saleValue = (r: TradeRow) =>
  r.usd_value != null ? `$${commas(r.usd_value.toFixed(2))}`
  : r.total != null ? `${r.total >= 1 ? commas(r.total.toFixed(2)) : r.total.toPrecision(3)} ${r.currency ?? ""}`.trim()
  : "—";

// A tight three-cell "now" row: content on the left, a small meta chip, and a right-aligned time-ago.
function NowRow({ left, meta, time }: { left: ReactNode; meta?: ReactNode; time: number | null }) {
  return (
    <li className="flex items-center gap-2 py-1.5 border-b border-zinc-900 last:border-0 text-sm">
      <span className="flex-1 min-w-0">{left}</span>
      {meta && <span className="shrink-0 text-xs text-zinc-400">{meta}</span>}
      <span className="shrink-0 w-16 text-right font-mono text-xs text-zinc-400 tabular-nums">{timeAgo(time)}</span>
    </li>
  );
}

// A small live vital in the "now strip" — label + mono value, optional amber tone for the pending count.
function Vital({ label, value, tone }: { label: string; value: ReactNode; tone?: "amber" }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-zinc-400">{label}</span>
      <span className={`font-mono tabular-nums ${tone === "amber" ? "text-amber-400" : "text-zinc-100"}`}>{value}</span>
    </span>
  );
}

// Deep-cut record feed (browsing tail) — the compact dense tables below the now-content.
function Feed<T>({ title, href, rows, head, render }: { title: string; href: string; rows: T[]; head: Head[]; render: (r: T, i: number) => ReactNode }) {
  return (
    <Card title={title}>
      <Link href={href} className="absolute right-4 top-4 text-xs !text-zinc-400 hover:!text-(--color-accent)">View all →</Link>
      {rows.length === 0 ? <Skeleton rows={5} /> : <Table head={head}>{rows.map(render)}</Table>}
    </Card>
  );
}

// Home dashboard — the "now" view: what just sold, what's pending, what just confirmed, then the
// featured art, the activity trend, and the deep-cut record feeds. Client island (SWR-backed, live).
export function HomeDashboard() {
  const { item: stats } = useStats();
  const { rows: trades } = useTrades({}, 0, 8);
  const { rows: txns } = useIndex<TransactionRow>("transactions", 0, 8);
  const { rows: blocks } = useBlocks(0, 8);
  const { rows: mempool } = useMempool();
  const pending = new Set(mempool.map((m) => m.tx_hash)).size;
  const lastBlockTime = blocks[0]?.block_time ?? null;
  const { rows: issuances } = useIndex<IssuanceRow>("issuances", 0, 8);
  const { rows: dispenses } = useIndex<DispenseRow>("dispenses", 0, 8);
  const { rows: orders } = useIndex<OrderRow>("orders", 0, 8);
  const { rows: dispensers } = useIndex<DispenserRow>("dispensers", 0, 8);
  // Featured = top-quality assets that actually have art (has_media). 12-wide grid; only real art shows.
  const { data: featuredData } = useSWR<Envelope<FeaturedAsset[]>>(apiUrl("/v2/featured?limit=12"));
  const featured = featuredData?.result ?? [];

  return (
    <>
      {/* tight hero — identity + the hero utility */}
      <section className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950 px-5 py-6 sm:py-8 text-center">
        <h1 className="text-lg sm:text-xl font-semibold text-zinc-100">The Counterparty Blockchain Explorer</h1>
        <p className="text-sm text-zinc-400 mt-1">What just sold, what&apos;s live, and twelve years of history — on Bitcoin since 2014.</p>
        <div className="mt-4 max-w-2xl mx-auto"><SearchBox big /></div>
      </section>

      {/* now strip — live vitals */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-sm">
        <Vital label="Tip block" value={commas(stats?.tip)} />
        <Vital label="Pending" value={commas(pending)} tone="amber" />
        <Vital label="Last block" value={lastBlockTime ? timeAgo(lastBlockTime) : "—"} />
        <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="size-1.5 rounded-full bg-(--color-up) animate-pulse" /> live
        </span>
      </div>

      {/* happening now — the daily-check row */}
      <div className="grid lg:grid-cols-3 gap-6">
        <NowPanel title="Latest sales" href="/trades">
          {trades.length === 0 ? <Skeleton rows={6} /> : (
            <ul>
              {trades.map((r, i) => (
                <NowRow key={r.tx_hash ?? i} time={r.block_time}
                  left={r.asset ? assetLink(r.asset) : <span className="text-zinc-400">—</span>}
                  meta={<span className="flex items-center gap-1.5"><span className="text-zinc-200 font-mono">{saleValue(r)}</span>{venueChip(r.venue)}</span>} />
              ))}
            </ul>
          )}
        </NowPanel>

        <NowPanel title="Mempool" href="/mempool" live="amber">
          {mempool.length === 0 ? <Empty what="pending actions" /> : (
            <ul>
              {mempool.slice(0, 8).map((m, i) => (
                <NowRow key={m.tx_hash ?? i} time={m.timestamp}
                  left={m.asset ? assetLink(m.asset) : <span className="truncate text-zinc-300">{eventLabel(m.event)}</span>}
                  meta={m.asset ? <span className="text-amber-400/90">{eventLabel(m.event)}</span> : undefined} />
              ))}
            </ul>
          )}
        </NowPanel>

        <NowPanel title="Latest transactions" href="/transactions">
          {txns.length === 0 ? <Skeleton rows={6} /> : (
            <ul>
              {txns.map((t, i) => (
                <NowRow key={t.tx_hash ?? i} time={t.block_time}
                  left={<Link href={`/tx/${t.tx_hash}`} className="font-mono">{short(t.tx_hash)}</Link>}
                  meta={<span className="text-zinc-400">{addrLink(t.source)}</span>} />
              ))}
            </ul>
          )}
        </NowPanel>
      </div>

      {/* featured art — the museum face, curated by quality and ONLY assets with real art (has_media) */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Featured <span className="text-zinc-400 font-normal">— top quality, with art</span></h2>
        {featured.length === 0 ? <Skeleton rows={2} /> : (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {featured.map((a) => (
              <Link key={a.asset} href={`/asset/${a.asset}`} title={a.asset_longname || a.asset} className="group">
                <AssetArt asset={a.asset} className="w-full aspect-[5/7] rounded-lg border border-zinc-800 group-hover:border-(--color-accent) transition-colors" />
                <div className="mt-1 text-[10px] text-zinc-400 truncate group-hover:text-zinc-200">{a.asset_longname || a.asset}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* activity trend — secondary, drawn in accent */}
      <ActivityChart />

      {/* deep cuts — record feeds for browsing */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Feed title="Recently issued" href="/issuances" rows={issuances}
          head={["Asset", { label: "Quantity", numeric: true }, "Issuer"]}
          render={(r, i) => (
            <Row key={i}>
              <Cell primary>{assetLink(r.asset!, r.asset_longname || r.asset)}</Cell>
              <Cell numeric>{commas(r.quantity_normalized)}</Cell>
              <Cell muted>{addrLink(r.issuer)}</Cell>
            </Row>
          )} />
        <Feed title="Dispenses" href="/dispenses" rows={dispenses}
          head={["Asset", { label: "Quantity", numeric: true }, "Buyer"]}
          render={(r, i) => (
            <Row key={i}>
              <Cell primary>{assetLink(r.asset!)}</Cell>
              <Cell numeric>{commas(r.dispense_quantity_normalized)}</Cell>
              <Cell muted>{addrLink(r.destination)}</Cell>
            </Row>
          )} />
        <Feed title="Orders" href="/orders" rows={orders}
          head={["Pair", "Side", { label: "Price", numeric: true }]}
          render={(r, i) => {
            const v = orderView(r);
            return (
              <Row key={i}>
                <Cell primary><Link href={`/asset/${v.base}`} className="flex items-center gap-2"><AssetIcon asset={v.base} size={16} />{v.base}<span className="text-zinc-600">/{v.quote}</span></Link></Cell>
                <Cell><span className={v.direction === "buy" ? "text-(--color-up)" : "text-(--color-down)"}>{v.direction}</span></Cell>
                <Cell numeric>{v.price ? `${v.price >= 1 ? commas(v.price.toFixed(4)) : v.price.toPrecision(3)} ${v.quote}` : "—"}</Cell>
              </Row>
            );
          }} />
        <Feed title="Recent blocks" href="/blocks" rows={blocks.slice(0, 8)}
          head={[{ label: "Block", numeric: true }, "Time", { label: "Txs", numeric: true }]}
          render={(b) => (
            <Row key={b.block_index}>
              <Cell numeric><Link href={`/block/${b.block_index}`}>{commas(b.block_index)}</Link></Cell>
              <Cell muted>{ts(b.block_time)}</Cell>
              <Cell numeric>{commas(b.transaction_count)}</Cell>
            </Row>
          )} />
      </div>

      {/* dispensers — open shops (deep cut) */}
      <Feed title="Dispensers" href="/dispensers" rows={dispensers}
        head={["Asset", { label: "Remaining", numeric: true }, "Source"]}
        render={(r, i) => (
          <Row key={i}>
            <Cell primary>{assetLink(r.asset!)}</Cell>
            <Cell numeric>{commas(r.give_remaining_normalized)}</Cell>
            <Cell muted>{addrLink(r.source)}</Cell>
          </Row>
        )} />
    </>
  );
}
