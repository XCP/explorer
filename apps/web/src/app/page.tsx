"use client";
import Link from "next/link";
import { useStats, useBlocks, useIndex, useAssets, useMempool } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { Card, Stat, Table, Row, Cell, Skeleton, Empty, AssetIcon, AssetArt } from "@/components/ui";
import { ActivityChart } from "@/components/activity-chart";
import { SearchBox } from "@/components/search-box";
import { commas, ts, short } from "@/lib/format";
import { orderView } from "@/lib/trading-pair";

function Feed({ title, href, rows, head, render }: { title: string; href: string; rows: any[]; head: any[]; render: (r: any, i: number) => React.ReactNode }) {
  return (
    <Card title={title}>
      <Link href={href} className="absolute right-4 top-4 text-xs !text-zinc-500 hover:!text-zinc-300">View all →</Link>
      {rows.length === 0 ? <Skeleton rows={5} /> : <Table head={head}>{rows.map(render)}</Table>}
    </Card>
  );
}
const assetCell = (asset: string, name?: string) => (
  <Link href={`/asset/${asset}`} className="flex items-center gap-2"><AssetIcon asset={asset} size={16} />{name || asset}</Link>
);

export default function Home() {
  const { item: stats } = useStats();
  const { xcp, xcpChange } = usePrices();
  const { rows: issuances } = useIndex("issuances", 0, 8);
  const { rows: dispenses } = useIndex("dispenses", 0, 8);
  const { rows: orders } = useIndex("orders", 0, 8);
  const { rows: dispensers } = useIndex("dispensers", 0, 8);
  const { rows: blocks } = useBlocks(0, 8);
  const { rows: mempool } = useMempool();
  const { rows: assets } = useAssets(undefined, 0, 14);

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
              <Cell primary>{assetCell(r.asset, r.asset_longname || r.asset)}</Cell>
              <Cell numeric>{commas(r.quantity_normalized)}</Cell>
              <Cell muted><Link href={`/address/${r.issuer}`} className="font-mono">{short(r.issuer)}</Link></Cell>
            </Row>
          )} />
        <Feed title="Dispenses" href="/dispenses" rows={dispenses}
          head={["Asset", { label: "Quantity", numeric: true }, "Buyer"]}
          render={(r, i) => (
            <Row key={i}>
              <Cell primary>{assetCell(r.asset)}</Cell>
              <Cell numeric>{commas(r.dispense_quantity_normalized)}</Cell>
              <Cell muted><Link href={`/address/${r.destination}`} className="font-mono">{short(r.destination)}</Link></Cell>
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
              <Cell primary>{assetCell(r.asset)}</Cell>
              <Cell numeric>{commas(r.give_remaining_normalized)}</Cell>
              <Cell muted><Link href={`/address/${r.source}`} className="font-mono">{short(r.source)}</Link></Cell>
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
              {mempool.slice(0, 8).map((m: any, i: number) => (
                <Row key={`${m.tx_hash ?? "x"}-${i}`}>
                  <Cell muted>{String(m.event || "").toLowerCase().replace(/_/g, " ")}</Cell>
                  <Cell primary>{m.asset ? assetCell(m.asset) : "—"}</Cell>
                  <Cell muted>{m.source ? <Link href={`/address/${m.source}`} className="font-mono">{short(m.source)}</Link> : "—"}</Cell>
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

      {/* art accent */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Latest assets</h2>
        {assets.length === 0 ? <Skeleton rows={2} /> : (
          <div className="flex flex-wrap gap-2">
            {assets.slice(0, 14).map((a: any) => (
              <Link key={a.asset} href={`/asset/${a.asset}`} title={a.asset_longname || a.asset} className="group">
                <AssetArt asset={a.asset} className="w-16 h-16 rounded-lg border border-zinc-800 group-hover:border-[--color-xcp] transition-colors" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
