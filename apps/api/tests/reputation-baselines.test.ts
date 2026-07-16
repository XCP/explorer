import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_MARKET_BASELINE_SQL,
  ADDRESS_ACTIVITY_BASELINE_SQL,
  CUTOFFS,
  HORIZON_DAYS,
  buildReport,
  validateLeakage,
} from "#ops/evaluate-reputation-baselines";

test("historical baseline SQL keeps features and outcomes on opposite sides of the cutoff", () => {
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.block_time<=cutoff\.cutoff/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.block_time>past\.cutoff/);
  assert.match(ASSET_MARKET_BASELINE_SQL, /trade\.block_time<=past\.outcome_end/);
  assert.equal(/asset_signals|address_signals|graph_(?:rank|edges|seed)/.test(ASSET_MARKET_BASELINE_SQL), false);
  assert.match(ASSET_MARKET_BASELINE_SQL, /'balanced_market'/);
});

test("address baseline uses originating transactions and the same strict temporal boundary", () => {
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.source_id IS NOT NULL/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.supported=1/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.block_time<=cutoff\.cutoff/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.block_time>past\.cutoff/);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /tx\.block_time<=past\.outcome_end/);
  assert.equal(/address_signals|graph_(?:rank|edges|seed)/.test(ADDRESS_ACTIVITY_BASELINE_SQL), false);
  assert.match(ADDRESS_ACTIVITY_BASELINE_SQL, /'balanced_participation'/);
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
  assert.equal(report.schema, "xcp-reputation-baseline/1");
  assert.match(report.methodology.warning, /snapshots are intentionally excluded/);
  assert.match(report.methodology.challengers.balanced_market, /equal mean/);
});
