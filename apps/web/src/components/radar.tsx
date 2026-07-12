"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import type { RadarPayload, RadarAsset, BuyableAsset } from "@xcp/shared/radar";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { commas, usdCompact } from "@/lib/format";

type View = "undervalued" | "buyable";
const isBuyable = (r: RadarAsset | BuyableAsset): r is BuyableAsset => "venue" in r;

// BTC with trailing zeros trimmed ("0.00250000" → "0.0025 BTC"). Exact — it's what the buyer pays.
const btc = (n: number) => `${parseFloat(n.toFixed(8))} BTC`;
const venueLabel = (r: BuyableAsset) => (r.venue === "emblem" ? `Emblem${r.marketplace ? ` · ${r.marketplace}` : ""}` : "dispenser");

// The small facts behind the Conviction score, as chips — who holds it and how scarce, in collector terms.
function Chips({ r }: { r: RadarAsset }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500 mt-1">
      <span><span className="text-zinc-300 tabular-nums">{commas(r.holders)}</span> holders</span>
      <span><span className="text-zinc-300 tabular-nums">{commas(r.supply)}</span> supply</span>
      {r.creator_pct >= 10 && <span><span className="text-zinc-300 tabular-nums">{Math.round(r.creator_pct)}%</span> creators</span>}
      {r.holder_dex >= 20 && <span>held by active traders</span>}
      <span className="text-zinc-600">{r.market_usd > 0 ? `top sale ${usdCompact(r.market_usd)}` : "never traded"}</span>
    </div>
  );
}

function Row({ r, i }: { r: RadarAsset | BuyableAsset; i: number }) {
  return (
    <li className="flex items-center gap-3 py-2.5 border-b border-zinc-900 last:border-0">
      <span className="w-5 shrink-0 text-right text-zinc-600 font-mono text-xs tabular-nums">{i + 1}</span>
      <Link href={`/asset/${r.asset}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <AssetIcon asset={r.asset} size={30} />
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/asset/${r.asset}`} className="truncate font-medium text-zinc-200 block">{r.asset_longname || r.asset}</Link>
        <Chips r={r} />
      </div>
      {isBuyable(r) ? (
        r.venue === "emblem" && r.listing_url ? (
          <a href={r.listing_url} target="_blank" rel="noopener noreferrer"
             className="shrink-0 text-right w-28 hover:text-zinc-100"
             aria-label={`Buy ${r.asset_longname || r.asset} on ${venueLabel(r)} for ${usdCompact(r.ask_usd)}`}>
            <div className="font-mono text-sm text-zinc-100 tabular-nums leading-tight">{usdCompact(r.ask_usd)}</div>
            <div className="text-xs text-zinc-500">{venueLabel(r)} ↗</div>
          </a>
        ) : (
          <Link href={`/asset/${r.asset}`} className="shrink-0 text-right w-28 hover:text-zinc-100"
                aria-label={`Buy ${r.asset_longname || r.asset} via dispenser for ${r.ask_btc != null ? btc(r.ask_btc) : usdCompact(r.ask_usd)}`}>
            <div className="font-mono text-sm text-zinc-100 tabular-nums leading-tight">{r.ask_btc != null ? btc(r.ask_btc) : usdCompact(r.ask_usd)}</div>
            <div className="text-xs text-zinc-500 tabular-nums">{usdCompact(r.ask_usd)} · dispenser</div>
          </Link>
        )
      ) : (
        <div className="shrink-0 text-right w-14">
          <div className="font-mono text-base text-(--color-xcp) tabular-nums leading-none">{r.conviction}</div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-wide mt-1">Conviction</div>
        </div>
      )}
    </li>
  );
}

function Segment({ view, setView, buyableCount }: { view: View; setView: (v: View) => void; buyableCount?: number }) {
  const tab = (v: View, label: string, extra?: string) => (
    <button
      type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-xcp) ${
        view === v ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
      }`}>
      {label}{extra && <span className="ml-1.5 text-xs text-zinc-500 tabular-nums">{extra}</span>}
    </button>
  );
  return (
    <div role="tablist" aria-label="Radar view" className="inline-flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
      {tab("undervalued", "Undervalued")}
      {tab("buyable", "Buyable Now", buyableCount != null ? String(buyableCount) : undefined)}
    </div>
  );
}

// Radar — the "undervalued grail" board. Two lenses on one Conviction signal (who holds it + scarcity, no
// market inputs): Undervalued (realized price still low) and Buyable Now (an open dispenser exists right now,
// with its BTC ask). Client island rendered by the thin server page that owns the metadata.
export function Radar() {
  const { data } = useSWR<Envelope<RadarPayload>>(apiUrl("/v2/radar"));
  const [view, setView] = useState<View>("undervalued");
  const d = data?.result;
  const rows: (RadarAsset | BuyableAsset)[] | undefined = d && (view === "buyable" ? d.buyable : d.undervalued);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Radar</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-3xl text-pretty">
          Undervalued grails. We score each asset&rsquo;s <span className="text-zinc-300">Conviction</span> — who
          holds it and how scarce it is (sophisticated holders, proven creators, a small real float, standing in
          the trusted collector network) with <span className="text-zinc-300">no market inputs at all</span>.
          Radar ranks the highest-Conviction assets the market hasn&rsquo;t priced — and flags the ones you can
          buy on-chain right now.
        </p>
      </div>
      <Segment view={view} setView={setView} buyableCount={d?.buyable.length} />
      <Card title={view === "buyable" ? "Buyable Now — Open Dispensers, Ranked by Conviction" : "Highest Conviction, Lowest Realized Price"}>
        {!rows ? (
          <Skeleton rows={10} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">
            {view === "buyable" ? "No high-conviction assets have an open dispenser right now." : "No assets on the radar right now."}
          </p>
        ) : (
          <ol className="text-sm">{rows.map((r, i) => <Row key={r.asset} r={r} i={i} />)}</ol>
        )}
      </Card>
      {view === "buyable" && (
        <p className="text-xs text-zinc-600 max-w-3xl">
          Each row shows the cheapest way to buy right now. A <span className="text-zinc-400">dispenser</span> is
          fixed-price BTC vending on Counterparty — send the ask to the dispenser address and the asset is
          released, no order match. An <span className="text-zinc-400">Emblem</span> ask is a live Ethereum
          listing (via OpenSea &amp; friends) of a vault wrapping the card — you buy the NFT, then crack it to
          redeem the Counterparty asset. Dispenser prices convert at the latest daily BTC rate. Always verify the
          live listing before sending.
        </p>
      )}
    </>
  );
}
