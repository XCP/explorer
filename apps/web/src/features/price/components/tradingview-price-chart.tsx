"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, HistogramSeries, type Time } from "lightweight-charts";

type TradingViewPricePoint = { day: string; usd: number; vol?: number | null };

export function TradingViewPriceChart({ history }: { history: TradingViewPricePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || history.length === 0) return;
    const chart = createChart(container, {
      autoSize: true,
      height: 440,
      layout: { background: { type: ColorType.Solid, color: "#0e1218" }, textColor: "#71717a", attributionLogo: true },
      grid: { vertLines: { color: "#191e27" }, horzLines: { color: "#191e27" } },
      crosshair: {
        vertLine: { color: "#52525b", labelBackgroundColor: "#27272a" },
        horzLine: { color: "#52525b", labelBackgroundColor: "#27272a" },
      },
      rightPriceScale: { borderColor: "#27272a" },
      // 12½ years of daily points: the default 0.5px minimum bar spacing makes fitContent clip
      // the series to the last ~5 years; allow denser packing so the whole history fits.
      timeScale: { borderColor: "#27272a", timeVisible: false, minBarSpacing: 0.05 },
      localization: {
        priceFormatter: (value: number) =>
          value >= 100 ? `$${value.toFixed(0)}` : value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`,
      },
    });
    const price = chart.addSeries(AreaSeries, {
      lineColor: "#22c55e",
      topColor: "rgba(34, 197, 94, 0.28)",
      bottomColor: "rgba(34, 197, 94, 0.01)",
      lineWidth: 2,
      priceScaleId: "right",
    });
    price.setData(history.map((point) => ({ time: point.day as Time, value: point.usd })));
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      color: "rgba(113, 113, 122, 0.45)",
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      history
        .filter((point) => point.vol != null && point.vol > 0)
        .map((point) => ({ time: point.day as Time, value: point.vol!, color: "rgba(113, 113, 122, 0.45)" })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [history]);
  return <div ref={containerRef} className="h-[440px] w-full" aria-label="Interactive XCP price chart" />;
}
