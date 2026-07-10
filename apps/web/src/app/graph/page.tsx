"use client";
import { useState } from "react";
import type { GraphSubgraph } from "@xcp/shared/graph";
import { apiUrl } from "@/lib/api";
import { GraphView } from "@/components/graph-view";

// R&D scratch page: render a bounded sub-graph from /v2/graph/{address|asset}/:id with reagraph. Not linked in
// the nav — an experiment surface for the social-graph visualization work.
export default function GraphExperiment() {
  const [mode, setMode] = useState<"asset" | "address">("asset");
  const [id, setId] = useState("PEPECASH");
  const [data, setData] = useState<GraphSubgraph | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = async () => {
    setState("loading");
    try {
      const res = await fetch(apiUrl(`/v2/graph/${mode}/${encodeURIComponent(id.trim())}`));
      const env = (await res.json()) as { result: GraphSubgraph | null };
      setData(env.result);
      setState("idle");
    } catch { setState("error"); }
  };

  return (
    <div style={{ padding: "24px 24px 0", maxWidth: 1200, margin: "0 auto", color: "#e7ebf1" }}>
      <h1 style={{ fontSize: 22, fontWeight: 650, margin: "0 0 4px" }}>Graph experiment</h1>
      <p style={{ color: "#8b93a0", fontSize: 13, margin: "0 0 16px" }}>
        Bounded sub-graph from the social/interaction graph. Try an asset (its top holders) or an address (its ego-network).
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as "asset" | "address")}
          style={{ background: "#0f1318", color: "#e7ebf1", border: "1px solid #1b2027", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
          <option value="asset">Asset → holders</option>
          <option value="address">Address → ego-network</option>
        </select>
        <input value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder={mode === "asset" ? "PEPECASH" : "1GQha…"} spellCheck={false}
          style={{ flex: "1 1 260px", background: "#0f1318", color: "#e7ebf1", border: "1px solid #1b2027", borderRadius: 8, padding: "8px 12px", fontFamily: "ui-monospace, monospace" }} />
        <button onClick={load} disabled={state === "loading"}
          style={{ background: "#166534", color: "#dcfce7", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}>
          {state === "loading" ? "Loading…" : "Graph it"}
        </button>
      </div>
      {state === "error" && <p style={{ color: "#f87171" }}>Couldn&apos;t load that one.</p>}
      {data && (
        <>
          <p style={{ color: "#6bbc85", fontSize: 12, margin: "0 0 8px" }}>
            {data.nodes.length} nodes · {data.edges.length} edges · centered on {data.center}
          </p>
          <GraphView data={data} />
        </>
      )}
    </div>
  );
}
