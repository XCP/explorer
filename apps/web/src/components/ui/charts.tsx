"use client";
import { useState } from "react";

type Point = { t: number; v: number };

/** Dependency-free daily area chart with an exact hover readout. */
export function AreaChart({
  data,
  height = 200,
  formatValue = (value) => value.toLocaleString(),
  formatDate,
}: {
  data: Point[];
  height?: number;
  formatValue?: (value: number) => string;
  formatDate?: (timestamp: number) => string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length < 2) return <div style={{ height }} className="animate-pulse rounded bg-zinc-900" />;
  const width = 800;
  const left = 4;
  const right = 8;
  const top = 8;
  const bottom = 8;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(...data.map((point) => point.v), 1);
  const x = (index: number) => left + (index / (data.length - 1)) * plotWidth;
  const y = (value: number) => top + (1 - value / max) * plotHeight;
  const line = data
    .map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${left + plotWidth},${top + plotHeight} L${left},${top + plotHeight} Z`;
  const day = (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(0, 10);
  const dateLabel = formatDate ?? day;
  const active = hovered == null ? null : data[hovered];
  const activeX = hovered == null ? 0 : x(hovered);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Time series from ${day(data[0].t)} to ${day(data.at(-1)!.t)}`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const internalX = ((event.clientX - bounds.left) / bounds.width) * width;
          const ratio = Math.min(1, Math.max(0, (internalX - left) / plotWidth));
          setHovered(Math.round(ratio * (data.length - 1)));
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id="xcpArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const gridY = top + fraction * plotHeight;
          return (
            <line
              key={fraction}
              x1={left}
              x2={width - right}
              y1={gridY}
              y2={gridY}
              stroke="#27272a"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <path d={area} fill="url(#xcpArea)" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {active && (
          <>
            <line
              x1={activeX}
              x2={activeX}
              y1={top}
              y2={top + plotHeight}
              stroke="#71717a"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={activeX} cy={y(active.v)} r="3" fill="var(--color-accent)" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded border border-zinc-700 bg-zinc-950/95 px-2.5 py-2 text-xs shadow-xl"
          style={{
            left: `${(activeX / width) * 100}%`,
            transform: `translateX(${activeX > width * 0.75 ? "-100%" : activeX < width * 0.25 ? "0" : "-50%"})`,
          }}
        >
          <div className="font-mono text-zinc-500">{dateLabel(active.t)}</div>
          <div className="mt-0.5 font-mono text-zinc-100">{formatValue(active.v)}</div>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] font-mono text-zinc-500">
        <span>{day(data[0].t)}</span>
        <span>{day(data.at(-1)!.t)}</span>
      </div>
    </div>
  );
}
