"use client";
import { useState } from "react";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { AreaChart } from "@/components/ui/charts";

const SERIES = [
  ["transactions", "Counterparty transactions"],
  ["bitcoin_transactions", "Bitcoin transactions"],
  ["xcp_share", "Counterparty share"],
  ["issuances", "Issuances"],
  ["trades", "Trades"],
  ["dispenses", "Dispenses"],
  ["sends", "Sends"],
  ["btc_fees", "BTC fees"],
  ["xcp_burned", "XCP burned"],
] as const;
const RANGES = [
  [90, "90 days"],
  [365, "1 year"],
  [1095, "3 years"],
  [1826, "5 years"],
  [3653, "10 years"],
  [5000, "All"],
] as const;
type Key = (typeof SERIES)[number][0];

export function ActivityChart() {
  const [metric, setMetric] = useState<Key>("transactions");
  const [days, setDays] = useState(365);
  const [cumulative, setCumulative] = useState(false);
  const { data } = useSWR<Envelope<Record<string, { t: number; v: number }[]>>>(
    apiUrl("/v2/metrics", { days, include_hidden: 1 }),
  );
  let series = data?.result?.[metric] ?? [];
  if (cumulative && series.length) {
    let running = 0;
    series = series.map((point) => ({ ...point, v: (running += point.v) }));
  }
  const label = SERIES.find(([key]) => key === metric)![1];
  const unit = metric === "xcp_share" ? "%" : metric === "btc_fees" ? " BTC" : metric === "xcp_burned" ? " XCP" : "";
  const format = (value: number) =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: metric === "xcp_share" ? 4 : 2 })}${unit}`;

  return (
    <Card title="Network activity">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-zinc-500" htmlFor="activity-metric">
          Metric
        </label>
        <select
          id="activity-metric"
          value={metric}
          onChange={(event) => {
            setMetric(event.target.value as Key);
            setCumulative(false);
          }}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
        >
          {SERIES.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <label className="ml-auto text-xs text-zinc-500" htmlFor="activity-range">
          Range
        </label>
        <select
          id="activity-range"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
        >
          {RANGES.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCumulative((value) => !value)}
          className={`rounded border px-2 py-1 text-xs ${cumulative ? "border-sky-500/50 bg-sky-400/10 text-sky-300" : "border-zinc-800 text-zinc-400 hover:text-zinc-200"}`}
        >
          Cumulative
        </button>
      </div>
      <div className="mb-2 text-xs text-zinc-400">
        {cumulative ? "Cumulative" : "Daily"} {label.toLowerCase()} · {series.length.toLocaleString()} days
      </div>
      <AreaChart data={series} height={240} formatValue={format} />
    </Card>
  );
}
