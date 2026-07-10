"use client";
import dynamic from "next/dynamic";
import type { GraphSubgraph } from "@xcp/shared/graph";

// reagraph is WebGL — load it only in the browser so it never touches SSR / the OpenNext build's server path.
const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

// size hint -> node radius (log-compressed so a hub doesn't dwarf everything); colour by role.
const radius = (w: number) => Math.min(24, 5 + Math.log1p(Math.max(0, w)) * 3);
const fill = (n: GraphSubgraph["nodes"][number]) =>
  n.center ? "#f59e0b" : n.kind === "asset" ? "#22c55e" : "#38bdf8";

export function GraphView({ data }: { data: GraphSubgraph }) {
  const nodes = data.nodes.map((n) => ({ id: n.id, label: n.label, size: radius(n.weight), fill: fill(n) }));
  const edges = data.edges.map((e, i) => ({
    id: `${e.source}->${e.target}-${i}`, source: e.source, target: e.target, size: Math.min(4, 0.4 + e.weight / 2),
  }));
  return (
    <div style={{ position: "relative", height: "72vh", width: "100%", border: "1px solid #1b2027", borderRadius: 12, overflow: "hidden", background: "#0a0c10" }}>
      <GraphCanvas nodes={nodes} edges={edges} labelType="nodes" draggable />
    </div>
  );
}
