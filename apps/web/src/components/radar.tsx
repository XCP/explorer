"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import type {
  AssetEmergencePayload,
  AvailableAsset,
  EmergenceEvidence,
  EmergingAsset,
  RadarAsset,
  RadarPayload,
} from "@xcp/shared/radar";
import { AssetIcon } from "@/components/ui/badges";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { commas, usdCompact } from "@/lib/format";
import { assetHref } from "@/lib/asset-link";

type View = "emerging" | "fresh" | "established" | "available";
const isAvailable = (row: RadarAsset | AvailableAsset): row is AvailableAsset => "venue" in row;

function EmergenceRow({ row, rank }: { row: EmergenceEvidence | EmergingAsset; rank?: number }) {
  const emerging = "market_formation" in row;
  return (
    <li className="flex items-center gap-3 border-b border-zinc-900 py-2.5 last:border-0">
      <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600">{rank ?? "·"}</span>
      <Link href={assetHref(row.asset, row.asset_longname)} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <AssetIcon asset={row.asset} size={30} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={assetHref(row.asset, row.asset_longname)} className="block truncate font-medium text-zinc-200">
          {row.asset_longname || row.asset}
        </Link>
        <div className="mt-1 text-xs text-zinc-500">
          <span className="text-zinc-300">{row.reason}</span> · {commas(row.holders)} holders · {commas(row.supply)}{" "}
          supply
        </div>
      </div>
      <div className="w-20 shrink-0 text-right">
        <div
          className={`font-mono leading-none tabular-nums ${emerging ? "text-base text-(--color-xcp)" : "text-sm text-zinc-300"}`}
        >
          {emerging ? row.market_formation : `Day ${row.age_days}`}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
          {emerging ? "Formation" : "Preliminary"}
        </div>
      </div>
    </li>
  );
}

function EstablishedRow({ row, rank }: { row: RadarAsset | AvailableAsset; rank: number }) {
  return (
    <li className="flex items-center gap-3 border-b border-zinc-900 py-2.5 last:border-0">
      <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-600">{rank}</span>
      <Link href={assetHref(row.asset, row.asset_longname)} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <AssetIcon asset={row.asset} size={30} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={assetHref(row.asset, row.asset_longname)} className="block truncate font-medium text-zinc-200">
          {row.asset_longname || row.asset}
        </Link>
        <div className="mt-1 text-xs text-zinc-500">
          {commas(row.holders)} holders · {commas(row.supply)} supply
          {row.market_usd > 0 && ` · top sale ${usdCompact(row.market_usd)}`}
        </div>
      </div>
      <div className="w-24 shrink-0 text-right">
        <div className="font-mono text-sm tabular-nums text-zinc-100">
          {isAvailable(row)
            ? row.ask_btc != null
              ? `${parseFloat(row.ask_btc.toFixed(8))} BTC`
              : usdCompact(row.ask_usd)
            : row.conviction}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-600">
          {isAvailable(row) ? row.venue : "Conviction"}
        </div>
      </div>
    </li>
  );
}

function Tabs({
  view,
  setView,
  counts,
}: {
  view: View;
  setView: (view: View) => void;
  counts: Partial<Record<View, number>>;
}) {
  const labels: Record<View, string> = {
    emerging: "Emerging",
    fresh: "Fresh",
    established: "Established",
    available: "Available",
  };
  return (
    <div
      role="tablist"
      aria-label="Radar view"
      className="inline-flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
    >
      {(Object.keys(labels) as View[]).map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={view === item}
          onClick={() => setView(item)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-xcp) ${view === item ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          {labels[item]}
          {counts[item] != null && <span className="ml-1.5 text-xs tabular-nums text-zinc-500">{counts[item]}</span>}
        </button>
      ))}
    </div>
  );
}

export function Radar() {
  const { data: emergenceData } = useSWR<Envelope<AssetEmergencePayload>>(apiUrl("/v2/radar/emergence"));
  const { data: establishedData } = useSWR<Envelope<RadarPayload>>(apiUrl("/v2/radar"));
  const [view, setView] = useState<View>("emerging");
  const emergence = emergenceData?.result;
  const established = establishedData?.result;
  const earlyRows = view === "emerging" ? emergence?.emerging : view === "fresh" ? emergence?.fresh : undefined;
  const olderRows =
    view === "established" ? established?.established : view === "available" ? established?.available : undefined;
  const loading = view === "emerging" || view === "fresh" ? !emergence : !established;
  const titles: Record<View, string> = {
    emerging: "Emerging Markets",
    fresh: "Fresh Launches",
    established: "Established Holder Conviction",
    available: "Available Now",
  };
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Radar</h1>
        <p className="mt-1 max-w-3xl text-pretty text-sm text-zinc-400">
          Explore early market formation, recent launches, established holder evidence, and assets currently available
          on-chain. Signals describe observable activity; they are not estimates of value or future returns.
        </p>
      </div>
      <Tabs
        view={view}
        setView={setView}
        counts={{
          emerging: emergence?.emerging.length,
          fresh: emergence?.fresh.length,
          established: established?.established.length,
          available: established?.available.length,
        }}
      />
      <Card title={titles[view]}>
        {loading ? (
          <Skeleton rows={10} />
        ) : (earlyRows?.length ?? olderRows?.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No assets match this lens right now.</p>
        ) : earlyRows ? (
          <ol className="text-sm">
            {earlyRows.map((row, index) => (
              <EmergenceRow key={row.asset} row={row} rank={view === "emerging" ? index + 1 : undefined} />
            ))}
          </ol>
        ) : (
          <ol className="text-sm">
            {olderRows?.map((row, index) => (
              <EstablishedRow key={row.asset} row={row} rank={index + 1} />
            ))}
          </ol>
        )}
      </Card>
      {(view === "emerging" || view === "fresh") && (
        <p className="max-w-3xl text-xs text-zinc-600">
          Fresh covers days 7–29 and is preliminary. Emerging ranks days 30–89 by distinct non-self buyers and active
          trading days observed during the first 30 days. Fairmint participation is supporting evidence and does not
          affect the rank. Model {emergence?.model ?? "new-radar-2026-07"}.{" "}
          <a
            href="https://github.com/XCP/explorer/blob/main/docs/new-radar-model.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200"
          >
            Methodology ↗
          </a>
        </p>
      )}
    </>
  );
}
