"use client";
import dynamic from "next/dynamic";
import type { GraphSubgraph } from "@xcp/shared/graph";

// reagraph is WebGL — load it only in the browser so it never touches SSR / the OpenNext build's server path.
const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

const radius = (w: number) => Math.min(24, 5 + Math.log1p(Math.max(0, w)) * 3);
// Colour is the whole point: the queried entity is amber, independent peripherals (no interlinks) are a quiet
// slate, and each interconnected CLUSTER gets a loud distinct colour — so a coordinated ring pops instantly.
const PALETTE = [
  "#f43f5e",
  "#a855f7",
  "#3b82f6",
  "#f59e0b",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
  "#eab308",
  "#06b6d4",
  "#ef4444",
];
const nodeFill = (n: GraphSubgraph["nodes"][number]) =>
  n.center
    ? "#fbbf24"
    : n.kind === "asset"
      ? "#22c55e"
      : (n.cluster ?? -1) >= 0
        ? PALETTE[n.cluster! % PALETTE.length]
        : "#475569";

export function GraphView({ data }: { data: GraphSubgraph }) {
  const nodes = data.nodes.map((n) => ({ id: n.id, label: n.label, size: radius(n.weight), fill: nodeFill(n) }));
  const edges = data.edges.map((e, i) => ({
    id: `${e.source}->${e.target}-${i}`,
    source: e.source,
    target: e.target,
    // spokes (center→peripheral) are faint scaffolding; peripheral↔peripheral interactions are the signal.
    size: e.spoke ? 0.4 : Math.min(4, 0.8 + e.weight / 2),
    fill: e.spoke ? "#1e293b" : "#94a3b8",
  }));
  return (
    <div
      style={{
        position: "relative",
        height: "72vh",
        width: "100%",
        border: "1px solid #1b2027",
        borderRadius: 12,
        overflow: "hidden",
        background: "#0a0c10",
      }}
    >
      <GraphCanvas nodes={nodes} edges={edges} labelType="nodes" draggable edgeArrowPosition="none" />
    </div>
  );
}
