"use client";
import { useState } from "react";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { AreaChart } from "@/components/ui/charts";

type Point = { t: number; v: number };
const SERIES = [
  ["transactions", "Transactions"],
  ["xcp_burned", "XCP burned"],
  ["btc_fees", "BTC fees"],
] as const;
const RANGES = [
  [90, "90D"],
  [365, "1Y"],
  [1095, "3Y"],
  [1826, "5Y"],
  [3653, "10Y"],
  [5000, "All"],
] as const;
type Key = (typeof SERIES)[number][0];

function monthly(points: Point[]): Point[] {
  const buckets = new Map<number, number>();
  for (const point of points) {
    const date = new Date(point.t * 1000);
    const timestamp = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
    buckets.set(timestamp, (buckets.get(timestamp) ?? 0) + point.v);
  }
  return [...buckets].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
}

export function ActivityChart() {
  const [metric, setMetric] = useState<Key>("transactions");
  const [days, setDays] = useState(365);
  const { data } = useSWR<Envelope<Record<string, Point[]>>>(apiUrl("/v2/metrics", { days, include_hidden: 1 }));
  const grouped = days > 365;
  const series = grouped ? monthly(data?.result?.[metric] ?? []) : (data?.result?.[metric] ?? []);
  const label = SERIES.find(([key]) => key === metric)![1];
  const unit = metric === "btc_fees" ? " BTC" : metric === "xcp_burned" ? " XCP" : "";
  const format = (value: number) =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: metric === "transactions" ? 0 : 2 })}${unit}`;
  const formatDate = grouped
    ? (timestamp: number) =>
        new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(
          timestamp * 1000,
        )
    : undefined;

  return (
    <Card title="Network activity">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1" aria-label="Chart period">
          {RANGES.map(([value, name]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              aria-pressed={days === value}
              className={`rounded-full border px-2.5 py-1 text-xs ${days === value ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="ml-auto text-xs text-zinc-500" htmlFor="activity-metric">
          Metric
        </label>
        <select
          id="activity-metric"
          value={metric}
          onChange={(event) => setMetric(event.target.value as Key)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
        >
          {SERIES.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2 text-xs text-zinc-400">
        {grouped ? "Monthly" : "Daily"} {label.toLowerCase()} · {series.length.toLocaleString()} periods
      </div>
      <AreaChart data={series} height={240} formatValue={format} formatDate={formatDate} />
    </Card>
  );
}
