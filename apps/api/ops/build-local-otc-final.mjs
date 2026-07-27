#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const arg = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const finalPath = resolve(arg("final", "C:/BitcoinIndex/otc-final.sqlite"));
const priorPath = resolve(arg("prior", "C:/BitcoinIndex/otc-complete-authoritative-20260724.sqlite"));
const baselinePath = resolve(arg("baseline", "C:/BitcoinIndex/otc-census.sqlite"));
const widePath = resolve(arg("wide", "C:/BitcoinIndex/otc-census-wide.sqlite"));
const payeePath = resolve(arg("payee", "C:/BitcoinIndex/otc-third-party-payee.sqlite"));
const bitcoinPath = resolve(arg("bitcoin", "C:/BitcoinIndex/counterparty-bitcoin.sqlite"));
const ledgerPath = resolve(arg("ledger", "C:/BitcoinIndex/otc-ledger.sqlite"));
const oneoffPath = resolve(arg("oneoff", "C:/BitcoinIndex/otc-oneoff-test-20260725.sqlite"));
const outputPath = resolve(arg("summary", ".codex-tmp/otc-final-summary.json"));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(finalPath);
const priorAttach =
  priorPath.toLowerCase() === finalPath.toLowerCase() ? "" : `ATTACH DATABASE ${quote(priorPath)} AS prior;`;
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;
  ATTACH DATABASE ${quote(baselinePath)} AS baseline;
  ATTACH DATABASE ${quote(widePath)} AS wide;
  ATTACH DATABASE ${quote(payeePath)} AS payee;
  ATTACH DATABASE ${quote(bitcoinPath)} AS bitcoin;
  ATTACH DATABASE ${quote(ledgerPath)} AS ledger;
  ATTACH DATABASE ${quote(oneoffPath)} AS oneoff;
  ${priorAttach}`);

const baselineThrough = Number(
  db.prepare("SELECT max(indexed_through_block) height FROM baseline.otc_candidate").get().height,
);
const lowQualityText = execFileSync(
  process.execPath,
  [
    resolve("node_modules/wrangler/bin/wrangler.js"),
    "d1",
    "execute",
    "xcpio-core",
    "--remote",
    "--command",
    "SELECT asset_id FROM asset_signals WHERE low_quality=1 ORDER BY asset_id",
    "--json",
  ],
  { cwd: resolve("apps/api"), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
const lowQuality = JSON.parse(lowQualityText)[0].results.map((row) => Number(row.asset_id));

db.exec(`DROP TABLE IF EXISTS low_quality_asset;
  CREATE TABLE low_quality_asset(asset_id INTEGER PRIMARY KEY);`);
const insertLowQuality = db.prepare("INSERT INTO low_quality_asset(asset_id) VALUES(?)");
for (const assetId of lowQuality) insertLowQuality.run(assetId);

db.exec(`DROP TABLE IF EXISTS main.final_admitted;
  CREATE TABLE final_admitted(
    event_index INTEGER NOT NULL,
    asset_tx_hash BLOB NOT NULL,
    asset_block INTEGER NOT NULL,
    asset_time INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    primary_tx_id INTEGER NOT NULL,
    primary_btc_tx_hash BLOB NOT NULL,
    btc_block INTEGER NOT NULL,
    btc_time INTEGER NOT NULL,
    payment_sats INTEGER NOT NULL,
    payer_input_count INTEGER NOT NULL,
    payee_output_count INTEGER NOT NULL,
    attribution_flags INTEGER NOT NULL,
    relative_blocks INTEGER NOT NULL,
    method TEXT NOT NULL,
    method_version INTEGER NOT NULL,
    indexed_through_block INTEGER NOT NULL,
    lane_candidates INTEGER NOT NULL,
    lane_buyers INTEGER NOT NULL,
    price_ratio REAL NOT NULL,
    evidence_note TEXT NOT NULL,
    payment_json TEXT NOT NULL,
    PRIMARY KEY(event_index,method)
  ) WITHOUT ROWID;

  ${priorAttach ? `INSERT OR IGNORE INTO final_admitted SELECT * FROM prior.final_admitted;` : ""}

  INSERT OR IGNORE INTO final_admitted
  SELECT event_index,asset_tx_hash,asset_block,asset_time,seller_id,buyer_id,asset_id,quantity,
    tx_id,btc_tx_hash,btc_block,btc_time,payment_sats,payer_input_count,payee_output_count,
    attribution_flags,relative_blocks,'direct_btc_for_counterparty_asset',2,${baselineThrough},
    lane_candidates,lane_buyers,price_to_lane_median,
    'Unique direct payment and delivery; globally stable repeat-price lane',
    json_array(json_object('tx_hash',lower(hex(btc_tx_hash)),'block',btc_block,'time',btc_time,'sats',payment_sats))
  FROM baseline.otc_admitted;

  INSERT OR IGNORE INTO final_admitted
  WITH priced AS (
    SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
    FROM baseline.otc_candidate candidate WHERE candidate.quantity>0
  ), lane AS (
    SELECT asset_id,seller_id,count(*) lane_candidates,count(DISTINCT buyer_id) lane_buyers,
      min(unit_sats) min_unit,max(unit_sats) max_unit,avg(unit_sats) median_unit_sats
    FROM priced GROUP BY asset_id,seller_id
    HAVING count(*)=2 AND count(DISTINCT buyer_id)=2 AND max(unit_sats)/min(unit_sats)<=1.25
  )
  SELECT candidate.event_index,candidate.asset_tx_hash,candidate.asset_block,candidate.asset_time,
    candidate.seller_id,candidate.buyer_id,candidate.asset_id,candidate.quantity,
    candidate.tx_id,candidate.btc_tx_hash,candidate.btc_block,candidate.btc_time,candidate.payment_sats,
    candidate.payer_input_count,candidate.payee_output_count,candidate.attribution_flags,
    candidate.relative_blocks,'direct_btc_two_match_lane',2,${baselineThrough},
    lane.lane_candidates,lane.lane_buyers,candidate.unit_sats/lane.median_unit_sats,
    'Unique direct payment and delivery; two independent buyers with <=25% unit-price spread',
    json_array(json_object('tx_hash',lower(hex(candidate.btc_tx_hash)),'block',candidate.btc_block,
      'time',candidate.btc_time,'sats',candidate.payment_sats))
  FROM priced candidate JOIN lane USING(asset_id,seller_id);

  INSERT OR IGNORE INTO final_admitted
  WITH base AS (
    SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
    FROM baseline.otc_candidate candidate WHERE candidate.quantity>0
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
    SELECT base.*,lane.lane_candidates,lane.lane_buyers
    FROM base JOIN lane USING(asset_id,seller_id) JOIN global_median USING(asset_id,seller_id)
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
      AND abs(peer.asset_time-target.asset_time)<=2592000 GROUP BY target.event_index
  )
  SELECT target.event_index,target.asset_tx_hash,target.asset_block,target.asset_time,target.seller_id,
    target.buyer_id,target.asset_id,target.quantity,target.tx_id,target.btc_tx_hash,target.btc_block,
    target.btc_time,target.payment_sats,target.payer_input_count,target.payee_output_count,
    target.attribution_flags,target.relative_blocks,'direct_btc_temporal_lane',2,${baselineThrough},
    target.lane_candidates,target.lane_buyers,target.unit_sats/peer_median.local_median,
    'Unique direct payment and delivery; leave-one-out 30-day local median supported by >=3 peers and >=2 other buyers',
    json_array(json_object('tx_hash',lower(hex(target.btc_tx_hash)),'block',target.btc_block,
      'time',target.btc_time,'sats',target.payment_sats))
  FROM target JOIN peer_median ON peer_median.target_event=target.event_index
  JOIN peer_buyers ON peer_buyers.target_event=target.event_index
  WHERE peer_median.peer_count>=3 AND peer_buyers.peer_buyers>=2
    AND target.unit_sats BETWEEN peer_median.local_median*0.8 AND peer_median.local_median*1.25;

  INSERT OR IGNORE INTO final_admitted
  WITH canonical_priced AS (
    SELECT candidate.*,candidate.payment_sats/candidate.quantity unit_sats
    FROM baseline.otc_candidate candidate WHERE candidate.quantity>0
  ), canonical_rank AS (
    SELECT canonical_priced.*,
      row_number() OVER(PARTITION BY asset_id,seller_id ORDER BY unit_sats,event_index) price_rank,
      count(*) OVER(PARTITION BY asset_id,seller_id) lane_candidates
    FROM canonical_priced
  ), canonical_median AS (
    SELECT asset_id,seller_id,avg(unit_sats) median_unit_sats,max(lane_candidates) lane_candidates
    FROM canonical_rank WHERE price_rank IN ((lane_candidates+1)/2,(lane_candidates+2)/2)
    GROUP BY asset_id,seller_id
  ), canonical_buyers AS (
    SELECT asset_id,seller_id,count(DISTINCT buyer_id) lane_buyers
    FROM canonical_priced GROUP BY asset_id,seller_id
  )
  SELECT candidate.event_index,candidate.asset_tx_hash,candidate.asset_block,candidate.asset_time,
    candidate.seller_id,candidate.buyer_id,candidate.asset_id,candidate.quantity,candidate.tx_id,
    candidate.btc_tx_hash,candidate.btc_block,candidate.btc_time,candidate.payment_sats,
    candidate.payer_input_count,candidate.payee_output_count,candidate.attribution_flags,
    candidate.relative_blocks,'direct_btc_delayed_delivery',2,${baselineThrough},
    median.lane_candidates,buyers.lane_buyers,
    (candidate.payment_sats/candidate.quantity)/median.median_unit_sats,
    'Unique direct payment; delivery delayed 4-24 blocks in a canonical lane with >=25 observations',
    json_array(json_object('tx_hash',lower(hex(candidate.btc_tx_hash)),'block',candidate.btc_block,
      'time',candidate.btc_time,'sats',candidate.payment_sats))
  FROM wide.otc_candidate candidate JOIN canonical_median median USING(asset_id,seller_id)
  JOIN canonical_buyers buyers USING(asset_id,seller_id)
  WHERE candidate.asset_block<=${baselineThrough} AND candidate.relative_blocks BETWEEN 4 AND 24
    AND median.lane_candidates>=25 AND buyers.lane_buyers>=2
    AND candidate.payment_sats/candidate.quantity BETWEEN median.median_unit_sats*0.8 AND median.median_unit_sats*1.25
    AND NOT EXISTS(SELECT 1 FROM final_admitted admitted WHERE admitted.event_index=candidate.event_index);

  INSERT OR IGNORE INTO final_admitted
  SELECT candidate.event_index,candidate.asset_tx_hash,candidate.asset_block,candidate.asset_time,
    candidate.seller_id,candidate.buyer_id,candidate.asset_id,candidate.quantity,candidate.tx_id,
    candidate.btc_tx_hash,candidate.btc_block,candidate.btc_time,candidate.payment_sats,
    flow.payer_input_count,flow.payee_output_count,flow.attribution_flags,candidate.relative_blocks,
    'split_wallet_btc_receiver',2,${baselineThrough},candidate.lane_candidates,
    candidate.distinct_lane_buyers,candidate.price_ratio,
    'Buyer paid a recurring BTC receiver distinct from the asset sender; unique +/-1 block delivery',
    json_array(json_object('tx_hash',lower(hex(candidate.btc_tx_hash)),'block',candidate.btc_block,
      'time',candidate.btc_time,'sats',candidate.payment_sats))
  FROM payee.shadow_classified candidate
  JOIN bitcoin.btc_direct_flow flow ON flow.tx_id=candidate.tx_id
    AND flow.payer_id=candidate.buyer_id AND flow.payee_id=candidate.payee_id
  WHERE candidate.relative_blocks BETWEEN -1 AND 1 AND candidate.lane_candidates>=3
    AND candidate.distinct_lane_buyers>=2 AND candidate.price_ratio BETWEEN 0.8 AND 1.25
    AND NOT EXISTS(SELECT 1 FROM low_quality_asset low WHERE low.asset_id=candidate.asset_id)
    AND NOT EXISTS(SELECT 1 FROM final_admitted admitted WHERE admitted.event_index=candidate.event_index)
    AND NOT EXISTS(SELECT 1 FROM final_admitted admitted WHERE admitted.primary_tx_id=candidate.tx_id);

  INSERT INTO final_admitted
  WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id,seller_id) deliveries FROM baseline.raw_match match
  ), grouped AS (
    SELECT event_index,min(asset_tx_hash) asset_tx_hash,min(asset_block) asset_block,min(asset_time) asset_time,
      seller_id,buyer_id,asset_id,min(quantity) quantity,min(tx_id) primary_tx_id,
      min(btc_block) btc_block,min(btc_time) btc_time,sum(payment_sats) payment_sats,
      max(payer_input_count) payer_input_count,max(payee_output_count) payee_output_count,
      max(attribution_flags) attribution_flags,min(relative_blocks) relative_blocks,count(*) payment_count,
      json_group_array(json_object('tx_hash',lower(hex(btc_tx_hash)),'block',btc_block,
        'time',btc_time,'sats',payment_sats)) payment_json
    FROM ranked WHERE payments>1 AND deliveries=1 GROUP BY event_index,seller_id,buyer_id,asset_id
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
  SELECT candidate.event_index,candidate.asset_tx_hash,candidate.asset_block,candidate.asset_time,
    candidate.seller_id,candidate.buyer_id,candidate.asset_id,candidate.quantity,candidate.primary_tx_id,
    tx.tx_hash,candidate.btc_block,candidate.btc_time,candidate.payment_sats,candidate.payer_input_count,
    candidate.payee_output_count,candidate.attribution_flags,candidate.relative_blocks,
    'split_btc_payments',2,${baselineThrough},median.lane_candidates,buyers.lane_buyers,
    candidate.unit_sats/median.median_unit_sats,
    'Multiple unique direct BTC payments aggregated to one asset delivery; repeat-price lane',
    candidate.payment_json
  FROM lane_rank candidate JOIN medians median USING(asset_id,seller_id)
  JOIN buyers USING(asset_id,seller_id) JOIN bitcoin.btc_tx tx ON tx.tx_id=candidate.primary_tx_id
  WHERE median.lane_candidates>=3 AND buyers.lane_buyers>=2
    AND candidate.unit_sats BETWEEN median.median_unit_sats*0.8 AND median.median_unit_sats*1.25
    AND NOT EXISTS(SELECT 1 FROM final_admitted admitted WHERE admitted.event_index=candidate.event_index);

  INSERT OR IGNORE INTO final_admitted
  SELECT event_index,asset_tx_hash,asset_block,asset_time,seller_id,buyer_id,asset_id,quantity,
    tx_id,btc_tx_hash,btc_block,btc_time,payment_sats,payer_input_count,payee_output_count,
    attribution_flags,relative_blocks,
    CASE WHEN classification LIKE 'corroborated_%' THEN 'otc_oneoff_corroborated' ELSE 'otc_oneoff_plausible' END,
    3,indexed_through_block,coalesce(observations_30d,observations_180d,1),1,
    coalesce(ratio_30d,ratio_180d,1),evidence_note,
    json_array(json_object('tx_hash',lower(hex(btc_tx_hash)),'block',btc_block,'time',btc_time,'sats',payment_sats))
  FROM oneoff.oneoff_promoted candidate
  WHERE classification IN ('corroborated_30d_multi','corroborated_30d_single','plausible_180d_multi','delivery_first_same_block')
    AND NOT EXISTS(SELECT 1 FROM final_admitted admitted WHERE admitted.primary_btc_tx_hash=candidate.btc_tx_hash);

  /* A production ref/payment is authoritative. Fresh lanes may rediscover it. */
  DELETE FROM main.final_admitted
   WHERE method <> 'production_legacy'
     AND primary_btc_tx_hash IN (SELECT primary_btc_tx_hash FROM main.final_admitted WHERE method='production_legacy');
  DELETE FROM main.final_admitted
   WHERE method <> 'production_legacy'
     AND event_index NOT IN (
       SELECT min(event_index) FROM main.final_admitted
       WHERE method <> 'production_legacy' GROUP BY primary_btc_tx_hash
     );
`);

const summary = {
  generated_at: Math.floor(Date.now() / 1000),
  indexed_through: baselineThrough,
  total: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
      count(DISTINCT seller_id) sellers,sum(payment_sats) sats,
      round(sum(payment_sats/1e8*price.usd),2) usd
    FROM final_admitted candidate LEFT JOIN ledger.prices price
      ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')`,
    )
    .get(),
  methods: db
    .prepare(
      `SELECT method,count(*) trades,count(DISTINCT asset_id) assets,
      count(DISTINCT buyer_id) buyers,sum(payment_sats) sats,
      round(sum(payment_sats/1e8*price.usd),2) usd
    FROM final_admitted candidate LEFT JOIN ledger.prices price
      ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
    GROUP BY method ORDER BY trades DESC`,
    )
    .all(),
};
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
db.close();
