#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const bitcoinPath = resolve("C:/BitcoinIndex/counterparty-bitcoin.sqlite");
const ledgerPath = resolve("C:/BitcoinIndex/otc-ledger.sqlite");
const baselinePath = resolve("C:/BitcoinIndex/otc-census.sqlite");
const shadowPath = resolve("C:/BitcoinIndex/otc-third-party-payee.sqlite");
const outputPath = resolve(".codex-tmp/otc-third-party-payee.json");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(shadowPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;
  ATTACH DATABASE ${quote(bitcoinPath)} AS bitcoin;
  ATTACH DATABASE ${quote(ledgerPath)} AS ledger;
  ATTACH DATABASE ${quote(baselinePath)} AS baseline;`);
const indexedThrough = Number(
  db.prepare("SELECT max(indexed_through_block) height FROM baseline.otc_candidate").get().height,
);

db.exec(`
  DROP TABLE IF EXISTS shadow_match;
  CREATE TABLE shadow_match AS
  SELECT delivery.event_index,delivery.asset_tx_hash,delivery.block_index asset_block,
    delivery.block_time asset_time,delivery.seller_id,delivery.buyer_id,delivery.asset_id,
    delivery.quantity,flow.payee_id,tx.tx_id,tx.tx_hash btc_tx_hash,
    tx.block_height btc_block,tx.block_time btc_time,flow.value_sats payment_sats,
    tx.block_height-delivery.block_index relative_blocks
  FROM bitcoin.btc_direct_flow flow
  JOIN bitcoin.btc_tx tx ON tx.tx_id=flow.tx_id
  JOIN baseline.eligible_delivery delivery ON delivery.buyer_id=flow.payer_id
    AND delivery.block_index BETWEEN tx.block_height-1 AND tx.block_height+3
  LEFT JOIN ledger.address_signals payee ON payee.address_id=flow.payee_id
  WHERE tx.block_height<=${indexedThrough} AND flow.value_sats>=1000
    AND flow.payee_id<>delivery.seller_id AND flow.payee_id<>delivery.buyer_id
    AND (flow.attribution_flags&13)=0
    AND coalesce(payee.is_exchange,0)=0 AND coalesce(payee.is_deposit,0)=0
    AND coalesce(payee.is_burn,0)=0 AND coalesce(payee.is_emblem_vault,0)=0
    AND NOT EXISTS(SELECT 1 FROM bitcoin.counterparty_tx_watch protocol WHERE protocol.tx_hash=tx.tx_hash)
    AND EXISTS(SELECT 1 FROM bitcoin.btc_direct_flow change
      WHERE change.tx_id=flow.tx_id AND change.payer_id=flow.payer_id AND change.payee_id=flow.payer_id)
    AND NOT EXISTS(SELECT 1 FROM baseline.otc_candidate direct
      WHERE direct.event_index=delivery.event_index);

  CREATE INDEX shadow_match_delivery ON shadow_match(event_index,tx_id);
  CREATE INDEX shadow_match_payment ON shadow_match(tx_id,buyer_id,event_index);

  DROP TABLE IF EXISTS shadow_unique;
  CREATE TABLE shadow_unique AS
  WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) competing_payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id) competing_deliveries
    FROM shadow_match match
  )
  SELECT * FROM ranked WHERE competing_payments=1 AND competing_deliveries=1;

  DROP TABLE IF EXISTS shadow_classified;
  CREATE TABLE shadow_classified AS
  WITH priced AS (
    SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
    FROM shadow_unique candidate WHERE candidate.quantity>0
  ), ranked AS (
    SELECT priced.*,
      row_number() OVER(PARTITION BY asset_id,seller_id,payee_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id,seller_id,payee_id) lane_candidates
    FROM priced
  ), medians AS (
    SELECT asset_id,seller_id,payee_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
    FROM ranked WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
    GROUP BY asset_id,seller_id,payee_id
  )
  SELECT ranked.*,medians.median_unit_sats,ranked.unit_sats/medians.median_unit_sats price_ratio
  FROM ranked JOIN medians USING(asset_id,seller_id,payee_id);

  ALTER TABLE shadow_classified ADD COLUMN distinct_lane_buyers INTEGER;
  UPDATE shadow_classified SET distinct_lane_buyers=(
    SELECT count(DISTINCT peer.buyer_id) FROM shadow_unique peer
    WHERE peer.asset_id=shadow_classified.asset_id AND peer.seller_id=shadow_classified.seller_id
      AND peer.payee_id=shadow_classified.payee_id
  );
`);

const summarize = (where) =>
  db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT candidate.asset_id) assets,
      count(DISTINCT candidate.buyer_id) buyers,count(DISTINCT candidate.seller_id) asset_senders,
      count(DISTINCT candidate.payee_id) btc_receivers,sum(candidate.payment_sats) sats,
      round(sum(candidate.payment_sats/1e8*price.usd),2) usd
    FROM shadow_classified candidate LEFT JOIN ledger.prices price
      ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch') WHERE ${where}`,
    )
    .get();

const common = "lane_candidates>=3 AND distinct_lane_buyers>=2 AND price_ratio BETWEEN 0.8 AND 1.25";
const result = {
  indexed_through: indexedThrough,
  raw: Number(db.prepare("SELECT count(*) n FROM shadow_match").get().n),
  unique: Number(db.prepare("SELECT count(*) n FROM shadow_unique").get().n),
  policies: [
    { name: "same_block_repeat3", ...summarize(`${common} AND relative_blocks=0`) },
    { name: "one_block_repeat3", ...summarize(`${common} AND relative_blocks BETWEEN -1 AND 1`) },
    { name: "tight_repeat3", ...summarize(`${common} AND relative_blocks BETWEEN -3 AND 1`) },
    {
      name: "one_block_repeat5",
      ...summarize(
        "lane_candidates>=5 AND distinct_lane_buyers>=3 AND price_ratio BETWEEN 0.8 AND 1.25 AND relative_blocks BETWEEN -1 AND 1",
      ),
    },
  ],
  top_assets: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT candidate.buyer_id) buyers,
      count(DISTINCT candidate.seller_id) asset_senders,count(DISTINCT candidate.payee_id) btc_receivers,
      sum(candidate.payment_sats) sats,round(sum(candidate.payment_sats/1e8*price.usd),2) usd
    FROM shadow_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE ${common} AND candidate.relative_blocks BETWEEN -1 AND 1
    GROUP BY candidate.asset_id ORDER BY usd DESC,trades DESC LIMIT 30`,
    )
    .all(),
  examples: db
    .prepare(
      `SELECT asset.asset,candidate.quantity,candidate.payment_sats,
      round(candidate.payment_sats/1e8*price.usd,2) usd,candidate.relative_blocks,
      candidate.lane_candidates,candidate.distinct_lane_buyers,round(candidate.price_ratio,4) price_ratio,
      buyer.address buyer,seller.address asset_sender,payee_address.address btc_receiver,
      lower(hex(candidate.asset_tx_hash)) asset_tx,lower(hex(candidate.btc_tx_hash)) btc_tx
    FROM shadow_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
    JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
    JOIN bitcoin.watched_address payee_address ON payee_address.address_id=candidate.payee_id
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE ${common} AND candidate.relative_blocks BETWEEN -1 AND 1
    ORDER BY usd DESC,candidate.payment_sats DESC LIMIT 100`,
    )
    .all(),
};

writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ event: "complete", outputPath, ...result }, null, 2));
db.close();
