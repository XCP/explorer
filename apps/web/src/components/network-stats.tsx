"use client";
import Link from "next/link";
import type { Route } from "next";
import useSWR from "swr";
import type { NetworkStats as NetworkStatsPayload } from "@xcp/shared/stats";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card, Stat } from "@/components/ui/card";
import { ActivityChart } from "@/components/activity-chart";
import { commas } from "@/lib/format";

// Fixed by lifetime volume so the most-used protocol surfaces scan first without the UI
// reshuffling as totals update.
const COUNTS: [keyof NetworkStatsPayload, string, Route?][] = [
  ["transactions", "Transactions", "/transactions"], ["sends", "Sends", "/sends"], ["holders", "Balances"],
  ["orders", "Orders", "/orders"], ["issuances", "Issuances", "/issuances"], ["assets", "Assets", "/assets"],
  ["order_matches", "Order Matches", "/matches"], ["fairmints", "Fairmints", "/fairmints"],
  ["dispenses", "Dispenses", "/dispenses"], ["broadcasts", "Broadcasts", "/broadcasts"],
  ["dispensers", "Dispensers", "/dispensers"], ["cancels", "Cancels"],
  ["destructions", "Destructions", "/destructions"], ["dividends", "Dividends", "/dividends"],
  ["btcpays", "BTC Pays", "/btcpays"], ["burns", "Burns", "/burns"], ["sweeps", "Sweeps", "/sweeps"],
  ["bets", "Bets", "/bets"], ["bet_matches", "Bet Matches"], ["fairminters", "Fairminters", "/fairminters"],
  ["rps", "RPS Games"],
  ["rps_matches", "RPS Matches"], ["pools", "Pools"], ["pool_deposits", "Pool Deposits"],
  ["pool_withdrawals", "Pool Withdrawals"], ["pool_matches", "Pool Matches"],
];

// Network stats dashboard — live totals + the activity chart. Client island rendered by the thin
// server page that owns the static metadata.
export function NetworkStats() {
  const { data } = useSWR<Envelope<NetworkStatsPayload>>(
    apiUrl("/v2/stats", { include_hidden: 1 }),
  );
  const s = data?.result;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Network stats</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Counterparty totals across the whole chain, including its lifetime deflation.
        </p>
      </div>
      {/* deflation headline — XCP is destroyed by fees; this is the lifetime burn */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Stat
          label="XCP destroyed (all-time)"
          value={s?.xcp_destroyed != null ? commas(Math.round(s.xcp_destroyed)) : "—"}
        />
        <Stat label="BTC fees paid (all-time)" value={s?.btc_fees != null ? `${s.btc_fees.toFixed(2)} BTC` : "—"} />
        <Stat label="Assets" value={commas(s?.assets)} />
      </div>
      <ActivityChart />
      <Card title="Counterparty totals">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1">
          {COUNTS.map(([key, label, href]) => (
            <div key={key} className="flex justify-between gap-3 border-b border-zinc-900 py-2 text-sm">
              {href ? (
                <Link href={href} className="text-zinc-400 hover:text-(--color-accent) transition-colors">
                  {label}
                </Link>
              ) : <span className="text-zinc-400">{label}</span>}
              <span className="font-mono text-zinc-200">{commas(s?.[key])}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
