"use client";
/**
 * The year page's hero chart: XCP daily USD closes with a crosshair tooltip. Direct labels mark
 * only the open, the year high, and the close (selective labeling — never a number per point).
 */
import { useMemo, useRef, useState } from "react";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const W = 1000;
const H = 400;
const PAD = { left: 56, right: 24, top: 26, bottom: 34 };

const price = (v: number) => (v >= 100 ? `$${Math.round(v)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);

export function YearPriceChart({ daily }: { daily: [string, number][] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const values = daily.map(([, usd]) => usd);
    const peak = Math.max(...values);
    const yMax = peak * 1.12;
    const x = (i: number) => PAD.left + (i / (daily.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
    const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const area = `${line} L${x(daily.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
    const peakIndex = values.indexOf(peak);
    // Month tick positions from the actual dates, so leap years and partial years stay honest.
    const ticks = daily
      .map(([day], i) => ({ day, i }))
      .filter(({ day }, i) => i === 0 || day.slice(8, 10) === "01")
      .map(({ day, i }) => ({ i, label: MONTHS[Number(day.slice(5, 7)) - 1]! }));
    const gridValues =
      peak > 20
        ? [10, 20, 30].filter((v) => v < yMax)
        : peak > 2
          ? [1, 5, 10].filter((v) => v < yMax)
          : [0.5, 1, 1.5].filter((v) => v < yMax);
    return { values, x, y, line, area, peakIndex, ticks, gridValues };
  }, [daily]);

  if (daily.length < 2) return null;
  const { values, x, y, line, area, peakIndex, ticks, gridValues } = geometry;
  const last = daily.length - 1;
  const labelFor = (i: number) => {
    const [day] = daily[i]!;
    return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
  };

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = ((event.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((cx - PAD.left) / (W - PAD.left - PAD.right)) * last)));
    setHover(i);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="XCP daily USD price through the year"
      style={{ display: "block", width: "100%", height: "auto" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="yr-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16a34a" stopOpacity=".28" />
          <stop offset="1" stopColor="#16a34a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridValues.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#1c222b" />
          <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" fontSize="13" fill="#667080" fontFamily="var(--mono)">
            ${v}
          </text>
        </g>
      ))}
      {ticks.map(({ i, label }) => (
        <text key={i} x={x(i)} y={H - 10} fontSize="12" fill="#667080" fontFamily="var(--mono)">
          {label}
        </text>
      ))}
      <path d={area} fill="url(#yr-fade)" />
      <path d={line} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {hover != null && (
        <g pointerEvents="none">
          <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={H - PAD.bottom} stroke="#3d4855" strokeDasharray="3 3" />
          <circle cx={x(hover)} cy={y(values[hover]!)} r="5" fill="#16a34a" stroke="#0e1218" strokeWidth="2" />
          <text
            x={x(hover) < W / 2 ? x(hover) + 10 : x(hover) - 10}
            y={Math.max(PAD.top + 12, y(values[hover]!) - 12)}
            textAnchor={x(hover) < W / 2 ? "start" : "end"}
            fontSize="13.5"
            fontWeight="600"
            fill="#e7eaee"
            fontFamily="var(--mono)"
          >
            {labelFor(hover)} · {price(values[hover]!)}
          </text>
        </g>
      )}
      {[
        { i: 0, dx: 8, dy: -10, anchor: "start" as const, text: price(values[0]!) },
        {
          i: peakIndex,
          dx: -8,
          dy: -12,
          anchor: "end" as const,
          text: `${labelFor(peakIndex)} · ${price(values[peakIndex]!)}`,
        },
        { i: last, dx: -4, dy: 22, anchor: "end" as const, text: price(values[last]!) },
      ].map((mark) => (
        <g key={mark.i}>
          <circle cx={x(mark.i)} cy={y(values[mark.i]!)} r="4.5" fill="#16a34a" stroke="#0e1218" strokeWidth="2" />
          <text
            x={x(mark.i) + mark.dx}
            y={y(values[mark.i]!) + mark.dy}
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
      <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} stroke="#232a34" />
    </svg>
  );
}
