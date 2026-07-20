"use client";
import Link from "next/link";
import useSWR from "swr";
import type { ExchangesPayload } from "@xcp/shared/addresses";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card, Stat } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { Board } from "@/components/board";
import { commas, compact } from "@/lib/format";

// Known CEX wallets + most-deposited assets. Client island rendered by the thin server page that owns
// the static metadata.
const MARKET_COLORS: Record<string, string> = {
  ZAIF: "bg-fuchsia-500/75",
  PEPECASH: "bg-emerald-500/75",
  CICC: "bg-amber-500/75",
  XCP: "bg-sky-500/75",
  BITCRYSTALS: "bg-violet-500/75",
  SJCX: "bg-rose-500/75",
  FLDC: "bg-cyan-500/75",
  DATABITS: "bg-orange-500/75",
  COVALC: "bg-lime-500/75",
  TILECOINX: "bg-teal-500/75",
  GEMZ: "bg-pink-500/75",
  LTBCOIN: "bg-indigo-500/75",
  SCOTCOIN: "bg-yellow-500/75",
  SWARM: "bg-red-500/75",
  TRIGGERS: "bg-blue-500/75",
};

export function ExchangeDirectory() {
  const { data } = useSWR<Envelope<ExchangesPayload>>(apiUrl("/v2/exchanges"));
  const d = data?.result;
  const s = d?.summary;
  const ex = d?.exchanges ?? [];
  const assetHistory = d?.combined_market_history ?? [];
  const marketAssets = d?.combined_market_assets ?? [];
  const history = [...new Set(assetHistory.map((row) => row.year))].map((year) => ({
    year,
    usd_volume: assetHistory.filter((row) => row.year === year).reduce((sum, row) => sum + row.usd_volume, 0),
  }));
  const maxVolume = Math.max(1, ...history.map((row) => row.usd_volume));
  const marketVolume = history.reduce((sum, row) => sum + row.usd_volume, 0);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Exchanges</h1>
        <p className="text-sm text-zinc-400 mt-1">
          The CEX side of Counterparty history — the custody/deposit wallets of the exchanges that listed XCP-era
          tokens, and what flowed onto them.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Known exchange wallets" value={commas(s?.exchanges)} />
        <Stat label="Deposit addresses" value={commas(s?.deposit_addresses)} />
        <Stat label="Operators" value={ex.length ? String(new Set(ex.map((e) => e.name)).size) : "—"} />
      </div>
      <div className="text-sm text-zinc-400">
        Covered historical market volume: <strong className="text-zinc-100">${compact(marketVolume)}</strong>
      </div>
      <Card title="Historical market volume by year and asset">
        {history.length === 0 ? (
          <Skeleton rows={6} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
              {marketAssets.map((row) => (
                <span key={row.asset} className="flex items-center gap-1.5">
                  <i className={`h-2.5 w-2.5 rounded-sm ${MARKET_COLORS[row.asset] ?? "bg-zinc-500"}`} />
                  {row.asset === "ZAIF" ? "ZAIF token" : row.asset}
                </span>
              ))}
            </div>
            {history.map((row) => (
              <div key={row.year} className="grid grid-cols-[3rem_1fr_5rem] items-center gap-3">
                <span className="font-mono text-xs text-zinc-400">{row.year}</span>
                <div className="h-5 overflow-hidden rounded-sm bg-zinc-900">
                  <div className="flex h-full" style={{ width: `${Math.max(1, (100 * row.usd_volume) / maxVolume)}%` }}>
                    {assetHistory
                      .filter((part) => part.year === row.year)
                      .map((part) => (
                        <div
                          key={part.asset}
                          className={MARKET_COLORS[part.asset] ?? "bg-zinc-500"}
                          style={{ width: `${(100 * part.usd_volume) / row.usd_volume}%` }}
                          title={`${part.asset === "ZAIF" ? "ZAIF token" : part.asset}: $${commas(part.usd_volume.toFixed(0))}`}
                        />
                      ))}
                  </div>
                </div>
                <span className="text-right font-mono text-xs text-zinc-300">${compact(row.usd_volume)}</span>
              </div>
            ))}
            <p className="pt-2 text-xs leading-5 text-zinc-500">
              One value per asset and day. CoinMarketCap reported volume is used when available; reconstructed exchange
              executions fill otherwise missing days. The two are never added for the same asset-day. TRIGGERS is
              included as the original Counterparty token: it traded on Binance until October 2018, and the archive
              contains no evidence of a completed migration during this series.
            </p>
          </div>
        )}
      </Card>
      <Card title="Historical volume by asset">
        <div className="divide-y divide-zinc-900 text-sm">
          {marketAssets.map((row) => (
            <div key={row.asset} className="grid grid-cols-[1fr_auto] gap-4 py-2">
              <span className="text-zinc-300">{row.asset === "ZAIF" ? "ZAIF token" : row.asset}</span>
              <span className="text-right font-mono text-xs text-zinc-400">
                ${compact(row.usd_volume)} · {row.first_day}–{row.last_day}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Listings and delistings">
        <div className="space-y-3 text-sm leading-6 text-zinc-400">
          <p>
            The archive contains Zaif executions for XCP, PEPECASH, BITCRYSTALS, SJCX, CICC, and ZAIF. PEPECASH,
            BITCRYSTALS, and SJCX observations end in April 2020. We treat that as the end of the observed series, not
            as proof of a particular legal delisting date.
          </p>
          <p>
            COVALC was announced for Bittrex delisting on May 31, 2019 before migration from Counterparty to Ethereum.
            XCP and CICC have later Zaif observations, while imported Dex-Trade XCP history is sparse. Poloniex and
            Bittrex execution archives are absent, so this is documented coverage rather than total CEX activity.
          </p>
        </div>
      </Card>
      <Card title="Exchange wallets">
        {ex.length === 0 ? (
          <Skeleton rows={8} />
        ) : (
          <div className="text-sm">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[10px] uppercase tracking-wider text-zinc-400 pb-1 border-b border-zinc-800">
              <span>Operator / wallet</span>
              <span className="text-right">Assets</span>
              <span className="text-right">Senders</span>
            </div>
            {ex.map((e) => (
              <div
                key={e.address}
                className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center py-1.5 border-b border-zinc-900 last:border-0"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-zinc-200">{e.name}</span>
                  <Link href={`/address/${e.address}`} className="font-mono text-xs text-zinc-400 break-all">
                    {e.address}
                  </Link>
                </span>
                <span className="text-right font-mono text-zinc-400 text-xs">{commas(e.assets_received)}</span>
                <span className="text-right font-mono text-zinc-400 text-xs">{commas(e.in_peers)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {!d ? (
        <Card title="Most-deposited assets (onto exchanges)">
          <Skeleton rows={6} />
        </Card>
      ) : d.top_assets.length === 0 ? (
        <Card title="Most-deposited assets (onto exchanges)">
          <p className="text-sm text-zinc-500">No exchange-deposit rankings are currently available.</p>
        </Card>
      ) : (
        <Board
          title="Most-deposited assets (onto exchanges)"
          rows={d.top_assets}
          render={(r) => (
            <>
              <Link href={`/asset/${r.asset}`} className="flex items-center gap-2 flex-1 min-w-0">
                <AssetIcon asset={r.asset} size={16} />
                <span className="truncate">{r.asset_longname || r.asset}</span>
              </Link>
              <span className="font-mono text-zinc-400 text-xs shrink-0">{commas(r.depositors)} depositors</span>
            </>
          )}
        />
      )}
    </>
  );
}
