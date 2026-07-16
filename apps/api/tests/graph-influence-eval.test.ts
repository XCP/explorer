import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeGraphAblations } from "#api/indexer/graph-influence-eval";

test("graph ablation summary reports entrants, exits, overlap, and rank movement", () => {
  const row = (variant: string, rank: number, asset: string, score: number) => ({
    variant,
    rank,
    asset,
    score,
    graph_trust: 0,
    graph_distrust: 0,
    holders: 20,
    market_usd: 10,
  });
  const summary = summarizeGraphAblations([
    row("current", 1, "A", 3),
    row("current", 2, "B", 2),
    row("without_graph", 1, "B", 4),
    row("without_graph", 2, "C", 3),
  ]) as Record<string, any>;
  assert.equal(summary.without_graph.overlap_with_current, 1);
  assert.equal(summary.without_graph.mean_absolute_rank_change, 1);
  assert.deepEqual(summary.without_graph.entrants, [{ asset: "C", rank: 2, score: 3 }]);
  assert.deepEqual(summary.without_graph.exits, [{ asset: "A", rank: 1, score: 3 }]);
});
