#!/usr/bin/env node

/** Resolve fixed-fold New Radar review identities for named false-positive analysis. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const root = resolve(".analytics/radar/ownership");
const evaluation = JSON.parse(readFileSync(resolve(root, "new-evaluation.json"), "utf8"));
if (evaluation.schema !== "xcp-radar-new-evaluation/1") throw new Error("New Radar evaluation is missing");
const ids = [...new Set(evaluation.evaluations.flatMap((fold) => fold.review.map((row) => row.asset_id)))];
const names = new Map();
for (let start = 0; start < ids.length; start += 80) {
  const batch = ids.slice(start, start + 80).join(",");
  const rows = executeRemoteD1(`SELECT dictionary.asset_id,dictionary.asset,asset.asset_longname,
      signal.low_quality,signal.holders,signal.top1_pct,signal.supply,
      (SELECT COUNT(DISTINCT evidence.source) FROM collection_membership_evidence evidence
        JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id
        WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset) collection_sources
    FROM asset_dictionary dictionary LEFT JOIN assets asset USING(asset_id)
    LEFT JOIN asset_signals signal USING(asset_id) WHERE dictionary.asset_id IN (${batch})`).rows;
  for (const row of rows) names.set(Number(row.asset_id), row);
}
const folds = evaluation.evaluations.map((fold) => ({
  fold: fold.fold,
  candidates: fold.review.map((row) => {
    const named = names.get(row.asset_id) ?? {};
    return {
      ...row,
      asset: named.asset_longname ?? named.asset ?? `asset:${row.asset_id}`,
      current_low_quality: Number(named.low_quality ?? 0),
      current_holders: Number(named.holders ?? 0),
      current_top1_pct: Number(named.top1_pct ?? 0),
      current_supply: Number(named.supply ?? 0),
      collection_sources: Number(named.collection_sources ?? 0),
    };
  }),
}));
const report = {
  schema: "xcp-radar-new-named-audit/1",
  measured_at: new Date().toISOString(),
  caveat: "Current classifications are review labels only and were not available to the historical predictor.",
  folds,
};
writeFileSync(resolve(root, "new-named-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  measured_at: report.measured_at,
  folds: folds.map((fold) => ({ fold: fold.fold, candidates: fold.candidates.slice(0, 20) })),
}, null, 2)}\n`);
