"use client";
import Link from "next/link";
import type { Route } from "next";
import useSWR from "swr";
import type { NetworkStats as NetworkStatsPayload } from "@xcp/shared/stats";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card, Stat } from "@/components/ui/card";
import { ActivityChart } from "@/components/activity-chart";
import { commas } from "@/lib/format";

type CountKey = Exclude<keyof NetworkStatsPayload, "tip" | "btc_fees" | "btc_fees_complete" | "xcp_destroyed">;
const COUNTS: [CountKey, string, Route?][] = [
  ["assets", "Assets", "/assets"],
  ["sends", "Sends", "/sends"],
  ["orders", "Orders", "/orders"],
  ["issuances", "Issuances", "/issuances"],
  ["order_matches", "Order Matches", "/matches"],
  ["fairmints", "Fairmints", "/fairmints"],
  ["dispenses", "Dispenses", "/dispenses"],
  ["broadcasts", "Broadcasts", "/broadcasts"],
  ["dispensers", "Dispensers", "/dispensers"],
  ["cancels", "Cancels", "/cancels"],
  ["destructions", "Destructions", "/destructions"],
  ["dividends", "Dividends", "/dividends"],
  ["btcpays", "BTC Pays", "/btcpays"],
  ["burns", "Burns", "/burns"],
  ["sweeps", "Sweeps", "/sweeps"],
  ["bets", "Bets", "/bets"],
  ["bet_matches", "Bet Matches", "/bet-matches"],
  ["fairminters", "Fairminters", "/fairminters"],
  ["rps", "RPS Games", "/rps"],
  ["rps_matches", "RPS Matches", "/rps-matches"],
  ["pools", "Pools", "/pools"],
  ["pool_deposits", "Pool Deposits", "/pool-deposits"],
  ["pool_withdrawals", "Pool Withdrawals", "/pool-withdrawals"],
  ["pool_matches", "Pool Matches", "/pool-matches"],
];

// Network stats dashboard — live totals + the activity chart. Client island rendered by the thin
// server page that owns the static metadata.
export function NetworkStats() {
  const { data } = useSWR<Envelope<NetworkStatsPayload>>(apiUrl("/v2/stats"));
  const s = data?.result;
  const counts = s
    ? [...COUNTS].sort(([aKey, aLabel], [bKey, bLabel]) => {
        const difference = Number(s[bKey] ?? 0) - Number(s[aKey] ?? 0);
        return difference || aLabel.localeCompare(bLabel);
      })
    : COUNTS;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Network stats</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Counterparty totals across the whole chain, including its lifetime deflation.
        </p>
      </div>
      {/* deflation headline — XCP is destroyed by fees; this is the lifetime burn */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="hidden sm:block">
          <Stat label="Balances" value={commas(s?.holders)} />
        </div>
        <Stat label="Addresses" value={commas(s?.addresses)} />
        <Stat label="Assets" value={commas(s?.assets)} />
        <Stat
          label="XCP destroyed"
          value={
            s?.xcp_destroyed != null ? (
              <>
                {commas(Math.round(s.xcp_destroyed))} <span className="hidden sm:inline">XCP</span>
              </>
            ) : (
              "—"
            )
          }
        />
        <Stat
          label="BTC fees paid"
          value={
            s?.btc_fees != null ? (
              <>
                {s.btc_fees.toFixed(2)} <span className="hidden sm:inline">BTC</span>
              </>
            ) : (
              "—"
            )
          }
        />
      </div>
      <ActivityChart btcFeesComplete={s?.btc_fees_complete === true} />
      <Card title="Counterparty totals">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1">
          {counts.map(([key, label, href]) => (
            <div key={key} className="flex justify-between gap-3 border-b border-zinc-900 py-2 text-sm">
              {href ? (
                <Link
                  href={href}
                  className="!bg-transparent !text-zinc-400 !no-underline hover:!bg-transparent hover:!text-zinc-400 hover:!no-underline"
                >
                  {label}
                </Link>
              ) : (
                <span className="text-zinc-400">{label}</span>
              )}
              <span className="font-mono text-zinc-200">{commas(s?.[key])}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
