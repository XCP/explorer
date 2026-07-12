"use client";
import useSWR from "swr";
import type { NetworkStats as NetworkStatsPayload } from "@xcp/shared/stats";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card, Stat } from "@/components/ui/card";
import { ActivityChart } from "@/components/activity-chart";
import { commas } from "@/lib/format";

const COUNTS: [keyof NetworkStatsPayload, string][] = [
  ["transactions", "Transactions"],
  ["assets", "Assets"],
  ["sends", "Sends"],
  ["issuances", "Issuances"],
  ["orders", "Orders"],
  ["order_matches", "Order matches"],
  ["dispensers", "Dispensers"],
  ["dispenses", "Dispenses"],
  ["sweeps", "Sweeps"],
  ["broadcasts", "Broadcasts"],
  ["dividends", "Dividends"],
  ["fairmints", "Fairmints"],
  ["destructions", "Destructions"],
  ["holders", "Balances"],
];

// Network stats dashboard — live totals + the activity chart. Client island rendered by the thin
// server page that owns the static metadata.
export function NetworkStats() {
  const { data } = useSWR<Envelope<NetworkStatsPayload>>(apiUrl("/v2/stats"));
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
        <Stat label="Tip block" value={commas(s?.tip)} />
      </div>
      <ActivityChart />
      <Card title="Counterparty totals">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1">
          {COUNTS.map(([k, label]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-zinc-900 py-2 text-sm">
              <span className="text-zinc-400">{label}</span>
              <span className="font-mono text-zinc-200">{commas(s?.[k])}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
