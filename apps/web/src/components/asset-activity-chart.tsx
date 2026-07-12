"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, HistogramSeries, type IChartApi, type Time, ColorType } from "lightweight-charts";
import type { AssetActivityMonth } from "@xcp/shared/assets";

// The asset's on-chain life as a stacked monthly histogram (lightweight-charts). Four toggleable layers cover
// EVERY event kind, rolled into the mediums people think in: Sends (transfers), Orders (the DEX = matches +
// orders opened), Dispensers (BTC vending = dispenses + dispensers opened), Supply (issuances + fairmints +
// destructions + dividends). Category colours use our tokens — amber/sky/violet/zinc, never green (reserved
// for market up) — so nothing reads as a price signal. Data arrives pre-aggregated by month from the API.
const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid as const, color: "transparent" }, textColor: "#52525b", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 },
  grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
  rightPriceScale: { borderColor: "#27272a", scaleMargins: { top: 0.1, bottom: 0.05 } },
  timeScale: { borderColor: "#27272a", timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
  handleScroll: true,
  handleScale: true,
  crosshair: {
    vertLine: { color: "#3f3f46", width: 1 as const, style: 3 as const, labelBackgroundColor: "#27272a" },
    horzLine: { color: "#3f3f46", width: 1 as const, style: 3 as const, labelBackgroundColor: "#27272a" },
  },
} as const;

type Layer = "sends" | "orders" | "dispensers" | "supply";
const LAYERS: Layer[] = ["sends", "orders", "dispensers", "supply"]; // stack order, bottom → top
const COLORS: Record<Layer, string> = { sends: "#fbbf24", orders: "#38bdf8", dispensers: "#a78bfa", supply: "#a1a1aa" };
const LABELS: Record<Layer, string> = { sends: "Sends", orders: "Orders", dispensers: "Dispensers", supply: "Supply" };

interface Bucket { time: Time; sends: number; orders: number; dispensers: number; supply: number }

// Fill the calendar between the first and last active month so gaps read as gaps, not compressed bars.
function toBuckets(data: AssetActivityMonth[]): Bucket[] {
  if (data.length === 0) return [];
  const by = new Map(data.map((d) => [d.month, d]));
  const months = data.map((d) => d.month).sort();
  const [sy, sm] = months[0].split("-").map(Number);
  const [ey, em] = months[months.length - 1].split("-").map(Number);
  const out: Bucket[] = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const d = by.get(`${y}-${String(m).padStart(2, "0")}`);
    out.push({
      time: Math.floor(Date.UTC(y, m - 1, 1) / 1000) as Time,
      sends: d?.sends ?? 0, orders: d?.orders ?? 0, dispensers: d?.dispensers ?? 0, supply: d?.supply ?? 0,
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// cumulative bottom→top stacks over the visible layers (a HistogramSeries per layer, tallest drawn first)
function buildStackedData(buckets: Bucket[], visible: Record<Layer, boolean>) {
  const active = LAYERS.filter((l) => visible[l]);
  return active.map((_, layerIdx) => buckets.map((d) => {
    let val = 0;
    for (let i = 0; i <= layerIdx; i++) val += d[active[i]];
    return { time: d.time, value: val, color: COLORS[active[layerIdx]] };
  }));
}

const HEIGHT = 360;

export function AssetActivityChart({ data }: { data: AssetActivityMonth[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [visible, setVisible] = useState<Record<Layer, boolean>>({ sends: true, orders: true, dispensers: true, supply: true });
  const toggle = (l: Layer) => setVisible((p) => ({ ...p, [l]: !p[l] }));

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    chartRef.current?.remove();
    const chart = createChart(containerRef.current, { ...CHART_OPTIONS, width: containerRef.current.clientWidth, height: HEIGHT });
    const stacks = buildStackedData(toBuckets(data), visible);
    for (let i = stacks.length - 1; i >= 0; i--) {
      const series = chart.addSeries(HistogramSeries, { priceFormat: { type: "custom", formatter: (v: number) => v.toLocaleString() }, priceScaleId: "right", lastValueVisible: false, priceLineVisible: false });
      series.setData(stacks[i]);
    }
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, [data, visible]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) chartRef.current?.applyOptions({ width: e.contentRect.width }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = data.reduce((a, d) => ({ sends: a.sends + d.sends, orders: a.orders + d.orders, dispensers: a.dispensers + d.dispensers, supply: a.supply + d.supply }), { sends: 0, orders: 0, dispensers: 0, supply: 0 });
  const total = totals.sends + totals.orders + totals.dispensers + totals.supply;

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-[var(--border2)]">
        <span className="text-xs text-zinc-500">Activity over time</span>
        {LAYERS.filter((k) => totals[k] > 0).map((k) => (
          <button key={k} onClick={() => toggle(k)} className={`flex items-center gap-1 cursor-pointer ${visible[k] ? "" : "opacity-30"}`}>
            <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: COLORS[k] }} />
            <span className="text-[10px] text-zinc-500">{LABELS[k]}</span>
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-zinc-600">{total.toLocaleString()} events</span>
      </div>
      <div ref={containerRef} style={{ height: HEIGHT, width: "100%" }} />
    </div>
  );
}
