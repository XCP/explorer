"use client";
/**
 * The /price tape: a TradingView-style candle chart (lightweight-charts) over the on-chain daily
 * OHLC — real DEX matches + dispenser executions only. XCP is listed on no TradingView-integrated
 * exchange, so this IS the terminal view for it, with our provenance instead of a widget's. Candle
 * close = the day's volume-weighted median (the calendar's own edge); wicks = volume-weighted
 * 5–95% fill range; open chains from the previous candle. Two denominations (USD, sats), three
 * intervals (D/W/M), volume histogram underneath, log price scale — twelve years spans decades.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  PriceScaleMode,
  type IChartApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { PriceCandlePoint } from "@xcp/shared/prices";
import { trackEvent } from "@/lib/fathom";

const HEIGHT = 380;
const UP = "#16a34a";
const DOWN = "#dc2626";

type Denomination = "usd" | "sats";
type Interval = "d" | "w" | "m";

const DENOMINATIONS: { key: Denomination; label: string; title: string }[] = [
  { key: "usd", label: "USD", title: "Fills × that day's BTC/USD close" },
  { key: "sats", label: "SATS", title: "The chain-native unit — no external feed involved" },
];
const INTERVALS: { key: Interval; label: string; title: string }[] = [
  { key: "d", label: "1D", title: "Daily candles — days without executions are gaps" },
  { key: "w", label: "1W", title: "Weekly candles" },
  { key: "m", label: "1M", title: "Monthly candles" },
];

interface Candle {
  time: Time;
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  fills: number;
}

// ISO Monday of the week containing this UTC day, so weekly buckets match exchange charts.
function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function toCandles(points: PriceCandlePoint[], denomination: Denomination, interval: Interval): Candle[] {
  const bucketOf = (day: string) =>
    interval === "d" ? day : interval === "m" ? `${day.slice(0, 7)}-01` : weekStart(day);
  const out: Candle[] = [];
  for (const point of points) {
    if (denomination === "usd" && point.btc == null) continue;
    const unit = denomination === "usd" ? point.btc! : 1e8;
    const bucket = bucketOf(point.day);
    const last = out[out.length - 1];
    if (last && last.day === bucket) {
      last.high = Math.max(last.high, point.high * unit);
      last.low = Math.min(last.low, point.low * unit);
      last.close = point.close * unit;
      last.volume += point.volume;
      last.fills += point.fills;
    } else {
      out.push({
        time: bucket as Time,
        day: bucket,
        open: point.close * unit, // provisional; chained to the previous close below
        high: point.high * unit,
        low: point.low * unit,
        close: point.close * unit,
        volume: point.volume,
        fills: point.fills,
      });
    }
  }
  for (let i = 0; i < out.length; i++) {
    const candle = out[i];
    if (i > 0) candle.open = out[i - 1].close;
    candle.high = Math.max(candle.high, candle.open, candle.close);
    candle.low = Math.min(candle.low, candle.open, candle.close);
  }
  return out;
}

const fmtPrice = (denomination: Denomination) => (value: number) =>
  denomination === "usd"
    ? value >= 100
      ? `$${Math.round(value)}`
      : value >= 1
        ? `$${value.toFixed(2)}`
        : `$${value.toFixed(4)}`
    : value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M sats`
      : value >= 1_000
        ? `${Math.round(value / 1_000)}k sats`
        : `${Math.round(value)} sats`;

const fmtXcp = (value: number) =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : `${Math.round(value)}`;

export function PriceCandlesChart({ candles: points }: { candles: PriceCandlePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [denomination, setDenomination] = useState<Denomination>("usd");
  const [interval, setIntervalKey] = useState<Interval>("w");
  const [hover, setHover] = useState<Candle | null>(null);

  const candles = useMemo(() => toCandles(points, denomination, interval), [points, denomination, interval]);
  const byTime = useMemo(() => new Map(candles.map((candle) => [candle.day, candle])), [candles]);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;
    chartRef.current?.remove();
    const format = fmtPrice(denomination);
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#667080",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: "#1c222b" }, horzLines: { color: "#1c222b" } },
      rightPriceScale: {
        borderColor: "#232a34",
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      // 2,200 traded days in 1D mode outrun the default 0.5px minimum bar spacing on laptop
      // widths — allow denser packing so fitContent always shows the full tape.
      timeScale: { borderColor: "#232a34", timeVisible: false, minBarSpacing: 0.05 },
      crosshair: {
        vertLine: { color: "#3d4855", width: 1, style: 3, labelBackgroundColor: "#27272a" },
        horzLine: { color: "#3d4855", width: 1, style: 3, labelBackgroundColor: "#27272a" },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceFormat: { type: "custom", formatter: format, minMove: denomination === "usd" ? 0.0001 : 1 },
    });
    series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "custom", formatter: (value: number) => `${fmtXcp(value)} XCP` },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: false });
    volume.setData(
      candles.map((candle) => ({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)",
      })),
    );
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      // Date-string input comes back as a BusinessDay object — normalize either form to yyyy-mm-dd.
      const time = param.time;
      const day =
        typeof time === "string"
          ? time
          : time && typeof time === "object" && "year" in time
            ? `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`
            : null;
      setHover(day ? (byTime.get(day) ?? null) : null);
    });
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, byTime, denomination]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) chartRef.current?.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length < 2) return null;
  const format = fmtPrice(denomination);
  const pill = (active: boolean) =>
    `rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ring-1 ring-inset transition-colors ${
      active
        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
        : "bg-white/[0.03] text-zinc-500 ring-white/10 hover:text-zinc-300"
    }`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {DENOMINATIONS.map((mode) => (
          <button
            key={mode.key}
            type="button"
            title={mode.title}
            onClick={() => {
              setDenomination(mode.key);
              trackEvent(`price tape denom: ${mode.key}`);
            }}
            className={pill(denomination === mode.key)}
          >
            {mode.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {INTERVALS.map((mode) => (
          <button
            key={mode.key}
            type="button"
            title={mode.title}
            onClick={() => {
              setIntervalKey(mode.key);
              setHover(null);
              trackEvent(`price tape interval: ${mode.key}`);
            }}
            className={pill(interval === mode.key)}
          >
            {mode.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">
          {hover
            ? `${hover.day} · O ${format(hover.open)} H ${format(hover.high)} L ${format(hover.low)} C ${format(hover.close)} · ${fmtXcp(hover.volume)} XCP · ${hover.fills} fills`
            : `${candles.length} candles · log scale`}
        </span>
      </div>
      <div ref={containerRef} style={{ height: HEIGHT, width: "100%" }} />
    </div>
  );
}
