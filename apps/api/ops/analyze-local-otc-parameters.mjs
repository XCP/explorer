#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const censusPath = resolve(option("database", "C:/BitcoinIndex/otc-census.sqlite"));
const ledgerPath = resolve(option("ledger-database", "C:/BitcoinIndex/otc-ledger.sqlite"));
const outputPath = resolve(option("output", ".codex-tmp/otc-parameter-analysis.json"));
const db = new DatabaseSync(censusPath, { readOnly: true });
db.exec(`ATTACH DATABASE '${ledgerPath.replaceAll("'", "''")}' AS ledger`);

const scenarios = [
  { name: "baseline", minLane: 3, minBuyers: 2, low: 0.8, high: 1.25, minRelative: -24, maxRelative: 3 },
  { name: "narrow_12_blocks", minLane: 3, minBuyers: 2, low: 0.8, high: 1.25, minRelative: -12, maxRelative: 3 },
  { name: "narrow_6_blocks", minLane: 3, minBuyers: 2, low: 0.8, high: 1.25, minRelative: -6, maxRelative: 3 },
  { name: "pay_before_or_same", minLane: 3, minBuyers: 2, low: 0.8, high: 1.25, minRelative: -24, maxRelative: 0 },
  { name: "two_match_lane", minLane: 2, minBuyers: 2, low: 0.8, high: 1.25, minRelative: -24, maxRelative: 3 },
  { name: "four_match_lane", minLane: 4, minBuyers: 2, low: 0.8, high: 1.25, minRelative: -24, maxRelative: 3 },
  { name: "three_buyer_lane", minLane: 3, minBuyers: 3, low: 0.8, high: 1.25, minRelative: -24, maxRelative: 3 },
  { name: "tight_price_10pct", minLane: 3, minBuyers: 2, low: 0.9, high: 1.1, minRelative: -24, maxRelative: 3 },
  { name: "loose_price_50pct", minLane: 3, minBuyers: 2, low: 0.5, high: 1.5, minRelative: -24, maxRelative: 3 },
  { name: "double_price_range", minLane: 3, minBuyers: 2, low: 0.5, high: 2, minRelative: -24, maxRelative: 3 },
];

const scenarioSql = (scenario) => `WITH filtered AS (
  SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
  FROM otc_candidate candidate
  WHERE candidate.quantity>0 AND candidate.relative_blocks BETWEEN ${scenario.minRelative} AND ${scenario.maxRelative}
), ranked AS (
  SELECT filtered.*,
    row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
    count(*) OVER(PARTITION BY asset_id,seller_id) lane_candidates
  FROM filtered
), medians AS (
  SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
  FROM ranked WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
  GROUP BY asset_id,seller_id
), lanes AS (
  SELECT asset_id,seller_id,count(DISTINCT buyer_id) lane_buyers
  FROM filtered GROUP BY asset_id,seller_id
), admitted AS (
  SELECT ranked.* FROM ranked JOIN medians USING(asset_id,seller_id) JOIN lanes USING(asset_id,seller_id)
  WHERE medians.lane_candidates>=${scenario.minLane} AND lanes.lane_buyers>=${scenario.minBuyers}
    AND ranked.unit_sats BETWEEN medians.median_unit_sats*${scenario.low}
      AND medians.median_unit_sats*${scenario.high}
)
SELECT count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
  count(DISTINCT seller_id) sellers,sum(payment_sats) sats,
  round(sum(payment_sats/1e8*price.usd),2) usd
FROM admitted LEFT JOIN ledger.prices price
  ON price.currency='BTC' AND price.day=date(admitted.btc_time,'unixepoch')`;

const scenarioResults = scenarios.map((scenario) => ({ ...scenario, ...db.prepare(scenarioSql(scenario)).get() }));

db.exec(`DROP TABLE IF EXISTS temp.parameter_classified;
CREATE TEMP TABLE parameter_classified AS
WITH priced AS (
  SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
  FROM otc_candidate candidate WHERE candidate.quantity>0
), ranked AS (
  SELECT priced.*,
    row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
    count(*) OVER(PARTITION BY asset_id,seller_id) lane_candidates
  FROM priced
), medians AS (
  SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
  FROM ranked WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
  GROUP BY asset_id,seller_id
), lanes AS (
  SELECT asset_id,seller_id,count(DISTINCT buyer_id) lane_buyers
  FROM otc_candidate GROUP BY asset_id,seller_id
)
SELECT ranked.*,medians.median_unit_sats,medians.lane_candidates,lanes.lane_buyers,
  ranked.unit_sats/medians.median_unit_sats price_ratio,
  CASE WHEN medians.lane_candidates<3 THEN 'fewer_than_3_lane_matches'
       WHEN lanes.lane_buyers<2 THEN 'one_buyer_lane'
       WHEN ranked.unit_sats<medians.median_unit_sats*0.8
         OR ranked.unit_sats>medians.median_unit_sats*1.25 THEN 'lane_price_outlier'
       ELSE 'accepted' END reason
FROM ranked JOIN medians USING(asset_id,seller_id) JOIN lanes USING(asset_id,seller_id);`);

const reasons = db
  .prepare(
    `SELECT reason,count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
    sum(payment_sats) sats,round(sum(payment_sats/1e8*price.usd),2) usd
    FROM parameter_classified candidate LEFT JOIN ledger.prices price
      ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    GROUP BY reason ORDER BY trades DESC`,
  )
  .all();

const marginalCohorts = {
  two_match_lane: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT candidate.buyer_id) buyers,
      count(DISTINCT candidate.seller_id) sellers,sum(candidate.payment_sats) sats,
      round(sum(candidate.payment_sats/1e8*price.usd),2) usd
    FROM parameter_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE candidate.lane_candidates=2 AND candidate.lane_buyers>=2
      AND candidate.price_ratio BETWEEN 0.8 AND 1.25
    GROUP BY candidate.asset_id ORDER BY usd DESC,trades DESC`,
    )
    .all(),
  loose_price_50pct: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT candidate.buyer_id) buyers,
      count(DISTINCT candidate.seller_id) sellers,sum(candidate.payment_sats) sats,
      round(sum(candidate.payment_sats/1e8*price.usd),2) usd,
      round(min(candidate.price_ratio),4) min_ratio,round(max(candidate.price_ratio),4) max_ratio
    FROM parameter_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE candidate.lane_candidates>=3 AND candidate.lane_buyers>=2
      AND (candidate.price_ratio BETWEEN 0.5 AND 1.5)
      AND candidate.price_ratio NOT BETWEEN 0.8 AND 1.25
    GROUP BY candidate.asset_id ORDER BY usd DESC,trades DESC`,
    )
    .all(),
  two_match_consistency: [1.1, 1.25, 1.5].map((maximumSpread) => ({
    maximum_spread: maximumSpread,
    ...db
      .prepare(
        `WITH eligible_lanes AS (
        SELECT asset_id,seller_id
        FROM parameter_classified
        WHERE lane_candidates=2 AND lane_buyers>=2
        GROUP BY asset_id,seller_id
        HAVING max(unit_sats)/min(unit_sats)<=?
      )
      SELECT count(*) trades,count(DISTINCT candidate.asset_id) assets,
        count(DISTINCT candidate.buyer_id) buyers,sum(candidate.payment_sats) sats,
        round(sum(candidate.payment_sats/1e8*price.usd),2) usd
      FROM parameter_classified candidate JOIN eligible_lanes USING(asset_id,seller_id)
      LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')`,
      )
      .get(maximumSpread),
  })),
};

const examples = Object.fromEntries(
  ["fewer_than_3_lane_matches", "one_buyer_lane", "lane_price_outlier"].map((reason) => [
    reason,
    db
      .prepare(
        `SELECT candidate.event_index,asset.asset,candidate.quantity,candidate.payment_sats,
        round(candidate.payment_sats/1e8*price.usd,2) usd,candidate.relative_blocks,
        candidate.lane_candidates,candidate.lane_buyers,round(candidate.price_ratio,4) price_ratio,
        seller.address seller,buyer.address buyer,lower(hex(candidate.asset_tx_hash)) asset_tx,
        lower(hex(candidate.btc_tx_hash)) btc_tx
      FROM parameter_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
      JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
      JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
      LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
      WHERE candidate.reason=? ORDER BY usd DESC,payment_sats DESC LIMIT 30`,
      )
      .all(reason),
  ]),
);

examples.two_match_lane = db
  .prepare(
    `SELECT candidate.event_index,asset.asset,candidate.quantity,candidate.payment_sats,
    round(candidate.payment_sats/1e8*price.usd,2) usd,candidate.relative_blocks,
    round(candidate.price_ratio,4) price_ratio,seller.address seller,buyer.address buyer,
    lower(hex(candidate.asset_tx_hash)) asset_tx,lower(hex(candidate.btc_tx_hash)) btc_tx
  FROM parameter_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
  JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
  JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
  LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
  WHERE candidate.lane_candidates=2 AND candidate.lane_buyers>=2
    AND candidate.price_ratio BETWEEN 0.8 AND 1.25
  ORDER BY usd DESC,payment_sats DESC LIMIT 40`,
  )
  .all();

const result = {
  generated_at: Math.floor(Date.now() / 1000),
  census_through: Number(db.prepare("SELECT max(indexed_through_block) height FROM otc_candidate").get().height),
  scenarios: scenarioResults,
  reasons,
  marginalCohorts,
  examples,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ event: "complete", outputPath, ...result }, null, 2));
db.close();
