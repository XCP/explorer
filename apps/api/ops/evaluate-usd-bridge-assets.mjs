#!/usr/bin/env node

/** Survey non-anchor Counterparty assets that could serve as attributable USD conversion bridges. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const ASSETS = ["PEPECASH", "SJCX", "BITCRYSTALS", "ZAIF", "CICC"];
const output = process.env.USD_BRIDGE_OUTPUT ? resolve(process.env.USD_BRIDGE_OUTPUT) : null;
const quoted = ASSETS.map((asset) => `'${asset}'`).join(",");

const paths = executeRemoteD1(`WITH fx AS (
  SELECT jpy.day,jpy.base_currency,jpy.price jpy_price,jpy.volume_base jpy_volume,jpy.trades jpy_trades,
    jpy.first_time jpy_first,jpy.last_time jpy_last,btc.price btc_price,btc.volume_base btc_volume,
    btc.trades btc_trades,btc.first_time btc_first,btc.last_time btc_last,
    selected.usd btc_usd,
    (SELECT usd.price/jpyfx.price FROM market_price_observations usd
      JOIN market_price_observations jpyfx ON jpyfx.day=usd.day AND jpyfx.base_currency='EUR'
        AND jpyfx.quote_currency='JPY' AND jpyfx.source='ecb' AND jpyfx.venue='reference'
      WHERE usd.base_currency='EUR' AND usd.quote_currency='USD' AND usd.source='ecb' AND usd.venue='reference'
        AND usd.day BETWEEN date(jpy.day,'-4 days') AND jpy.day ORDER BY usd.day DESC LIMIT 1) usd_per_jpy
  FROM market_price_observations jpy
  JOIN market_price_observations btc ON btc.day=jpy.day AND btc.base_currency=jpy.base_currency
    AND btc.quote_currency='BTC' AND btc.source='zaif' AND btc.venue='cex'
  JOIN prices selected ON selected.day=jpy.day AND selected.currency='BTC'
  WHERE jpy.base_currency IN (${quoted}) AND jpy.quote_currency='JPY'
    AND jpy.source='zaif' AND jpy.venue='cex'
), evaluated AS (
  SELECT *,jpy_price*usd_per_jpy jpy_usd,btc_price*btc_usd btc_usd_path,
    ABS(LOG((jpy_price*usd_per_jpy)/(btc_price*btc_usd))) absolute_log_error,
    CASE WHEN jpy_trades>=2 AND btc_trades>=2 AND MAX(jpy_first,btc_first)<=MIN(jpy_last,btc_last)
      AND ABS(LOG((jpy_price*usd_per_jpy)/(btc_price*btc_usd)))<=LOG(1.25) THEN 1 ELSE 0 END admitted
  FROM fx WHERE usd_per_jpy>0 AND btc_usd>0 AND jpy_price>0 AND btc_price>0
)
SELECT base_currency asset,COUNT(*) overlap_days,SUM(admitted) admitted_days,
  SUM(absolute_log_error<=LOG(1.10)) within_10pct_days,
  SUM(absolute_log_error<=LOG(1.25)) within_25pct_days,
  MIN(day) first_overlap_day,MAX(day) last_overlap_day,
  MIN(CASE WHEN admitted THEN day END) first_admitted_day,
  MAX(CASE WHEN admitted THEN day END) last_admitted_day
FROM evaluated GROUP BY base_currency ORDER BY base_currency`).rows;

const tradeDays = executeRemoteD1(`WITH legs AS (
  SELECT date(match.block_time,'unixepoch') day,forward.asset candidate,backward.asset other_asset,COUNT(*) matches
  FROM order_matches match
  JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
  WHERE match.status='completed' AND match.block_time IS NOT NULL AND forward.asset IN (${quoted})
    AND backward.asset NOT IN ('BTC','XCP',${quoted}) GROUP BY 1,2,3
  UNION ALL
  SELECT date(match.block_time,'unixepoch'),backward.asset,forward.asset,COUNT(*)
  FROM order_matches match
  JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
  WHERE match.status='completed' AND match.block_time IS NOT NULL AND backward.asset IN (${quoted})
    AND forward.asset NOT IN ('BTC','XCP',${quoted}) GROUP BY 1,2,3
)
SELECT candidate asset,COUNT(DISTINCT day) trade_days,SUM(matches) matches,COUNT(DISTINCT other_asset) other_assets,
  MIN(day) first_day,MAX(day) last_day FROM legs GROUP BY candidate ORDER BY candidate`).rows;

const admittedCoverage = executeRemoteD1(`WITH fx AS (
  SELECT jpy.day,jpy.base_currency,jpy.price jpy_price,jpy.trades jpy_trades,jpy.first_time jpy_first,
    jpy.last_time jpy_last,btc.price btc_price,btc.trades btc_trades,btc.first_time btc_first,
    btc.last_time btc_last,selected.usd btc_usd,
    (SELECT usd.price/jpyfx.price FROM market_price_observations usd
      JOIN market_price_observations jpyfx ON jpyfx.day=usd.day AND jpyfx.base_currency='EUR'
        AND jpyfx.quote_currency='JPY' AND jpyfx.source='ecb' AND jpyfx.venue='reference'
      WHERE usd.base_currency='EUR' AND usd.quote_currency='USD' AND usd.source='ecb' AND usd.venue='reference'
        AND usd.day BETWEEN date(jpy.day,'-4 days') AND jpy.day ORDER BY usd.day DESC LIMIT 1) usd_per_jpy
  FROM market_price_observations jpy
  JOIN market_price_observations btc ON btc.day=jpy.day AND btc.base_currency=jpy.base_currency
    AND btc.quote_currency='BTC' AND btc.source='zaif' AND btc.venue='cex'
  JOIN prices selected ON selected.day=jpy.day AND selected.currency='BTC'
  WHERE jpy.base_currency IN (${quoted}) AND jpy.quote_currency='JPY'
    AND jpy.source='zaif' AND jpy.venue='cex'
), admitted AS (
  SELECT day,base_currency asset FROM fx WHERE usd_per_jpy>0 AND jpy_trades>=2 AND btc_trades>=2
    AND MAX(jpy_first,btc_first)<=MIN(jpy_last,btc_last)
    AND ABS(LOG((jpy_price*usd_per_jpy)/(btc_price*btc_usd)))<=LOG(1.25)
), legs AS (
  SELECT date(match.block_time,'unixepoch') day,forward.asset candidate,backward.asset other_asset
  FROM order_matches match JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
  WHERE match.status='completed' AND match.block_time IS NOT NULL AND forward.asset IN (${quoted})
    AND backward.asset NOT IN ('BTC','XCP',${quoted})
  UNION ALL
  SELECT date(match.block_time,'unixepoch'),backward.asset,forward.asset
  FROM order_matches match JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
  WHERE match.status='completed' AND match.block_time IS NOT NULL AND backward.asset IN (${quoted})
    AND forward.asset NOT IN ('BTC','XCP',${quoted})
)
SELECT legs.candidate asset,COUNT(*) admitted_matches,COUNT(DISTINCT legs.day) admitted_trade_days,
  COUNT(DISTINCT legs.other_asset) admitted_other_assets,MIN(legs.day) first_day,MAX(legs.day) last_day
FROM legs JOIN admitted ON admitted.asset=legs.candidate AND admitted.day=legs.day
GROUP BY legs.candidate ORDER BY legs.candidate`).rows;

const pathByAsset = new Map(paths.map((row) => [row.asset, row]));
const tradeByAsset = new Map(tradeDays.map((row) => [row.asset, row]));
const coverageByAsset = new Map(admittedCoverage.map((row) => [row.asset, row]));
const report = {
  schema: "usd-bridge-asset-survey/1",
  generated_at: new Date().toISOString(),
  selecting: false,
  rule: {
    paths: "same-day Zaif asset/JPY/ECB-USD and asset/BTC/selected-BTC-USD",
    minimum_executions_each: 2,
    windows_must_overlap: true,
    maximum_path_disagreement: "25% absolute log error",
    carry: "no asset-market carry; ECB reference carry capped at four calendar days",
  },
  assets: ASSETS.map((asset) => ({
    asset,
    paths: pathByAsset.get(asset) ?? null,
    downstream: tradeByAsset.get(asset) ?? null,
    admitted_downstream: coverageByAsset.get(asset) ?? null,
  })),
};

if (output) writeFileSync(output, `${JSON.stringify(report)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
