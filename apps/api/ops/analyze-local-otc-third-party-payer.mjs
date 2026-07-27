#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const bitcoinPath = resolve(option("bitcoin", "C:/BitcoinIndex/counterparty-bitcoin.sqlite"));
const ledgerPath = resolve(option("ledger", "C:/BitcoinIndex/otc-ledger.sqlite"));
const baselinePath = resolve(option("baseline", "C:/BitcoinIndex/otc-census.sqlite"));
const shadowPath = resolve(option("database", "C:/BitcoinIndex/otc-third-party-shadow.sqlite"));
const outputPath = resolve(option("output", ".codex-tmp/otc-third-party-payer.json"));
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
    delivery.block_time asset_time,
    delivery.seller_id,delivery.buyer_id,delivery.asset_id,delivery.quantity,
    flow.payer_id,tx.tx_id,tx.tx_hash btc_tx_hash,tx.block_height btc_block,
    tx.block_time btc_time,flow.value_sats payment_sats,
    tx.block_height-delivery.block_index relative_blocks
  FROM bitcoin.btc_direct_flow flow
  JOIN bitcoin.btc_tx tx ON tx.tx_id=flow.tx_id
  JOIN baseline.eligible_delivery delivery ON delivery.seller_id=flow.payee_id
    AND delivery.block_index BETWEEN tx.block_height-1 AND tx.block_height+3
  LEFT JOIN ledger.address_signals payer ON payer.address_id=flow.payer_id
  WHERE tx.block_height<=${indexedThrough} AND flow.value_sats>=1000
    AND flow.payer_id<>delivery.buyer_id AND flow.payer_id<>delivery.seller_id
    AND (flow.attribution_flags&13)=0
    AND coalesce(payer.is_exchange,0)=0 AND coalesce(payer.is_deposit,0)=0
    AND coalesce(payer.is_burn,0)=0 AND coalesce(payer.is_emblem_vault,0)=0
    AND NOT EXISTS(SELECT 1 FROM bitcoin.counterparty_tx_watch protocol WHERE protocol.tx_hash=tx.tx_hash)
    AND EXISTS(SELECT 1 FROM bitcoin.btc_direct_flow change
      WHERE change.tx_id=flow.tx_id AND change.payer_id=flow.payer_id AND change.payee_id=flow.payer_id)
    AND NOT EXISTS(SELECT 1 FROM baseline.otc_candidate direct
      WHERE direct.event_index=delivery.event_index);

  CREATE INDEX shadow_match_delivery ON shadow_match(event_index,tx_id);
  CREATE INDEX shadow_match_payment ON shadow_match(tx_id,seller_id,event_index);

  DROP TABLE IF EXISTS shadow_unique;
  CREATE TABLE shadow_unique AS
  WITH ranked AS (
    SELECT match.*,
      count(*) OVER(PARTITION BY event_index) competing_payments,
      count(*) OVER(PARTITION BY tx_id,seller_id) competing_deliveries
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
      row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id,seller_id) lane_candidates
    FROM priced
  ), medians AS (
    SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
    FROM ranked WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
    GROUP BY asset_id,seller_id
  )
  SELECT ranked.*,medians.median_unit_sats,ranked.unit_sats/medians.median_unit_sats price_ratio
  FROM ranked JOIN medians USING(asset_id,seller_id);
`);

// SQLite does not support DISTINCT in a window function. Fill the payer count separately.
db.exec(`ALTER TABLE shadow_classified ADD COLUMN distinct_lane_payers INTEGER;
  UPDATE shadow_classified SET distinct_lane_payers=(
    SELECT count(DISTINCT peer.payer_id) FROM shadow_unique peer
    WHERE peer.asset_id=shadow_classified.asset_id AND peer.seller_id=shadow_classified.seller_id
  );`);

db.exec(`ALTER TABLE shadow_classified ADD COLUMN payer_recipient_linked INTEGER NOT NULL DEFAULT 0;
  UPDATE shadow_classified SET payer_recipient_linked=1 WHERE EXISTS(
    SELECT 1 FROM bitcoin.btc_direct_flow relationship
    WHERE relationship.tx_id<>shadow_classified.tx_id AND (
      (relationship.payer_id=shadow_classified.payer_id AND relationship.payee_id=shadow_classified.buyer_id)
      OR (relationship.payer_id=shadow_classified.buyer_id AND relationship.payee_id=shadow_classified.payer_id)
    )
  );`);

const summarize = (where, parameters = []) =>
  db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT candidate.asset_id) assets,
      count(DISTINCT candidate.payer_id) payers,count(DISTINCT candidate.buyer_id) recipients,
      count(DISTINCT candidate.seller_id) sellers,sum(candidate.payment_sats) sats,
      round(sum(candidate.payment_sats/1e8*price.usd),2) usd
    FROM shadow_classified candidate
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE ${where}`,
    )
    .get(...parameters);

const policies = [
  {
    name: "same_block_repeat3",
    where: "relative_blocks=0 AND lane_candidates>=3 AND distinct_lane_payers>=2 AND price_ratio BETWEEN 0.8 AND 1.25",
  },
  {
    name: "one_block_repeat3",
    where:
      "relative_blocks BETWEEN -1 AND 1 AND lane_candidates>=3 AND distinct_lane_payers>=2 AND price_ratio BETWEEN 0.8 AND 1.25",
  },
  {
    name: "tight_repeat3",
    where:
      "relative_blocks BETWEEN -3 AND 1 AND lane_candidates>=3 AND distinct_lane_payers>=2 AND price_ratio BETWEEN 0.8 AND 1.25",
  },
  {
    name: "same_block_repeat10",
    where: "relative_blocks=0 AND lane_candidates>=10 AND distinct_lane_payers>=5 AND price_ratio BETWEEN 0.8 AND 1.25",
  },
  {
    name: "one_block_linked",
    where:
      "relative_blocks BETWEEN -1 AND 1 AND lane_candidates>=3 AND distinct_lane_payers>=2 AND price_ratio BETWEEN 0.8 AND 1.25 AND payer_recipient_linked=1",
  },
  {
    name: "one_block_without_fuuuuh_btc",
    where:
      "relative_blocks BETWEEN -1 AND 1 AND lane_candidates>=3 AND distinct_lane_payers>=2 AND price_ratio BETWEEN 0.8 AND 1.25 AND asset_id<>94069",
  },
];

const result = {
  indexed_through: indexedThrough,
  raw: Number(db.prepare("SELECT count(*) n FROM shadow_match").get().n),
  unique: Number(db.prepare("SELECT count(*) n FROM shadow_unique").get().n),
  policies: policies.map((policy) => ({ name: policy.name, ...summarize(policy.where) })),
  timing: db
    .prepare(
      `SELECT relative_blocks,count(*) matches FROM shadow_unique GROUP BY relative_blocks ORDER BY relative_blocks`,
    )
    .all(),
  top_assets: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT candidate.payer_id) payers,
      count(DISTINCT candidate.buyer_id) recipients,count(DISTINCT candidate.seller_id) sellers,
      sum(candidate.payment_sats) sats,round(sum(candidate.payment_sats/1e8*price.usd),2) usd
    FROM shadow_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE candidate.relative_blocks BETWEEN -1 AND 1 AND candidate.lane_candidates>=3
      AND candidate.distinct_lane_payers>=2 AND candidate.price_ratio BETWEEN 0.8 AND 1.25
    GROUP BY candidate.asset_id ORDER BY usd DESC,trades DESC LIMIT 30`,
    )
    .all(),
  examples: db
    .prepare(
      `SELECT asset.asset,candidate.quantity,candidate.payment_sats,
      round(candidate.payment_sats/1e8*price.usd,2) usd,candidate.relative_blocks,
      candidate.lane_candidates,candidate.distinct_lane_payers,round(candidate.price_ratio,4) price_ratio,
      payer_address.address payer,seller.address seller,buyer.address recipient,
      lower(hex(candidate.asset_tx_hash)) asset_tx,lower(hex(candidate.btc_tx_hash)) btc_tx
    FROM shadow_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    JOIN bitcoin.watched_address payer_address ON payer_address.address_id=candidate.payer_id
    JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
    JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    WHERE candidate.relative_blocks BETWEEN -1 AND 1 AND candidate.lane_candidates>=3
      AND candidate.distinct_lane_payers>=2 AND candidate.price_ratio BETWEEN 0.8 AND 1.25
    ORDER BY usd DESC,candidate.payment_sats DESC LIMIT 50`,
    )
    .all(),
};

writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ event: "complete", outputPath, ...result }, null, 2));
db.close();
