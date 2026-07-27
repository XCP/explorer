#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const bitcoinPath = resolve(option("bitcoin-database", "C:/BitcoinIndex/counterparty-bitcoin.sqlite"));
const ledgerPath = resolve(option("ledger-database", "C:/BitcoinIndex/otc-ledger.sqlite"));
const censusPath = resolve(option("database", "C:/BitcoinIndex/otc-census.sqlite"));
const outputPath = resolve(option("output", ".codex-tmp/otc-census-summary.json"));
const beforeBlocks = Math.max(0, Number(option("before-blocks", "24")));
const afterBlocks = Math.max(0, Number(option("after-blocks", "3")));
const minSats = Math.max(1, Number(option("min-sats", "1000")));
const methodVersion = 1;

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(censusPath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;");
db.exec(`ATTACH DATABASE ${quote(bitcoinPath)} AS bitcoin; ATTACH DATABASE ${quote(ledgerPath)} AS ledger;`);

const scan = db
  .prepare("SELECT block_height,lower(hex(block_hash)) block_hash FROM bitcoin.scan_state WHERE singleton=1")
  .get();
if (!scan) throw new Error("Bitcoin index has no durable scan checkpoint");
const indexedThrough = Number(scan.block_height);
const ledgerTip = Number(db.prepare("SELECT max(block_index) tip FROM ledger.sends").get().tip ?? 0);
const censusThrough = Math.min(indexedThrough, ledgerTip);

console.log(
  JSON.stringify({ event: "start", indexedThrough, ledgerTip, censusThrough, beforeBlocks, afterBlocks, minSats }),
);

db.exec(`
  DROP TABLE IF EXISTS eligible_delivery;
  CREATE TABLE eligible_delivery (
    event_index INTEGER PRIMARY KEY,
    asset_tx_hash BLOB NOT NULL,
    block_index INTEGER NOT NULL,
    block_time INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    quantity REAL NOT NULL
  );

  INSERT INTO eligible_delivery
  SELECT send.event_index,send.tx_hash,send.block_index,send.block_time,
    coalesce(send.source_address_id,send.source_id),
    coalesce(send.destination_address_id,send.destination_id),
    send.asset_id,CAST(send.quantity_normalized AS REAL)
  FROM ledger.sends send
  JOIN ledger.asset_dictionary asset ON asset.asset_id=send.asset_id
  LEFT JOIN ledger.address_signals seller
    ON seller.address_id=coalesce(send.source_address_id,send.source_id)
  LEFT JOIN ledger.address_signals buyer
    ON buyer.address_id=coalesce(send.destination_address_id,send.destination_id)
  JOIN ledger.address_dictionary seller_address
    ON seller_address.address_id=coalesce(send.source_address_id,send.source_id)
  JOIN ledger.address_dictionary buyer_address
    ON buyer_address.address_id=coalesce(send.destination_address_id,send.destination_id)
  WHERE send.block_index<=${censusThrough} AND send.block_time IS NOT NULL
    AND coalesce(send.status,'valid')='valid'
    AND coalesce(send.source_address_id,send.source_id) IS NOT NULL
    AND coalesce(send.destination_address_id,send.destination_id) IS NOT NULL
    AND coalesce(send.source_address_id,send.source_id)<>coalesce(send.destination_address_id,send.destination_id)
    AND CAST(send.quantity_normalized AS REAL)>0 AND asset.asset<>'BTC'
    AND (seller_address.address LIKE '1%' OR seller_address.address LIKE '3%' OR seller_address.address LIKE 'bc1%')
    AND (buyer_address.address LIKE '1%' OR buyer_address.address LIKE '3%' OR buyer_address.address LIKE 'bc1%')
    AND coalesce(seller.is_exchange,0)=0 AND coalesce(buyer.is_exchange,0)=0
    AND coalesce(seller.is_deposit,0)=0 AND coalesce(buyer.is_deposit,0)=0
    AND coalesce(seller.is_burn,0)=0 AND coalesce(buyer.is_burn,0)=0
    AND coalesce(seller.is_emblem_vault,0)=0 AND coalesce(buyer.is_emblem_vault,0)=0
    AND NOT EXISTS(SELECT 1 FROM ledger.trade_legs leg WHERE leg.leg_index=send.event_index)
    AND NOT EXISTS(SELECT 1 FROM ledger.tokenly_swapbots bot WHERE bot.address=seller_address.address);

  CREATE INDEX eligible_delivery_pair_block
    ON eligible_delivery(buyer_id,seller_id,block_index,event_index);
  CREATE INDEX eligible_delivery_asset ON eligible_delivery(asset_id,block_index,event_index);

  DROP TABLE IF EXISTS raw_match;
  CREATE TABLE raw_match AS
  SELECT delivery.event_index,delivery.asset_tx_hash,delivery.block_index asset_block,
    delivery.block_time asset_time,delivery.seller_id,delivery.buyer_id,delivery.asset_id,
    delivery.quantity,tx.tx_id,tx.tx_hash btc_tx_hash,tx.block_height btc_block,
    tx.block_time btc_time,tx.tx_position,flow.value_sats payment_sats,
    flow.payer_input_count,flow.payee_output_count,flow.attribution_flags,
    tx.block_height-delivery.block_index relative_blocks
  FROM bitcoin.btc_direct_flow flow
  JOIN bitcoin.btc_tx tx ON tx.tx_id=flow.tx_id
  JOIN eligible_delivery delivery ON delivery.buyer_id=flow.payer_id
    AND delivery.seller_id=flow.payee_id
    AND delivery.block_index BETWEEN tx.block_height-${afterBlocks} AND tx.block_height+${beforeBlocks}
  WHERE tx.block_height<=${censusThrough} AND flow.value_sats>=${minSats}
    AND (flow.attribution_flags&13)=0
    AND NOT EXISTS(
      SELECT 1 FROM bitcoin.counterparty_tx_watch protocol WHERE protocol.tx_hash=tx.tx_hash
    )
    AND EXISTS(
      SELECT 1 FROM bitcoin.btc_direct_flow change
      WHERE change.tx_id=flow.tx_id AND change.payer_id=flow.payer_id AND change.payee_id=flow.payer_id
    );

  CREATE INDEX raw_match_delivery ON raw_match(event_index,tx_id);
  CREATE INDEX raw_match_payment ON raw_match(tx_id,buyer_id,seller_id,event_index);

  DROP TABLE IF EXISTS otc_candidate;
  CREATE TABLE otc_candidate AS
  WITH ranked AS (
    SELECT match.*,
      count(*) OVER (PARTITION BY event_index) competing_payments,
      count(*) OVER (PARTITION BY tx_id,buyer_id,seller_id) competing_deliveries
    FROM raw_match match
  )
  SELECT ranked.*,
    CASE WHEN relative_blocks BETWEEN -3 AND 0 THEN 'tight'
         WHEN relative_blocks BETWEEN -12 AND 3 THEN 'strong'
         ELSE 'extended' END timing_tier,
    ${methodVersion} method_version,${censusThrough} indexed_through_block
  FROM ranked WHERE competing_payments=1 AND competing_deliveries=1;

  CREATE UNIQUE INDEX otc_candidate_identity ON otc_candidate(event_index,tx_id);
  CREATE INDEX otc_candidate_asset ON otc_candidate(asset_id,asset_block,event_index);

  DROP TABLE IF EXISTS otc_admitted;
  CREATE TABLE otc_admitted AS
  WITH priced AS (
    SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
    FROM otc_candidate candidate WHERE candidate.quantity>0
  ), ranked AS (
    SELECT priced.*,
      row_number() OVER (PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER (PARTITION BY asset_id,seller_id) lane_candidates
    FROM priced
  ), medians AS (
    SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
    FROM ranked
    WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
    GROUP BY asset_id,seller_id
  ), lanes AS (
    SELECT candidate.asset_id,candidate.seller_id,count(DISTINCT candidate.buyer_id) lane_buyers
    FROM otc_candidate candidate GROUP BY candidate.asset_id,candidate.seller_id
  )
  SELECT ranked.*,median.median_unit_sats,lane.lane_buyers,
    ranked.unit_sats/median.median_unit_sats price_to_lane_median,
    'repeat_price_lane' admission_reason
  FROM ranked
  JOIN medians median USING(asset_id,seller_id)
  JOIN lanes lane USING(asset_id,seller_id)
  WHERE median.lane_candidates>=3 AND lane.lane_buyers>=2
    AND ranked.unit_sats BETWEEN median.median_unit_sats*0.8 AND median.median_unit_sats*1.25;

  CREATE UNIQUE INDEX otc_admitted_identity ON otc_admitted(event_index,tx_id);
  CREATE INDEX otc_admitted_asset ON otc_admitted(asset_id,asset_block,event_index);
`);

const summary = {
  generated_at: Math.floor(Date.now() / 1000),
  method_version: methodVersion,
  bitcoin_checkpoint: { height: indexedThrough, hash: scan.block_hash },
  ledger_tip: ledgerTip,
  census_through: censusThrough,
  policy: { before_blocks: beforeBlocks, after_blocks: afterBlocks, min_sats: minSats },
  eligible_deliveries: Number(db.prepare("SELECT count(*) n FROM eligible_delivery").get().n),
  raw_matches: Number(db.prepare("SELECT count(*) n FROM raw_match").get().n),
  candidates: Number(db.prepare("SELECT count(*) n FROM otc_candidate").get().n),
  admitted: Number(db.prepare("SELECT count(*) n FROM otc_admitted").get().n),
  timing: db
    .prepare(
      "SELECT timing_tier,count(*) candidates,sum(payment_sats) sats FROM otc_candidate GROUP BY timing_tier ORDER BY timing_tier",
    )
    .all(),
  top_assets: db
    .prepare(
      `SELECT asset.asset,count(*) candidates,sum(candidate.payment_sats) sats,
      round(sum(candidate.payment_sats/1e8*price.usd),2) usd
      FROM otc_candidate candidate JOIN ledger.asset_dictionary asset USING(asset_id)
      LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.asset_time,'unixepoch')
      GROUP BY candidate.asset_id ORDER BY candidates DESC,sats DESC LIMIT 50`,
    )
    .all(),
  admitted_top_assets: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT candidate.buyer_id) buyers,
      sum(candidate.payment_sats) sats,round(sum(candidate.payment_sats/1e8*price.usd),2) usd
      FROM otc_admitted candidate JOIN ledger.asset_dictionary asset USING(asset_id)
      LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.asset_time,'unixepoch')
      GROUP BY candidate.asset_id ORDER BY trades DESC,sats DESC LIMIT 50`,
    )
    .all(),
  largest: db
    .prepare(
      `SELECT candidate.event_index,asset.asset,candidate.quantity,
      lower(hex(candidate.asset_tx_hash)) asset_tx,lower(hex(candidate.btc_tx_hash)) btc_tx,
      seller.address seller,buyer.address buyer,candidate.asset_block,candidate.btc_block,
      candidate.relative_blocks,candidate.payment_sats,candidate.timing_tier,
      round(candidate.payment_sats/1e8*price.usd,2) usd
      FROM otc_candidate candidate
      JOIN ledger.asset_dictionary asset USING(asset_id)
      JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
      JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
      LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.asset_time,'unixepoch')
      ORDER BY candidate.payment_sats DESC LIMIT 100`,
    )
    .all(),
};

writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ event: "complete", censusPath, outputPath, ...summary }, null, 2));
db.close();
