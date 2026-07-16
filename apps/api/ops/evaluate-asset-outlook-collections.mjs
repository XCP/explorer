#!/usr/bin/env node

/** Multi-cutoff collection-dependence check for the two-factor asset activity outlook. */
import { CUTOFFS } from "./evaluate-reputation-baselines.mjs";
import { collectionSql, leaveCollectionOutSql } from "./review-asset-activity-outlook.mjs";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

export function evaluateCutoff(label, cutoff, execute = executeRemoteD1) {
  const collections = execute(collectionSql(cutoff));
  const dominant = collections.rows.find((row) => row.collection !== "(unclassified)") ?? null;
  const baseline = execute(leaveCollectionOutSql("(no matching collection)", cutoff));
  const leaveOut = dominant ? execute(leaveCollectionOutSql(dominant.collection, cutoff)) : { rows: [], meta: {} };
  const parts = [collections, baseline, leaveOut];
  return {
    label,
    cutoff,
    dominant_collection: dominant?.collection ?? null,
    dominant_top_100_assets: Number(dominant?.top_100_assets ?? 0),
    dominant_top_100_returns: Number(dominant?.top_100_returns ?? 0),
    baseline: baseline.rows[0] ?? null,
    leave_dominant_out: leaveOut.rows[0] ?? null,
    d1: {
      rows_read: parts.reduce((sum, part) => sum + Number(part.meta.rows_read ?? 0), 0),
      sql_duration_ms: parts.reduce((sum, part) => sum + Number(part.meta.timings?.sql_duration_ms ?? 0), 0),
    },
  };
}

export function buildCollectionReport(results) {
  return {
    schema: "xcp-asset-outlook-collection-stability/1",
    generated_at: new Date().toISOString(),
    horizon_days: 180,
    method: "rank all historically traded assets, then rerank after removing the dominant named top-100 collection",
    collection_labels: "current post-hoc diagnostic groups; never model inputs",
    results,
  };
}

function run() {
  const results = CUTOFFS.map(([label, cutoff]) => evaluateCutoff(label, Number(cutoff)));
  process.stdout.write(`${JSON.stringify(buildCollectionReport(results), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) run();
