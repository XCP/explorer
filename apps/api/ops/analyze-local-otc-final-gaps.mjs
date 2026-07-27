#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const censusPath = resolve("C:/BitcoinIndex/otc-census.sqlite");
const ledgerPath = resolve("C:/BitcoinIndex/otc-ledger.sqlite");
const outputPath = resolve(".codex-tmp/otc-final-gap-analysis.json");
const db = new DatabaseSync(censusPath, { readOnly: true });
db.exec(`ATTACH DATABASE '${ledgerPath.replaceAll("'", "''")}' AS ledger`);

const temporal = [];
for (const days of [30, 90, 180, 365]) {
  const seconds = days * 86_400;
  temporal.push({
    days,
    ...db
      .prepare(
        `WITH base AS (
        SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
        FROM otc_candidate candidate WHERE candidate.quantity>0
      ), lane AS (
        SELECT asset_id,seller_id,count(*) lane_candidates,count(DISTINCT buyer_id) lane_buyers
        FROM base GROUP BY asset_id,seller_id
      ), global_rank AS (
        SELECT base.*,row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
          count(*) OVER(PARTITION BY asset_id,seller_id) price_count
        FROM base
      ), global_median AS (
        SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats
        FROM global_rank WHERE price_rank IN ((price_count+1)/2,(price_count+2)/2)
        GROUP BY asset_id,seller_id
      ), target AS (
        SELECT base.* FROM base JOIN lane USING(asset_id,seller_id) JOIN global_median USING(asset_id,seller_id)
        WHERE lane.lane_candidates>=3 AND lane.lane_buyers>=2
          AND base.unit_sats NOT BETWEEN global_median.median_unit_sats*0.8 AND global_median.median_unit_sats*1.25
      ), peer_rank AS (
        SELECT target.event_index target_event,peer.unit_sats,
          row_number() OVER(PARTITION BY target.event_index ORDER BY peer.unit_sats,peer.event_index) price_rank,
          count(*) OVER(PARTITION BY target.event_index) peer_count
        FROM target JOIN base peer ON peer.asset_id=target.asset_id AND peer.seller_id=target.seller_id
          AND peer.event_index<>target.event_index AND abs(peer.asset_time-target.asset_time)<=${seconds}
      ), peer_median AS (
        SELECT target_event,avg(unit_sats) local_median,max(peer_count) peer_count
        FROM peer_rank WHERE price_rank IN ((peer_count+1)/2,(peer_count+2)/2) GROUP BY target_event
      ), peer_buyers AS (
        SELECT target.event_index target_event,count(DISTINCT peer.buyer_id) peer_buyers
        FROM target JOIN base peer ON peer.asset_id=target.asset_id AND peer.seller_id=target.seller_id
          AND peer.event_index<>target.event_index AND peer.buyer_id<>target.buyer_id
          AND abs(peer.asset_time-target.asset_time)<=${seconds}
        GROUP BY target.event_index
      ), admitted AS (
        SELECT target.* FROM target JOIN peer_median ON peer_median.target_event=target.event_index
        JOIN peer_buyers ON peer_buyers.target_event=target.event_index
        WHERE peer_median.peer_count>=3 AND peer_buyers.peer_buyers>=2
          AND target.unit_sats BETWEEN peer_median.local_median*0.8 AND peer_median.local_median*1.25
      )
      SELECT count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
        sum(payment_sats) sats,round(sum(payment_sats/1e8*price.usd),2) usd
      FROM admitted LEFT JOIN ledger.prices price
        ON price.currency='BTC' AND price.day=date(admitted.btc_time,'unixepoch')`,
      )
      .get(),
  });
}

const splitPayments = db
  .prepare(
    `WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id,seller_id) deliveries
    FROM raw_match match
  ), grouped AS (
    SELECT event_index,asset_tx_hash,asset_block,asset_time,seller_id,buyer_id,asset_id,quantity,
      sum(payment_sats) payment_sats,min(btc_time) btc_time,count(*) payment_count
    FROM ranked WHERE payments>1 AND deliveries=1 GROUP BY event_index
    HAVING count(*)=max(payments)
  ), priced AS (
    SELECT grouped.*,payment_sats/quantity unit_sats FROM grouped WHERE quantity>0
  ), lane_rank AS (
    SELECT priced.*,row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id,seller_id) lane_candidates
    FROM priced
  ), medians AS (
    SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
    FROM lane_rank WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
    GROUP BY asset_id,seller_id
  ), buyers AS (
    SELECT asset_id,seller_id,count(DISTINCT buyer_id) lane_buyers FROM priced GROUP BY asset_id,seller_id
  ), admitted AS (
    SELECT lane_rank.* FROM lane_rank JOIN medians USING(asset_id,seller_id) JOIN buyers USING(asset_id,seller_id)
    WHERE medians.lane_candidates>=3 AND buyers.lane_buyers>=2
      AND lane_rank.unit_sats BETWEEN medians.median_unit_sats*0.8 AND medians.median_unit_sats*1.25
  )
  SELECT count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
    sum(payment_sats) sats,round(sum(payment_sats/1e8*price.usd),2) usd
  FROM admitted LEFT JOIN ledger.prices price
    ON price.currency='BTC' AND price.day=date(admitted.btc_time,'unixepoch')`,
  )
  .get();

const bundles = db
  .prepare(
    `WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id,seller_id) deliveries
    FROM raw_match match
  ), bundle AS (
    SELECT tx_id,buyer_id,seller_id,min(btc_time) btc_time,max(payment_sats) payment_sats,
      count(*) legs,count(DISTINCT asset_id) assets
    FROM ranked WHERE payments=1 AND deliveries>1 GROUP BY tx_id,buyer_id,seller_id
  )
  SELECT count(*) bundles,sum(legs) asset_legs,sum(payment_sats) sats,
    round(sum(payment_sats/1e8*price.usd),2) usd
  FROM bundle LEFT JOIN ledger.prices price
    ON price.currency='BTC' AND price.day=date(bundle.btc_time,'unixepoch')`,
  )
  .get();

db.exec(`CREATE TEMP TABLE temporal_30_admitted AS
  WITH base AS (
    SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
    FROM otc_candidate candidate WHERE candidate.quantity>0
  ), lane AS (
    SELECT asset_id,seller_id,count(*) lane_candidates,count(DISTINCT buyer_id) lane_buyers
    FROM base GROUP BY asset_id,seller_id
  ), global_rank AS (
    SELECT base.*,row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id,seller_id) price_count FROM base
  ), global_median AS (
    SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats
    FROM global_rank WHERE price_rank IN ((price_count+1)/2,(price_count+2)/2)
    GROUP BY asset_id,seller_id
  ), target AS (
    SELECT base.* FROM base JOIN lane USING(asset_id,seller_id) JOIN global_median USING(asset_id,seller_id)
    WHERE lane.lane_candidates>=3 AND lane.lane_buyers>=2
      AND base.unit_sats NOT BETWEEN global_median.median_unit_sats*0.8 AND global_median.median_unit_sats*1.25
  ), peer_rank AS (
    SELECT target.event_index target_event,peer.unit_sats,
      row_number() OVER(PARTITION BY target.event_index ORDER BY peer.unit_sats,peer.event_index) price_rank,
      count(*) OVER(PARTITION BY target.event_index) peer_count
    FROM target JOIN base peer ON peer.asset_id=target.asset_id AND peer.seller_id=target.seller_id
      AND peer.event_index<>target.event_index AND abs(peer.asset_time-target.asset_time)<=2592000
  ), peer_median AS (
    SELECT target_event,avg(unit_sats) local_median,max(peer_count) peer_count
    FROM peer_rank WHERE price_rank IN ((peer_count+1)/2,(peer_count+2)/2) GROUP BY target_event
  ), peer_buyers AS (
    SELECT target.event_index target_event,count(DISTINCT peer.buyer_id) peer_buyers
    FROM target JOIN base peer ON peer.asset_id=target.asset_id AND peer.seller_id=target.seller_id
      AND peer.event_index<>target.event_index AND peer.buyer_id<>target.buyer_id
      AND abs(peer.asset_time-target.asset_time)<=2592000
    GROUP BY target.event_index
  )
  SELECT target.*,peer_median.local_median,peer_median.peer_count,peer_buyers.peer_buyers,
    target.unit_sats/peer_median.local_median local_ratio
  FROM target JOIN peer_median ON peer_median.target_event=target.event_index
  JOIN peer_buyers ON peer_buyers.target_event=target.event_index
  WHERE peer_median.peer_count>=3 AND peer_buyers.peer_buyers>=2
    AND target.unit_sats BETWEEN peer_median.local_median*0.8 AND peer_median.local_median*1.25;

  CREATE TEMP TABLE split_admitted AS
  WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id,seller_id) deliveries FROM raw_match match
  ), grouped AS (
    SELECT event_index,asset_tx_hash,asset_block,asset_time,seller_id,buyer_id,asset_id,quantity,
      sum(payment_sats) payment_sats,min(btc_time) btc_time,count(*) payment_count
    FROM ranked WHERE payments>1 AND deliveries=1 GROUP BY event_index
    HAVING count(*)=max(payments)
  ), priced AS (
    SELECT grouped.*,payment_sats/quantity unit_sats FROM grouped WHERE quantity>0
  ), lane_rank AS (
    SELECT priced.*,row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id,seller_id) lane_candidates FROM priced
  ), medians AS (
    SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
    FROM lane_rank WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
    GROUP BY asset_id,seller_id
  ), buyers AS (
    SELECT asset_id,seller_id,count(DISTINCT buyer_id) lane_buyers FROM priced GROUP BY asset_id,seller_id
  )
  SELECT lane_rank.*,medians.median_unit_sats,buyers.lane_buyers,
    lane_rank.unit_sats/medians.median_unit_sats price_ratio
  FROM lane_rank JOIN medians USING(asset_id,seller_id) JOIN buyers USING(asset_id,seller_id)
  WHERE medians.lane_candidates>=3 AND buyers.lane_buyers>=2
    AND lane_rank.unit_sats BETWEEN medians.median_unit_sats*0.8 AND medians.median_unit_sats*1.25;`);

const cohortDetails = (table, ratioColumn) => ({
  top_assets: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT candidate.buyer_id) buyers,
      count(DISTINCT candidate.seller_id) sellers,sum(candidate.payment_sats) sats,
      round(sum(candidate.payment_sats/1e8*price.usd),2) usd
    FROM ${table} candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    GROUP BY candidate.asset_id ORDER BY usd DESC,trades DESC`,
    )
    .all(),
  examples: db
    .prepare(
      `SELECT asset.asset,candidate.quantity,candidate.payment_sats,
      round(candidate.payment_sats/1e8*price.usd,2) usd,candidate.asset_block,
      round(candidate.${ratioColumn},4) price_ratio,seller.address seller,buyer.address buyer
    FROM ${table} candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
    JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    ORDER BY usd DESC,candidate.payment_sats DESC LIMIT 40`,
    )
    .all(),
});

const result = {
  temporal,
  split_payments: splitPayments,
  bundles,
  temporal_30_details: cohortDetails("temporal_30_admitted", "local_ratio"),
  split_payment_details: cohortDetails("split_admitted", "price_ratio"),
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
db.close();
