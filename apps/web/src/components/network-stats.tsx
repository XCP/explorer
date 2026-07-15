"use client";
import useSWR from "swr";
import type { NetworkStats as NetworkStatsPayload } from "@xcp/shared/stats";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card, Stat } from "@/components/ui/card";
import { ActivityChart } from "@/components/activity-chart";
import { commas } from "@/lib/format";
import { useState } from "react";
import { useStats } from "@/lib/hooks";

const COUNT_GROUPS: [string, [keyof NetworkStatsPayload, string][]][] = [
  ["Overview", [["transactions", "Transactions"], ["assets", "Assets"], ["holders", "Balances"]]],
  ["Asset activity", [
    ["issuances", "Issuances"], ["sends", "Sends"], ["dividends", "Dividends"],
    ["destructions", "Destructions"], ["burns", "Burns"], ["sweeps", "Sweeps"],
  ]],
  ["Markets", [
    ["orders", "Orders"], ["order_matches", "Order matches"], ["btcpays", "BTC pays"],
    ["dispensers", "Dispensers"], ["dispenses", "Dispenses"], ["cancels", "Cancels"],
    ["pools", "Pools"], ["pool_matches", "Pool swaps"], ["pool_liquidity", "Liquidity events"],
  ]],
  ["Fair minting", [["fairminters", "Fairminters"], ["fairmints", "Fairmints"]]],
  ["Betting", [
    ["broadcasts", "Broadcasts"], ["bets", "Bets"], ["bet_matches", "Bet matches"],
    ["rps", "RPS games"], ["rps_matches", "RPS matches"],
  ]],
];

// Network stats dashboard — live totals + the activity chart. Client island rendered by the thin
// server page that owns the static metadata.
export function NetworkStats() {
  const [showLowQ, setShowLowQ] = useState(false);
  const { item: live } = useStats();
  const { data } = useSWR<Envelope<NetworkStatsPayload>>(
    apiUrl("/v2/stats", showLowQ ? { include_hidden: 1 } : {}),
  );
  const s = data?.result;
  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Network stats</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Counterparty totals across the whole chain, including its lifetime deflation.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer shrink-0 mt-1">
          <input
            type="checkbox"
            checked={!showLowQ}
            onChange={(event) => setShowLowQ(!event.target.checked)}
            className="accent-(--color-accent) w-3.5 h-3.5"
          />
          Hide low quality
        </label>
      </div>
      {/* deflation headline — XCP is destroyed by fees; this is the lifetime burn */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Stat
          label="XCP destroyed (all-time)"
          value={s?.xcp_destroyed != null ? commas(Math.round(s.xcp_destroyed)) : "—"}
        />
        <Stat label="BTC fees paid (all-time)" value={s?.btc_fees != null ? `${s.btc_fees.toFixed(2)} BTC` : "—"} />
        <Stat label="Tip block" value={commas(live?.tip ?? s?.tip)} />
      </div>
      <ActivityChart includeHidden={showLowQ} />
      <Card title="Counterparty totals">
        <div className="space-y-5">
          {COUNT_GROUPS.map(([group, counts]) => (
            <div key={group}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">{group}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1">
                {counts.map(([key, label]) => (
                  <div key={key} className="flex justify-between gap-3 border-b border-zinc-900 py-2 text-sm">
                    <span className="text-zinc-400">{label}</span>
                    <span className="font-mono text-zinc-200">{commas(s?.[key])}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
