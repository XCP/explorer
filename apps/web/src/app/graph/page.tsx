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
      {data && (() => {
        const s = data.stats;
        // Cohesion = interaction edges per peripheral node. Organic crowds sit well under 1 (holders barely
        // interact); a wash/sybil/insider ring runs many× that because it trades among itself repeatedly.
        const coordinated = s.cohesion >= 2.5 || s.strong_edges >= s.total;
        return (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, margin: "0 0 8px" }}>
              <span style={{ color: "#8b93a0" }}>{s.total} {s.peripheral} · {s.edges_among} interaction edges</span>
              <span style={{
                fontWeight: 600, padding: "2px 9px", borderRadius: 999,
                color: coordinated ? "#fca5a5" : "#6bbc85",
                background: coordinated ? "rgba(239,68,68,.12)" : "rgba(22,101,52,.14)",
                border: `1px solid ${coordinated ? "#7f1d1d" : "#1a5c36"}`,
              }}>
                cohesion {s.cohesion.toFixed(2)} · {coordinated
                  ? `⚠ coordinated — ${s.strong_edges} repeated ties, largest ring ${s.largest_cluster}`
                  : "organic crowd"}
              </span>
            </div>
            <p style={{ color: "#5b636f", fontSize: 11.5, margin: "0 0 10px" }}>
              Cohesion = interaction edges per {s.peripheral.replace(/s$/, "")}. Grey nodes are independent; a coloured cluster is a set that <em>repeatedly</em> trades among itself — a coordinated ring lights up as one big colour, an organic crowd stays grey and sparse.
            </p>
            <GraphView data={data} />
          </>
        );
      })()}
    </div>
  );
}
