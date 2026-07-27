#!/usr/bin/env node

/**
 * Build a review-only census of direct BTC-for-asset matches that have no
 * repeat seller/asset lane. Nothing produced here is a production authority.
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const option = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const censusPath = resolve(option("census-database", "C:/BitcoinIndex/otc-census.sqlite"));
const bitcoinPath = resolve(option("bitcoin-database", "C:/BitcoinIndex/counterparty-bitcoin.sqlite"));
const ledgerPath = resolve(option("ledger-database", "C:/BitcoinIndex/otc-ledger.sqlite"));
const finalPath = resolve(option("final-database", "C:/BitcoinIndex/otc-final.sqlite"));
const shadowPath = resolve(option("database", "C:/BitcoinIndex/otc-oneoff-shadow.sqlite"));
const outputPath = resolve(option("output", ".codex-tmp/otc-oneoff-shadow.json"));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(shadowPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;
  ATTACH DATABASE ${quote(censusPath)} AS census;
  ATTACH DATABASE ${quote(bitcoinPath)} AS bitcoin;
  ATTACH DATABASE ${quote(ledgerPath)} AS ledger;`);

db.exec(`DROP TABLE IF EXISTS oneoff_candidate;
  CREATE TABLE oneoff_candidate AS
  WITH lane AS (
    SELECT asset_id,seller_id,count(*) lane_candidates
    FROM census.otc_candidate GROUP BY asset_id,seller_id
  ), candidate AS (
    SELECT item.*,payment.tx_position payment_position,
      delivery.tx_position delivery_position,price.usd btc_usd,
      count(*) OVER(PARTITION BY item.tx_id) payment_uses
    FROM census.otc_candidate item JOIN lane USING(asset_id,seller_id)
    JOIN bitcoin.btc_tx payment ON payment.tx_id=item.tx_id
    JOIN bitcoin.btc_tx delivery ON delivery.tx_hash=item.asset_tx_hash
    LEFT JOIN ledger.prices price
      ON price.currency='BTC' AND price.day=date(item.btc_time,'unixepoch')
    WHERE lane.lane_candidates=1 AND item.relative_blocks BETWEEN -3 AND 0
  )
  SELECT *,payment_sats/1e8*btc_usd payment_usd,
    payment_sats/1e8*btc_usd/quantity implied_unit_usd,
    CASE WHEN relative_blocks<0 THEN 1
         WHEN relative_blocks=0 AND payment_position<delivery_position THEN 1 ELSE 0 END causal_order,
    payment_uses=1 unique_payment
  FROM candidate WHERE quantity>0;
  CREATE UNIQUE INDEX oneoff_candidate_event ON oneoff_candidate(event_index);
  CREATE INDEX oneoff_candidate_asset_time ON oneoff_candidate(asset_id,asset_time);`);

// Keep subsequent write transactions local to the shadow database. In particular,
// do not request a write lock from the live scanner through an attached database.
db.exec("DETACH DATABASE census; DETACH DATABASE bitcoin;");

db.exec(`DROP TABLE IF EXISTS low_quality_asset;
  CREATE TABLE low_quality_asset(asset_id INTEGER PRIMARY KEY);`);
const insertLowQuality = db.prepare("INSERT INTO low_quality_asset(asset_id) VALUES(?)");
for (const row of executeRemoteD1("SELECT asset_id FROM asset_signals WHERE low_quality=1").rows)
  insertLowQuality.run(row.asset_id);

db.exec(`DROP TABLE IF EXISTS market_trade;
  CREATE TABLE market_trade(
    trade_rowid INTEGER PRIMARY KEY,venue TEXT NOT NULL,asset_id INTEGER NOT NULL,
    block_time INTEGER NOT NULL,quantity REAL NOT NULL,usd_value REAL NOT NULL,
    buyer_id INTEGER,seller_id INTEGER,sale_class TEXT
  );
  CREATE INDEX market_trade_asset_time ON market_trade(asset_id,block_time);`);
const assetIds = db
  .prepare("SELECT DISTINCT asset_id FROM oneoff_candidate ORDER BY asset_id")
  .all()
  .map((r) => r.asset_id);
const insertMarket = db.prepare(`INSERT OR IGNORE INTO market_trade
  (trade_rowid,venue,asset_id,block_time,quantity,usd_value,buyer_id,seller_id,sale_class)
  VALUES(?,?,?,?,?,?,?,?,?)`);
for (let offset = 0; offset < assetIds.length; offset += 150) {
  const ids = assetIds.slice(offset, offset + 150).join(",");
  let cursor = 0;
  while (true) {
    const result = executeRemoteD1(`SELECT rowid trade_rowid,venue,asset_id,block_time,quantity,
        usd_value,buyer_id,seller_id,sale_class FROM trades
      WHERE rowid>${cursor} AND asset_id IN (${ids}) AND venue<>'otc'
        AND block_time>0 AND quantity>0 AND usd_value>0
        AND buyer_id IS NOT NULL AND seller_id IS NOT NULL AND buyer_id<>seller_id
        AND (venue='dex' OR (venue='dispense' AND sale_class='single')
          OR (venue='tokenly_swapbot' AND sale_class='single')
          OR (venue='emblem' AND sale_class='real'))
      ORDER BY rowid LIMIT 10000`);
    if (!result.rows.length) break;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of result.rows)
        insertMarket.run(
          row.trade_rowid,
          row.venue,
          row.asset_id,
          row.block_time,
          row.quantity,
          row.usd_value,
          row.buyer_id,
          row.seller_id,
          row.sale_class,
        );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    cursor = Number(result.rows.at(-1).trade_rowid);
    if (result.rows.length < 10000) break;
  }
  process.stderr.write(`market anchors ${Math.min(offset + 150, assetIds.length)}/${assetIds.length}\n`);
}

db.exec(`DROP TABLE IF EXISTS market_pair;
  CREATE TABLE market_pair AS
  SELECT candidate.event_index,trade.trade_rowid,
    abs(trade.block_time-candidate.asset_time)/86400.0 distance_days,
    trade.usd_value/trade.quantity market_unit_usd
  FROM oneoff_candidate candidate JOIN market_trade trade USING(asset_id)
  WHERE abs(trade.block_time-candidate.asset_time)<=15552000;
  CREATE INDEX market_pair_event ON market_pair(event_index,distance_days);

  DROP TABLE IF EXISTS market_median;
  CREATE TABLE market_median AS
  WITH windows(window_name,max_days) AS (VALUES('30d',30),('180d',180)),
  ranked AS (
    SELECT pair.event_index,windows.window_name,pair.market_unit_usd,
      row_number() OVER(PARTITION BY pair.event_index,windows.window_name
        ORDER BY pair.market_unit_usd,pair.trade_rowid) price_rank,
      count(*) OVER(PARTITION BY pair.event_index,windows.window_name) observations
    FROM market_pair pair JOIN windows ON pair.distance_days<=windows.max_days
  )
  SELECT event_index,window_name,avg(market_unit_usd) median_unit_usd,max(observations) observations
  FROM ranked WHERE price_rank IN ((observations+1)/2,(observations+2)/2)
  GROUP BY event_index,window_name;
  CREATE UNIQUE INDEX market_median_event_window ON market_median(event_index,window_name);

  DROP TABLE IF EXISTS oneoff_classified;
  CREATE TABLE oneoff_classified AS
  SELECT candidate.*,near.median_unit_usd median_30d,near.observations observations_30d,
    wide.median_unit_usd median_180d,wide.observations observations_180d,
    candidate.implied_unit_usd/near.median_unit_usd ratio_30d,
    candidate.implied_unit_usd/wide.median_unit_usd ratio_180d,
    CASE
      WHEN candidate.unique_payment=0 THEN 'reject_payment_conflict'
      WHEN candidate.causal_order=0 THEN 'delivery_first_same_block'
      WHEN near.observations>=2 AND candidate.implied_unit_usd/near.median_unit_usd BETWEEN 0.5 AND 2
        THEN 'corroborated_30d_multi'
      WHEN near.observations=1 AND candidate.implied_unit_usd/near.median_unit_usd BETWEEN 0.6666667 AND 1.5
        THEN 'corroborated_30d_single'
      WHEN wide.observations>=2 AND candidate.implied_unit_usd/wide.median_unit_usd BETWEEN 0.25 AND 4
        THEN 'plausible_180d_multi'
      WHEN candidate.relative_blocks=0 THEN 'causal_same_block_unpriced'
      ELSE 'causal_prior_block_unpriced'
    END classification
  FROM oneoff_candidate candidate
  LEFT JOIN market_median near ON near.event_index=candidate.event_index AND near.window_name='30d'
  LEFT JOIN market_median wide ON wide.event_index=candidate.event_index AND wide.window_name='180d';
  CREATE UNIQUE INDEX oneoff_classified_event ON oneoff_classified(event_index);

  DROP TABLE IF EXISTS market_breadth;
  CREATE TABLE market_breadth AS
  WITH windows(window_name,max_days) AS (VALUES('30d',30),('180d',180))
  SELECT pair.event_index,windows.window_name,count(*) observations,
    count(DISTINCT trade.buyer_id) buyers,count(DISTINCT trade.seller_id) sellers,
    count(DISTINCT trade.venue) venues
  FROM market_pair pair JOIN market_trade trade USING(trade_rowid)
  JOIN windows ON pair.distance_days<=windows.max_days
  GROUP BY pair.event_index,windows.window_name;
  CREATE UNIQUE INDEX market_breadth_event_window ON market_breadth(event_index,window_name);

  DROP TABLE IF EXISTS oneoff_recommended;
  CREATE TABLE oneoff_recommended AS
  SELECT candidate.*,
    CASE WHEN candidate.observations_30d>=3 AND candidate.ratio_30d BETWEEN 0.6666667 AND 1.5
      AND near.buyers>=2 AND near.sellers>=2 THEN 'strict_30d'
      ELSE 'strict_180d' END recommendation_reason
  FROM oneoff_classified candidate
  LEFT JOIN market_breadth near
    ON near.event_index=candidate.event_index AND near.window_name='30d'
  LEFT JOIN market_breadth wide
    ON wide.event_index=candidate.event_index AND wide.window_name='180d'
  WHERE candidate.unique_payment=1
    AND NOT EXISTS(SELECT 1 FROM low_quality_asset low WHERE low.asset_id=candidate.asset_id) AND (
    (candidate.observations_30d>=3 AND candidate.ratio_30d BETWEEN 0.6666667 AND 1.5
      AND near.buyers>=2 AND near.sellers>=2)
    OR (candidate.observations_180d>=3 AND candidate.ratio_180d BETWEEN 0.5 AND 2
      AND wide.buyers>=2 AND wide.sellers>=2));
  CREATE UNIQUE INDEX oneoff_recommended_event ON oneoff_recommended(event_index);`);

db.exec(`ATTACH DATABASE ${quote(finalPath)} AS final;
  DROP TABLE IF EXISTS accepted_actor_history;
  CREATE TABLE accepted_actor_history AS
  SELECT event_index,asset_id,buyer_id,seller_id,primary_tx_id FROM final.final_admitted;
  CREATE INDEX accepted_actor_seller ON accepted_actor_history(seller_id,buyer_id);
  CREATE INDEX accepted_actor_pair ON accepted_actor_history(buyer_id,seller_id);

  DROP TABLE IF EXISTS accepted_otc_market;
  CREATE TABLE accepted_otc_market AS
  SELECT accepted.event_index,accepted.asset_id,accepted.buyer_id,accepted.seller_id,
    accepted.btc_time,accepted.payment_sats/1e8*price.usd/accepted.quantity unit_usd
  FROM final.final_admitted accepted LEFT JOIN ledger.prices price
    ON price.currency='BTC' AND price.day=date(accepted.btc_time,'unixepoch')
  WHERE accepted.quantity>0 AND price.usd>0;
  CREATE INDEX accepted_otc_market_asset_time ON accepted_otc_market(asset_id,btc_time);
  DETACH DATABASE final;

  DROP TABLE IF EXISTS followup_cross;
  CREATE TABLE followup_cross AS
  WITH ranked AS (
    SELECT candidate.*,
      row_number() OVER(PARTITION BY asset_id ORDER BY implied_unit_usd,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id) candidates
    FROM oneoff_classified candidate WHERE candidate.unique_payment=1
      AND NOT EXISTS(SELECT 1 FROM low_quality_asset low WHERE low.asset_id=candidate.asset_id)
  ), median AS (
    SELECT asset_id,avg(implied_unit_usd) median_unit_usd,max(candidates) candidates
    FROM ranked WHERE price_rank IN ((candidates+1)/2,(candidates+2)/2) GROUP BY asset_id
  ), breadth AS (
    SELECT asset_id,count(DISTINCT buyer_id) buyers,count(DISTINCT seller_id) sellers
    FROM ranked GROUP BY asset_id
  )
  SELECT ranked.event_index FROM ranked JOIN median USING(asset_id) JOIN breadth USING(asset_id)
  WHERE median.candidates>=3 AND breadth.buyers>=2 AND breadth.sellers>=2
    AND ranked.implied_unit_usd/median.median_unit_usd BETWEEN 0.5 AND 2;
  CREATE UNIQUE INDEX followup_cross_event ON followup_cross(event_index);

  DROP TABLE IF EXISTS followup_pair;
  CREATE TABLE followup_pair AS
  SELECT candidate.event_index FROM oneoff_classified candidate
  WHERE candidate.unique_payment=1
    AND NOT EXISTS(SELECT 1 FROM low_quality_asset low WHERE low.asset_id=candidate.asset_id)
    AND EXISTS(SELECT 1 FROM accepted_actor_history accepted
      WHERE accepted.buyer_id=candidate.buyer_id AND accepted.seller_id=candidate.seller_id);
  CREATE UNIQUE INDEX followup_pair_event ON followup_pair(event_index);

  DROP TABLE IF EXISTS followup_otc_anchor;
  CREATE TABLE followup_otc_anchor AS
  WITH pair AS (
    SELECT candidate.event_index,accepted.unit_usd
    FROM oneoff_classified candidate JOIN accepted_otc_market accepted USING(asset_id)
    WHERE abs(accepted.btc_time-candidate.asset_time)<=31536000
  ), ranked AS (
    SELECT event_index,unit_usd,row_number() OVER(PARTITION BY event_index ORDER BY unit_usd) price_rank,
      count(*) OVER(PARTITION BY event_index) observations FROM pair
  ), median AS (
    SELECT event_index,avg(unit_usd) median_unit_usd,max(observations) observations
    FROM ranked WHERE price_rank IN ((observations+1)/2,(observations+2)/2) GROUP BY event_index
  ), breadth AS (
    SELECT candidate.event_index,count(DISTINCT accepted.buyer_id) buyers
    FROM oneoff_classified candidate JOIN accepted_otc_market accepted USING(asset_id)
    WHERE abs(accepted.btc_time-candidate.asset_time)<=31536000 GROUP BY candidate.event_index
  )
  SELECT candidate.event_index FROM oneoff_classified candidate
  JOIN median USING(event_index) JOIN breadth USING(event_index)
  WHERE candidate.unique_payment=1
    AND NOT EXISTS(SELECT 1 FROM low_quality_asset low WHERE low.asset_id=candidate.asset_id)
    AND median.observations>=2 AND breadth.buyers>=2
    AND candidate.implied_unit_usd/median.median_unit_usd BETWEEN 0.25 AND 4;
  CREATE UNIQUE INDEX followup_otc_anchor_event ON followup_otc_anchor(event_index);

  DROP TABLE IF EXISTS oneoff_promoted;
  CREATE TABLE oneoff_promoted AS
  WITH promoted AS (
    SELECT event_index,'direct_btc_single_external_market' method,
      'Unique direct BTC/asset exchange corroborated by a broad independent market price' evidence_note,1 priority
    FROM oneoff_recommended
    UNION ALL
    SELECT event_index,'direct_btc_single_prior_otc_market',
      'Unique direct BTC/asset exchange corroborated by accepted OTC prices for the same asset',2
    FROM followup_otc_anchor
    UNION ALL
    SELECT event_index,'direct_btc_single_prior_counterparty',
      'Unique direct BTC/asset exchange between a previously accepted OTC buyer/seller pair',3
    FROM followup_pair
    UNION ALL
    SELECT event_index,'direct_btc_single_cross_seller',
      'Unique direct BTC/asset exchange corroborated by consistent one-off prices across sellers',4
    FROM followup_cross
  ), selected AS (
    SELECT promoted.*,row_number() OVER(PARTITION BY event_index ORDER BY priority) method_rank
    FROM promoted
  )
  SELECT candidate.*,selected.method,selected.evidence_note
  FROM oneoff_classified candidate JOIN selected USING(event_index) WHERE selected.method_rank=1;
  CREATE UNIQUE INDEX oneoff_promoted_event ON oneoff_promoted(event_index);
  CREATE UNIQUE INDEX oneoff_promoted_payment ON oneoff_promoted(tx_id);`);

const summary = {
  generated_at: Math.floor(Date.now() / 1000),
  indexed_through: db.prepare("SELECT max(indexed_through_block) height FROM oneoff_candidate").get().height,
  market_trades: db.prepare("SELECT count(*) count FROM market_trade").get().count,
  total: db
    .prepare(
      `SELECT count(*) candidates,count(DISTINCT asset_id) assets,
      count(DISTINCT buyer_id) buyers,count(DISTINCT seller_id) sellers,
      round(sum(payment_sats)/1e8,8) btc,round(sum(payment_usd),2) usd
    FROM oneoff_classified`,
    )
    .get(),
  classifications: db
    .prepare(
      `SELECT classification,count(*) trades,count(DISTINCT asset_id) assets,
      round(sum(payment_sats)/1e8,8) btc,round(sum(payment_usd),2) usd
    FROM oneoff_classified GROUP BY classification ORDER BY trades DESC`,
    )
    .all(),
  accepted: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT asset_id) assets,
      count(DISTINCT buyer_id) buyers,count(DISTINCT seller_id) sellers,
      round(sum(payment_sats)/1e8,8) btc,round(sum(payment_usd),2) usd
    FROM oneoff_classified WHERE classification LIKE 'corroborated_%'
      OR classification='plausible_180d_multi'`,
    )
    .get(),
  recommended: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT asset_id) assets,
      count(DISTINCT buyer_id) buyers,count(DISTINCT seller_id) sellers,
      round(sum(payment_sats)/1e8,8) btc,round(sum(payment_usd),2) usd
    FROM oneoff_recommended`,
    )
    .get(),
  recommendation_reasons: db
    .prepare(
      `SELECT recommendation_reason,count(*) trades,count(DISTINCT asset_id) assets,
      round(sum(payment_usd),2) usd FROM oneoff_recommended
      GROUP BY recommendation_reason ORDER BY recommendation_reason`,
    )
    .all(),
  promoted: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT asset_id) assets,
      count(DISTINCT buyer_id) buyers,count(DISTINCT seller_id) sellers,
      round(sum(payment_sats)/1e8,8) btc,round(sum(payment_usd),2) usd
    FROM oneoff_promoted`,
    )
    .get(),
  promotion_methods: db
    .prepare(
      `SELECT method,count(*) trades,count(DISTINCT asset_id) assets,
      round(sum(payment_usd),2) usd FROM oneoff_promoted GROUP BY method ORDER BY trades DESC`,
    )
    .all(),
  samples: db
    .prepare(
      `SELECT asset.asset,candidate.classification,candidate.payment_usd,
      candidate.relative_blocks,candidate.payment_position,candidate.delivery_position,
      candidate.observations_30d,candidate.ratio_30d,candidate.observations_180d,candidate.ratio_180d,
      lower(hex(candidate.asset_tx_hash)) asset_tx,lower(hex(candidate.btc_tx_hash)) btc_tx
    FROM oneoff_classified candidate JOIN ledger.asset_dictionary asset USING(asset_id)
    ORDER BY candidate.payment_usd DESC LIMIT 100`,
    )
    .all(),
};
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
db.close();
