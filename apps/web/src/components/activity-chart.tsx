"use client";
import { useState } from "react";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, AreaChart } from "@/components/ui";

const SERIES = [
  ["transactions", "Transactions"], ["issuances", "Issuances"], ["dispenses", "Dispenses"],
  ["btc_fees", "BTC fees"], ["xcp_burned", "XCP burned"],
] as const;
type Key = (typeof SERIES)[number][0];

export function ActivityChart() {
  const [s, setS] = useState<Key>("transactions");
  const [cum, setCum] = useState(false);
  const { data } = useSWR<Envelope<Record<string, { t: number; v: number }[]>>>(apiUrl("/v2/metrics", { days: 90 }));
  let series = data?.result?.[s] ?? [];
  if (cum && series.length) { let run = 0; series = series.map((p) => ({ t: p.t, v: (run += p.v) })); }
  const label = SERIES.find(([k]) => k === s)![1].toLowerCase();
  return (
    <Card title="Network activity">
      <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1">
        {SERIES.map(([k, lbl]) => (
          <button key={k} onClick={() => setS(k)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${s === k ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>{lbl}</button>
        ))}
        <button onClick={() => setCum((v) => !v)} title="Cumulative"
          className={`text-xs px-2 py-0.5 rounded transition-colors ${cum ? "bg-[--color-xcp] text-white" : "text-zinc-500 hover:text-zinc-300 border border-zinc-700"}`}>Σ</button>
      </div>
      <div className="text-xs text-zinc-500 mb-2">{cum ? "Cumulative" : "Daily"} {label} · last {series.length} days indexed</div>
      <AreaChart data={series} height={200} />
    </Card>
  );
}
