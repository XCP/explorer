#!/usr/bin/env node

/** Evaluate fixed-age, leakage-safe signals for newly issued assets. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { percentileRanks } from "./lib/reputation-snapshot.mjs";

const arg = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const root = resolve(".analytics/radar/ownership");
const observationDays = Number(arg("observation-days", "30"));
const outcomeDays = 180;
const marketOutcomeStartDays = Number(arg("market-outcome-start-days", String(observationDays)));
if (![7, 30, 90].includes(observationDays)) throw new Error("observation-days must be 7, 30, or 90");
if (!Number.isInteger(marketOutcomeStartDays) || marketOutcomeStartDays < observationDays || marketOutcomeStartDays >= outcomeDays)
  throw new Error("market-outcome-start-days must be at least the observation age and less than 180");
const ownership = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
for (const age of [observationDays, outcomeDays]) {
  const receipt = JSON.parse(readFileSync(resolve(root, `new-features-${age}d.json`), "utf8"));
  if (!receipt.complete) throw new Error(`${age}-day New Radar features are incomplete`);
}
const db = new DatabaseSync(resolve(root, "ownership.sqlite"), { readOnly: true });
const rows = db
  .prepare(`WITH issued AS (
    SELECT early.*,
      COUNT(*) OVER(PARTITION BY early.issuer_id ORDER BY early.issued_at,early.asset_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) issuer_prior_assets
    FROM radar_new_features early JOIN radar_new_cohort_members member
      ON member.age_days=early.age_days AND member.asset_id=early.asset_id
    WHERE early.age_days=${observationDays} AND member.frontier_event_index=${Number(ownership.frontier_event_index)}
  ), early_market AS (
    SELECT issued.asset_id,COUNT(trade.trade_rowid) early_trades,
      COUNT(DISTINCT trade.buyer_id) early_buyers,COUNT(DISTINCT trade.seller_id) early_sellers,
      COUNT(DISTINCT trade.venue) early_venues,
      COUNT(DISTINCT strftime('%Y-%m-%d',trade.block_time,'unixepoch')) early_active_days,
      COUNT(DISTINCT CASE WHEN trade.block_time>=issued.issued_at+${Math.ceil(observationDays / 2)}*86400 THEN trade.buyer_id END) late_buyers,
      COUNT(DISTINCT CASE WHEN trade.block_time>=issued.issued_at+${Math.ceil(observationDays / 2)}*86400
        THEN strftime('%Y-%m-%d',trade.block_time,'unixepoch') END) late_active_days,
      COALESCE((MAX(trade.block_time)-MIN(trade.block_time))/86400.0,0) early_market_span_days
    FROM issued LEFT JOIN market_trades trade ON trade.asset_id=issued.asset_id
      AND trade.block_time>=issued.issued_at AND trade.block_time<=issued.observed_at
      AND (trade.buyer_id IS NULL OR trade.seller_id IS NULL OR trade.buyer_id<>trade.seller_id)
    GROUP BY issued.asset_id
  ), future_market AS (
    SELECT issued.asset_id,COUNT(trade.trade_rowid) future_trades,
      COUNT(DISTINCT trade.buyer_id) future_buyers,COUNT(DISTINCT trade.seller_id) future_sellers,
      COUNT(DISTINCT strftime('%Y-%m',trade.block_time,'unixepoch')) future_active_months
    FROM issued LEFT JOIN market_trades trade ON trade.asset_id=issued.asset_id
      AND trade.block_time>issued.issued_at+${marketOutcomeStartDays}*86400
      AND trade.block_time<=issued.issued_at+${outcomeDays}*86400
      AND (trade.buyer_id IS NULL OR trade.seller_id IS NULL OR trade.buyer_id<>trade.seller_id)
    GROUP BY issued.asset_id
  ), retention AS (
    SELECT early.asset_id,COUNT(*) ordinary_nonissuer_holders30,
      SUM(later.holder_id IS NOT NULL) retained_ordinary_nonissuer_holders
    FROM radar_new_holders early
    LEFT JOIN radar_new_holders later ON later.age_days=${outcomeDays} AND later.asset_id=early.asset_id
      AND later.holder_id=early.holder_id
    WHERE early.age_days=${observationDays} AND early.is_utxo=0 AND early.is_issuer=0
    GROUP BY early.asset_id
  )
  SELECT issued.asset_id id,issued.issued_at,issued.issuer_prior_assets,
    issued.holders holders30,later.holders holders180,issued.normalized_supply,
    CASE WHEN issued.raw_supply>0 THEN issued.top1_quantity*1.0/issued.raw_supply ELSE 1 END top1_share,
    CASE WHEN issued.raw_supply>0 THEN issued.issuer_quantity*1.0/issued.raw_supply ELSE 1 END issuer_share,
    issued.ledger_events,early_market.*,future_market.*,
    COALESCE(retention.ordinary_nonissuer_holders30,0) ordinary_nonissuer_holders30,
    COALESCE(retention.retained_ordinary_nonissuer_holders,0) retained_ordinary_nonissuer_holders
  FROM issued JOIN radar_new_cohort_members later_member ON later_member.asset_id=issued.asset_id
    AND later_member.age_days=${outcomeDays} AND later_member.frontier_event_index=${Number(ownership.frontier_event_index)}
  JOIN radar_new_features later ON later.asset_id=issued.asset_id AND later.age_days=${outcomeDays}
  JOIN early_market USING(asset_id) JOIN future_market USING(asset_id)
  LEFT JOIN retention ON retention.asset_id=issued.asset_id
  WHERE issued.raw_supply>0 AND issued.holders>0`)
  .all()
  .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])));
db.close();

const folds = [
  { label: "2016-2019", start: Date.parse("2016-01-01T00:00:00Z") / 1000, end: Date.parse("2020-01-01T00:00:00Z") / 1000 },
  { label: "2020-2022", start: Date.parse("2020-01-01T00:00:00Z") / 1000, end: Date.parse("2023-01-01T00:00:00Z") / 1000 },
  { label: "2023-2024", start: Date.parse("2023-01-01T00:00:00Z") / 1000, end: Date.parse("2025-01-01T00:00:00Z") / 1000 },
  { label: "2025-2026", start: Date.parse("2025-01-01T00:00:00Z") / 1000, end: Infinity },
];
const outcomes = {
  any_future_trade: (row) => row.future_trades > 0,
  broad_future_market: (row) => row.future_buyers >= 2 && row.future_active_months >= 2,
  holder_count_survival: (row) => row.holders180 >= 2 && row.holders180 >= row.holders30 * 0.75,
  exact_holder_retention: (row) =>
    row.ordinary_nonissuer_holders30 >= 2 &&
    row.retained_ordinary_nonissuer_holders >= row.ordinary_nonissuer_holders30 * 0.75,
  holder_growth: (row) => row.holders180 > row.holders30,
};

function evaluateRank(cohort, name, score, outcome) {
  const ranked = [...cohort].sort((a, b) => score(b) - score(a) || a.id - b.id);
  const top = ranked.slice(0, Math.min(100, ranked.length));
  const rate = (items) => items.filter(outcome).length / Math.max(1, items.length);
  const population = rate(ranked);
  const positives = ranked.filter(outcome).length;
  let hits = 0;
  let precisionSum = 0;
  let dcg = 0;
  for (const [index, row] of ranked.entries()) {
    if (!outcome(row)) continue;
    hits++;
    precisionSum += hits / (index + 1);
    dcg += 1 / Math.log2(index + 2);
  }
  let idealDcg = 0;
  for (let index = 0; index < positives; index++) idealDcg += 1 / Math.log2(index + 2);
  return {
    predictor: name,
    eligible: ranked.length,
    population_rate: population,
    precision_at_100: rate(top),
    precision_at_500: rate(ranked.slice(0, Math.min(500, ranked.length))),
    lift_at_100: population ? rate(top) / population : 0,
    average_precision: positives ? precisionSum / positives : 0,
    ndcg: idealDcg ? dcg / idealDcg : 0,
  };
}

const evaluations = folds.map((fold) => {
  const cohort = rows.filter((row) => row.issued_at >= fold.start && row.issued_at < fold.end);
  const holder = percentileRanks(cohort, "holders30");
  const buyer = percentileRanks(cohort, "early_buyers");
  const days = percentileRanks(cohort, "early_active_days");
  const venue = percentileRanks(cohort, "early_venues");
  const lateBuyer = percentileRanks(cohort, "late_buyers");
  const span = percentileRanks(cohort, "early_market_span_days");
  const safety = percentileRanks(cohort, "top1_share");
  const issuer = percentileRanks(cohort, "issuer_prior_assets");
  const challenger = (row) =>
    holder.get(row.id) * 0.35 +
    buyer.get(row.id) * 0.3 +
    days.get(row.id) * 0.2 +
    (1 - safety.get(row.id)) * 0.15;
  const persistentChallenger = (row) =>
    holder.get(row.id) * 0.2 +
    buyer.get(row.id) * 0.2 +
    lateBuyer.get(row.id) * 0.3 +
    span.get(row.id) * 0.15 +
    (1 - safety.get(row.id)) * 0.15;
  const scores = [
    ["holder_breadth", (row) => holder.get(row.id)],
    ["paid_buyer_breadth", (row) => buyer.get(row.id)],
    ["active_days", (row) => days.get(row.id)],
    ["venue_diversity", (row) => venue.get(row.id)],
    ["late_paid_buyer_breadth", (row) => lateBuyer.get(row.id)],
    ["early_market_span", (row) => span.get(row.id)],
    ["distribution_safety", (row) => 1 - safety.get(row.id)],
    ["issuer_prior_assets", (row) => issuer.get(row.id)],
    ["market_core", (row) => buyer.get(row.id) * 0.5 + days.get(row.id) * 0.5],
    [
      "market_core_plus_venue",
      (row) => buyer.get(row.id) * 0.45 + days.get(row.id) * 0.45 + venue.get(row.id) * 0.1,
    ],
    [
      "early_adoption_challenger",
      challenger,
    ],
    ["persistent_adoption_challenger", persistentChallenger],
  ];
  const review = [...cohort]
    .sort((a, b) => challenger(b) - challenger(a) || a.id - b.id)
    .slice(0, 100)
    .map((row) => ({
      asset_id: row.id,
      issued_at: row.issued_at,
      holders30: row.holders30,
      early_buyers: row.early_buyers,
      early_active_days: row.early_active_days,
      early_venues: row.early_venues,
      late_buyers: row.late_buyers,
      early_market_span_days: row.early_market_span_days,
      top1_share: row.top1_share,
      any_future_trade: outcomes.any_future_trade(row),
      broad_future_market: outcomes.broad_future_market(row),
      exact_holder_retention: outcomes.exact_holder_retention(row),
    }));
  return {
    fold: fold.label,
    cohort: cohort.length,
    outcomes: Object.fromEntries(
      Object.entries(outcomes).map(([outcomeName, outcome]) => [
        outcomeName,
        scores.map(([name, score]) => evaluateRank(cohort, name, score, outcome)),
      ]),
    ),
    review,
  };
});
const report = {
  schema: "xcp-radar-new-evaluation/1",
  observation_days: observationDays,
  outcome_days: outcomeDays,
  market_outcome_start_days: marketOutcomeStartDays,
  observation: `exact holder and completed-market state ${observationDays} days after first valid issuance`,
  outcome: `holder state at day ${outcomeDays} and completed-market activity from day ${marketOutcomeStartDays} through day ${outcomeDays}`,
  caveats: [
    "The additive challenger uses transparent provisional weights and must beat its component baselines across folds.",
    "Exact retention follows ordinary non-issuer holder identities; native UTXO identities are excluded because moving a UTXO changes its identity.",
    "External collection evidence is not available historically and is excluded from this leakage-safe baseline.",
  ],
  population: rows.length,
  evaluations,
};
const outcomeSuffix = marketOutcomeStartDays === observationDays ? "" : `-market-from-${marketOutcomeStartDays}d`;
writeFileSync(resolve(root, `new-evaluation-${observationDays}d${outcomeSuffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
