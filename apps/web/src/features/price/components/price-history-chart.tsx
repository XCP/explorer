"use client";
/**
 * The /price hero: twelve years of XCP daily history on a log scale, in three denominations —
 * USD, sats (the chain-native unit), and indexed-vs-BTC (relative performance: did holding XCP
 * beat holding bitcoin since day one). One chart, one mode toggle; linear would flatten everything
 * under the 2018 ATH into a floor line, so every mode is log. Selective direct labels — first
 * print, peak, today — and a crosshair naming the day, the value, and the SOURCE that produced it.
 */
import { useMemo, useRef, useState } from "react";

const W = 1000;
const H = 380;
const PAD = { left: 64, right: 24, top: 26, bottom: 34 };
const MAX_POINTS = 1100; // downsample cap: SVG path points, keeps the DOM light at 12 years of days

type Mode = "usd" | "sats" | "ratio" | "mcap" | "vol";

const SOURCE_LABELS: Record<string, string> = {
  burn_vwm: "genesis burns",
  market_vwm: "on-chain market",
  market_vwm_thin: "on-chain market (thin)",
  dex_vwm: "on-chain DEX",
  coinmarketcap_aggregate: "CMC aggregate",
  zaif_vwm: "Zaif XCP/JPY",
  dextrade_xcpbtc_spot: "Dex-Trade spot",
  coinbase_spot: "Coinbase spot",
};

const MODES: { key: Mode; label: string; title: string }[] = [
  { key: "usd", label: "USD", title: "Daily USD value" },
  { key: "sats", label: "in BTC", title: "Denominated in satoshis — the chain-native unit" },
  { key: "ratio", label: "vs BTC", title: "Relative performance: XCP/BTC indexed to the first day" },
  { key: "mcap", label: "MCAP", title: "Market cap: price × that day's actual supply (burn-grown, fee-shrunk)" },
  {
    key: "vol",
    label: "VOL",
    title: "Attributable executed XCP volume: DEX + dispensers + Zaif + Dex-Trade, days with executions",
  },
];

const fmtUsd = (v: number) => (v >= 100 ? `$${Math.round(v)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);
const fmtSats = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M sats`
    : v >= 1_000
      ? `${Math.round(v / 1_000)}k sats`
      : `${Math.round(v)} sats`;
const fmtRatio = (v: number) => `${v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2)}×`;
const fmtBig = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`;
const fmtXcp = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M XCP` : v >= 1e3 ? `${Math.round(v / 1e3)}k XCP` : `${Math.round(v)} XCP`;

const FMT: Record<Mode, (v: number) => string> = {
  usd: fmtUsd,
  sats: fmtSats,
  ratio: fmtRatio,
  mcap: fmtBig,
  vol: fmtXcp,
};

export function PriceHistoryChart({
  history,
}: {
  history: {
    day: string;
    usd: number;
    source: string;
    btc?: number | null;
    supply?: number | null;
    vol?: number | null;
  }[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("usd");

  const geometry = useMemo(() => {
    // Per-mode value series; each mode drops days missing its inputs (BTC leg, supply, executions).
    const usable = history.filter((p) => {
      if (mode === "usd") return true;
      if (mode === "mcap") return p.supply != null && p.supply > 0;
      if (mode === "vol") return p.vol != null && p.vol > 0;
      return p.btc != null && p.btc > 0;
    });
    const raw = usable.map((p) => {
      if (mode === "usd") return p.usd;
      if (mode === "mcap") return p.usd * p.supply!;
      if (mode === "vol") return p.vol!;
      return (p.usd / p.btc!) * 1e8; // sats per XCP
    });
    const base = mode === "ratio" ? raw[0]! : 1;
    const series = mode === "ratio" ? raw.map((v) => v / base) : raw;
    const fmt = FMT[mode];

    const athIndex = series.reduce((best, v, i) => (v > series[best]! ? i : best), 0);
    const step = Math.max(1, Math.ceil(usable.length / MAX_POINTS));
    const keep = (i: number) => i % step === 0 || i === athIndex || i === usable.length - 1;
    const points = usable.map((p, i) => ({ ...p, value: series[i]! })).filter((_, i) => keep(i));
    const values = points.map((p) => p.value).filter((v) => v > 0);
    const logMin = Math.log10(Math.min(...values));
    const logMax = Math.log10(Math.max(...values) * 1.15);
    const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) =>
      PAD.top + (1 - (Math.log10(Math.max(v, 10 ** logMin)) - logMin) / (logMax - logMin)) * (H - PAD.top - PAD.bottom);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
    const peakIndex = points.reduce((best, p, i) => (p.value > points[best]!.value ? i : best), 0);
    const ticks = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }, i) => i === 0 || (p.day.slice(5, 7) === "01" && p.day.slice(8, 10) <= "07"))
      .filter(({ p }, index, all) => index === 0 || p.day.slice(0, 4) !== all[index - 1]!.p.day.slice(0, 4))
      .map(({ p, i }) => ({ i, label: `'${p.day.slice(2, 4)}` }));
    // Log-decade grid lines that fall inside the visible band, in the mode's own unit.
    const gridValues: number[] = [];
    for (let e = Math.ceil(logMin); e < logMax; e++) gridValues.push(10 ** e);
    return { points, x, y, line, peakIndex, ticks, gridValues, fmt };
  }, [history, mode]);

  if (history.length < 2) return null;
  const { points, x, y, line, peakIndex, ticks, gridValues, fmt } = geometry;
  const last = points.length - 1;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = ((event.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(last, Math.round(((cx - PAD.left) / (W - PAD.left - PAD.right)) * last))));
  };

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.title}
            onClick={() => {
              setMode(m.key);
              setHover(null);
            }}
            className={`rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ring-1 ring-inset transition-colors ${
              mode === m.key
                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                : "bg-white/[0.03] text-zinc-500 ring-white/10 hover:text-zinc-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={MODES.find((m) => m.key === mode)?.title}
        style={{ display: "block", width: "100%", height: "auto" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridValues.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#1c222b" />
            <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#667080" fontFamily="var(--mono)">
              {fmt(v)}
            </text>
          </g>
        ))}
        {mode === "ratio" && (
          <line x1={PAD.left} y1={y(1)} x2={W - PAD.right} y2={y(1)} stroke="#3d4855" strokeDasharray="5 4" />
        )}
        {ticks.map(({ i, label: tick }) => (
          <text key={i} x={x(i)} y={H - 10} fontSize="12" fill="#667080" fontFamily="var(--mono)">
            {tick}
          </text>
        ))}
        <path d={line} fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={H - PAD.bottom} stroke="#3d4855" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover]!.value)} r="5" fill="#16a34a" stroke="#0e1218" strokeWidth="2" />
            <text
              x={x(hover) < W / 2 ? x(hover) + 10 : x(hover) - 10}
              y={Math.max(PAD.top + 12, y(points[hover]!.value) - 12)}
              textAnchor={x(hover) < W / 2 ? "start" : "end"}
              fontSize="13.5"
              fontWeight="600"
              fill="#e7eaee"
              fontFamily="var(--mono)"
            >
              {points[hover]!.day} · {fmt(points[hover]!.value)} ·{" "}
              {SOURCE_LABELS[points[hover]!.source] ?? points[hover]!.source}
            </text>
          </g>
        )}
        {[
          { i: 0, dx: 8, dy: -10, anchor: "start" as const, text: fmt(points[0]!.value) },
          {
            i: peakIndex,
            dx: 8,
            dy: -12,
            anchor: "start" as const,
            text: `peak ${points[peakIndex]!.day} · ${fmt(points[peakIndex]!.value)}`,
          },
          { i: last, dx: -4, dy: 22, anchor: "end" as const, text: fmt(points[last]!.value) },
        ].map((mark) => (
          <g key={mark.i}>
            <circle
              cx={x(mark.i)}
              cy={y(points[mark.i]!.value)}
              r="4.5"
              fill="#16a34a"
              stroke="#0e1218"
              strokeWidth="2"
            />
            <text
              x={x(mark.i) + mark.dx}
              y={y(points[mark.i]!.value) + mark.dy}
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
    </div>
  );
}
