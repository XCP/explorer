import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_MARKET_BASELINE_SQL,
  ADDRESS_ACTIVITY_BASELINE_SQL,
  CUTOFFS,
  HORIZON_DAYS,
  buildReport,
  comparePredictors,
  validateLeakage,
} from "#ops/evaluate-reputation-baselines";

test("historical baseline SQL keeps features and outcomes on opposite sides of the cutoff", () => {
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.block_time<=cutoff\.cutoff/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.block_time>past\.cutoff/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.block_time<=past\.outcome_end/);
  assert.equal(/asset_signals|address_signals|graph_(?:rank|edges|seed)/.test(ASSET_MARKET_BASELINE_SQL), false);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.buyer_id<>trade\.seller_id/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.venue='dispense' AND trade\.sale_class='single'/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.venue='emblem' AND trade\.sale_class='real'/);
  assert.equal(/trade\.venue='scarce\.city'/.test(ASSET_MARKET_BASELINE_SQL), false);
  assert.match(ASSET_MARKET_BASELINE_SQL, /'balanced_market'/);
  for (const family of ["recency", "active_months", "realized_usd"])
    assert.match(ASSET_MARKET_BASELINE_SQL, new RegExp(`'balanced_no_${family}'`));
  assert.match(ASSET_MARKET_BASELINE_SQL, /'compact_market'/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /'persistence_core'/);
  for (const predictor of [
    "peak_usd",
    "buyer_gated_peak_usd",
    "buyer_gated_total_usd",
    "market_depth",
    "market_depth_peak",
    "market_depth_total",
  ])
    assert.match(ASSET_MARKET_BASELINE_SQL, new RegExp(`'${predictor}'`));
  for (const metric of ["precision_at_100", "recall_at_500", "precision_at_1pct", "average_precision", "ndcg"])
    assert.match(ASSET_MARKET_BASELINE_SQL, new RegExp(metric));
});

test("challenger comparison exposes cutoff wins and worst regression", () => {
  const rows = [
    { label: "a", predictor: "candidate", return_lift: 3 },
    { label: "a", predictor: "baseline", return_lift: 2 },
    { label: "b", predictor: "candidate", return_lift: 1.5 },
    { label: "b", predictor: "baseline", return_lift: 2 },
  ];
  const comparison = comparePredictors(rows, "candidate", "baseline", ["return_lift"]);
  assert.deepEqual(comparison.summary.return_lift, {
    wins: 1,
    ties: 0,
    losses: 1,
    worst_delta: -0.5,
    mean_delta: 0.25,
  });
});

test("address baseline uses originating transactions and the same strict temporal boundary", () => {
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.source_id IS NOT NULL/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.supported=1/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.block_time<=cutoff\.cutoff/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.block_time>past\.cutoff/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.block_time<=past\.outcome_end/);
  assert.equal(/address_signals|graph_(?:rank|edges|seed)/.test(ADDRESS_ACTIVITY_BASELINE_SQL), false);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /'balanced_participation'/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /precision_at_100/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /recall_at_1pct/);
});

test("baseline report rejects temporal leakage and records methodology", () => {
  const [label, cutoffValue] = CUTOFFS[0];
  const cutoff = Number(cutoffValue);
  const valid = [{ label, predictor: "recency", first_outcome_time: cutoff + 1, last_outcome_time: cutoff + 100 }];
  validateLeakage(valid);
  assert.throws(() => validateLeakage([{ ...valid[0], first_outcome_time: cutoff }]), /outcome leaked across cutoff/);
  assert.throws(
    () => validateLeakage([{ ...valid[0], last_outcome_time: cutoff + HORIZON_DAYS * 86400 + 1 }]),
    /outcome exceeded/,
  );
  const report = buildReport(valid);
  assert.equal(report.schema, "xcp-reputation-baseline/2");
  assert.match(report.methodology.warning, /snapshots are intentionally excluded/);
  assert.match(report.methodology.challengers.balanced_market, /equal mean/);
  assert.match(report.methodology.ranking_metrics.ndcg, /normalized/);
});
