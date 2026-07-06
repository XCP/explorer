"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import useSWR from "swr";
import type { DispenseRow, DispenserRow, IssuanceRow, OrderRow } from "@xcp/shared/records";
import type { FeaturedAsset } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api";
import { useStats, useBlocks, useIndex, useMempool } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { Card, Stat } from "@/components/ui/card";
import { Table, Row, Cell, type Head } from "@/components/ui/table";
import { Skeleton, Empty } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { AssetArt } from "@/components/asset-art";
import { ActivityChart } from "@/components/activity-chart";
import { SearchBox } from "@/components/search-box";
import { commas, ts } from "@/lib/format";
import { orderView } from "@/lib/trading-pair";

function Feed<T>({ title, href, rows, head, render }: { title: string; href: string; rows: T[]; head: Head[]; render: (r: T, i: number) => ReactNode }) {
  return (
    <Card title={title}>
      <Link href={href} className="absolute right-4 top-4 text-xs !text-zinc-500 hover:!text-zinc-300">View all →</Link>
      {rows.length === 0 ? <Skeleton rows={5} /> : <Table head={head}>{rows.map(render)}</Table>}
    </Card>
  );
}
const assetCell = (asset: string, name?: string | null) => (
  <Link href={`/asset/${asset}`} className="flex items-center gap-2"><AssetIcon asset={asset} size={16} />{name || asset}</Link>
);

export default function Home() {
  const { item: stats } = useStats();
  const { xcp, xcpChange } = usePrices();
  const { rows: issuances } = useIndex<IssuanceRow>("issuances", 0, 8);
  const { rows: dispenses } = useIndex<DispenseRow>("dispenses", 0, 8);
  const { rows: orders } = useIndex<OrderRow>("orders", 0, 8);
  const { rows: dispensers } = useIndex<DispenserRow>("dispensers", 0, 8);
  const { rows: blocks } = useBlocks(0, 8);
  const { rows: mempool } = useMempool();
  // Featured = top-quality assets that actually have art (has_media). 12-wide grid; only real art shows.
  const { data: featuredData } = useSWR<Envelope<FeaturedAsset[]>>(apiUrl("/v2/featured?limit=12"));
  const featured = featuredData?.result ?? [];

  return (
    <>
      {/* search hero */}
      <section className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-zinc-950 px-5 py-8 sm:py-12 text-center">
        <h1 className="text-xl sm:text-2xl font-semibold text-zinc-100">The Counterparty <span className="text-[--color-xcp]">Blockchain Explorer</span></h1>
        <p className="text-sm text-zinc-500 mt-1.5">Assets, addresses, blocks &amp; transactions — on Bitcoin since 2014.</p>
        <div className="mt-5 max-w-2xl mx-auto"><SearchBox big /></div>
      </section>

      {/* pulse — lead with XCP price (the first thing you look at) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <div className="text-xs text-zinc-500">XCP Price</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-semibold font-mono text-zinc-100">{xcp != null ? `$${xcp.toFixed(2)}` : "—"}</span>
            {xcpChange != null && <span className={`text-xs font-mono ${xcpChange >= 0 ? "text-green-500" : "text-red-500"}`}>{xcpChange >= 0 ? "+" : ""}{xcpChange.toFixed(2)}%</span>}
          </div>
        </div>
        <Stat label="Tip block" value={commas(stats?.tip)} />
        <Stat label="Assets" value={commas(stats?.assets)} />
        <Stat label="Transactions" value={commas(stats?.transactions)} />
      </div>

      {/* network activity — daily time-series with series toggle */}
      <ActivityChart />

      {/* your workflow: recently issued + dispenses (the interesting one) */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Feed title="Recently issued" href="/issuances" rows={issuances}
          head={["Asset", { label: "Quantity", numeric: true }, "Issuer"]}
          render={(r, i) => (
            <Row key={i}>
              <Cell primary>{assetCell(r.asset!, r.asset_longname || r.asset)}</Cell>
              <Cell numeric>{commas(r.quantity_normalized)}</Cell>
              <Cell muted><Link href={`/address/${r.issuer}`} className="font-mono">{r.issuer}</Link></Cell>
            </Row>
          )} />
        <Feed title="Dispenses" href="/dispenses" rows={dispenses}
          head={["Asset", { label: "Quantity", numeric: true }, "Buyer"]}
          render={(r, i) => (
            <Row key={i}>
              <Cell primary>{assetCell(r.asset!)}</Cell>
              <Cell numeric>{commas(r.dispense_quantity_normalized)}</Cell>
              <Cell muted><Link href={`/address/${r.destination}`} className="font-mono">{r.destination}</Link></Cell>
            </Row>
          )} />
      </div>

      {/* orders + dispensers */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Feed title="Orders" href="/orders" rows={orders}
          head={["Pair", "Side", { label: "Price", numeric: true }]}
          render={(r, i) => {
            const v = orderView(r);
            return (
              <Row key={i}>
                <Cell primary><Link href={`/asset/${v.base}`} className="flex items-center gap-2"><AssetIcon asset={v.base} size={16} />{v.base}<span className="text-zinc-600">/{v.quote}</span></Link></Cell>
                <Cell><span className={v.direction === "buy" ? "text-green-400" : "text-red-400"}>{v.direction}</span></Cell>
                <Cell numeric>{v.price ? `${v.price >= 1 ? commas(v.price.toFixed(4)) : v.price.toPrecision(3)} ${v.quote}` : "—"}</Cell>
              </Row>
            );
          }} />
        <Feed title="Dispensers" href="/dispensers" rows={dispensers}
          head={["Asset", { label: "Remaining", numeric: true }, "Source"]}
          render={(r, i) => (
            <Row key={i}>
              <Cell primary>{assetCell(r.asset!)}</Cell>
              <Cell numeric>{commas(r.give_remaining_normalized)}</Cell>
              <Cell muted><Link href={`/address/${r.source}`} className="font-mono">{r.source}</Link></Cell>
            </Row>
          )} />
      </div>

      {/* what's happening now: pending mempool + confirmed blocks */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Pending — mempool">
          <span className="absolute right-4 top-4 flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="size-1.5 rounded-full bg-green-500 animate-pulse" /> live
          </span>
          {mempool.length === 0 ? <Empty what="pending transactions" /> : (
            <Table head={["Type", "Asset", "Source"]}>
              {mempool.slice(0, 8).map((m, i) => (
                <Row key={`${m.tx_hash ?? "x"}-${i}`}>
                  <Cell muted>{String(m.event || "").toLowerCase().replace(/_/g, " ")}</Cell>
                  <Cell primary>{m.asset ? assetCell(m.asset) : "—"}</Cell>
                  <Cell muted>{m.source ? <Link href={`/address/${m.source}`} className="font-mono">{m.source}</Link> : "—"}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
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

      {/* featured — curated by quality, and ONLY assets with real art (has_media). 12-wide. The card
          aspect box (5:7) suits the collection: ~40% is portrait card art, ~50% square — object-contain
          (in AssetArt) shows the whole image either way, letterboxed on the dark bg, never cropped. */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Featured <span className="text-zinc-600 font-normal">— top quality, with art</span></h2>
        {featured.length === 0 ? <Skeleton rows={2} /> : (
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {featured.map((a) => (
              <Link key={a.asset} href={`/asset/${a.asset}`} title={a.asset_longname || a.asset} className="group">
                <AssetArt asset={a.asset} className="w-full aspect-[5/7] rounded-lg border border-zinc-800 group-hover:border-[--color-xcp] transition-colors" />
                <div className="mt-1 text-[10px] text-zinc-500 truncate group-hover:text-zinc-300">{a.asset_longname || a.asset}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
