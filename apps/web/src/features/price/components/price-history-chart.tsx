"use client";
/**
 * The /price hero: twelve years of XCP daily USD on a log scale (linear would flatten everything
 * under the 2018 ATH into a floor line). Selective direct labels — first print, ATH, today — and a
 * crosshair tooltip that names the day, the price, and the SOURCE that produced it.
 */
import { useMemo, useRef, useState } from "react";

const W = 1000;
const H = 380;
const PAD = { left: 58, right: 24, top: 26, bottom: 34 };
const MAX_POINTS = 1100; // downsample cap: SVG path points, keeps the DOM light at 12 years of days

const price = (v: number) => (v >= 100 ? `$${Math.round(v)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);

const SOURCE_LABELS: Record<string, string> = {
  burn_vwm: "genesis burns",
  market_vwm: "on-chain market",
  market_vwm_thin: "on-chain market (thin)",
  dex_vwm: "on-chain DEX",
  coinmarketcap_aggregate: "CMC aggregate",
  dextrade_xcpbtc_spot: "Dex-Trade spot",
  coinbase_spot: "Coinbase spot",
};

export function PriceHistoryChart({ history }: { history: { day: string; usd: number; source: string }[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    // Downsample evenly but always keep the all-time high and the latest day.
    const athIndex = history.reduce((best, p, i) => (p.usd > history[best]!.usd ? i : best), 0);
    const step = Math.max(1, Math.ceil(history.length / MAX_POINTS));
    const points = history.filter((_, i) => i % step === 0 || i === athIndex || i === history.length - 1);
    const values = points.map((p) => p.usd).filter((v) => v > 0);
    const logMin = Math.log10(Math.min(...values));
    const logMax = Math.log10(Math.max(...values) * 1.15);
    const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) =>
      PAD.top + (1 - (Math.log10(Math.max(v, 10 ** logMin)) - logMin) / (logMax - logMin)) * (H - PAD.top - PAD.bottom);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.usd).toFixed(1)}`).join(" ");
    const peakIndex = points.reduce((best, p, i) => (p.usd > points[best]!.usd ? i : best), 0);
    const ticks = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }, i) => i === 0 || (p.day.slice(5, 7) === "01" && p.day.slice(8, 10) <= "07"))
      .filter(({ p }, index, all) => index === 0 || p.day.slice(0, 4) !== all[index - 1]!.p.day.slice(0, 4))
      .map(({ p, i }) => ({ i, label: `'${p.day.slice(2, 4)}` }));
    const gridValues = [0.1, 1, 10].filter((v) => Math.log10(v) > logMin && Math.log10(v) < logMax);
    return { points, x, y, line, peakIndex, ticks, gridValues };
  }, [history]);

  if (history.length < 2) return null;
  const { points, x, y, line, peakIndex, ticks, gridValues } = geometry;
  const last = points.length - 1;
  const label = (i: number) => points[i]!.day;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = ((event.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(last, Math.round(((cx - PAD.left) / (W - PAD.left - PAD.right)) * last))));
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="XCP daily USD price since 2014, log scale"
      style={{ display: "block", width: "100%", height: "auto" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {gridValues.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#1c222b" />
          <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" fontSize="13" fill="#667080" fontFamily="var(--mono)">
            ${v >= 1 ? v : v.toFixed(1)}
          </text>
        </g>
      ))}
      {ticks.map(({ i, label: tick }) => (
        <text key={i} x={x(i)} y={H - 10} fontSize="12" fill="#667080" fontFamily="var(--mono)">
          {tick}
        </text>
      ))}
      <path d={line} fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {hover != null && (
        <g pointerEvents="none">
          <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={H - PAD.bottom} stroke="#3d4855" strokeDasharray="3 3" />
          <circle cx={x(hover)} cy={y(points[hover]!.usd)} r="5" fill="#16a34a" stroke="#0e1218" strokeWidth="2" />
          <text
            x={x(hover) < W / 2 ? x(hover) + 10 : x(hover) - 10}
            y={Math.max(PAD.top + 12, y(points[hover]!.usd) - 12)}
            textAnchor={x(hover) < W / 2 ? "start" : "end"}
            fontSize="13.5"
            fontWeight="600"
            fill="#e7eaee"
            fontFamily="var(--mono)"
          >
            {label(hover)} · {price(points[hover]!.usd)} ·{" "}
            {SOURCE_LABELS[points[hover]!.source] ?? points[hover]!.source}
          </text>
        </g>
      )}
      {[
        { i: 0, dx: 8, dy: -10, anchor: "start" as const, text: price(points[0]!.usd) },
        {
          i: peakIndex,
          dx: 8,
          dy: -12,
          anchor: "start" as const,
          text: `ATH ${label(peakIndex)} · ${price(points[peakIndex]!.usd)}`,
        },
        { i: last, dx: -4, dy: 22, anchor: "end" as const, text: price(points[last]!.usd) },
      ].map((mark) => (
        <g key={mark.i}>
          <circle cx={x(mark.i)} cy={y(points[mark.i]!.usd)} r="4.5" fill="#16a34a" stroke="#0e1218" strokeWidth="2" />
          <text
            x={x(mark.i) + mark.dx}
            y={y(points[mark.i]!.usd) + mark.dy}
            textAnchor={mark.anchor}
            fontSize="14"
            fontWeight="600"
            fill="#e7eaee"
            fontFamily="var(--mono)"
          >
            {mark.text}
          </text>
        </g>
      ))}
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#232a34" />
    </svg>
  );
}
