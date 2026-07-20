#!/usr/bin/env node

/** Select reviewed CMC aggregate bridge days while retaining stricter existing winners and BCY exclusions. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const currencies = ["PEPECASH", "BITCRYSTALS", "GEMZ", "SJCX", "SWARM", "LTBCOIN", "FLDC", "DATABITS", "SCOTCOIN"];
const quoted = currencies.map((currency) => `'${currency}'`).join(",");

const result = executeRemoteD1(`INSERT INTO prices(
    day,currency,usd,source,observed_day,fidelity,policy_version,price_kind,age_days,derivation_depth,
    observation_count,venue_count,volume_base,disagreement_class,selection_reason)
  SELECT cmc.day,cmc.base_currency,cmc.price,'coinmarketcap_aggregate',cmc.day,1,
    'usd-payment-cmc-bridge-v1','direct',0,0,NULLIF(cmc.trades,0),1,NULLIF(cmc.volume_base,0),
    CASE WHEN cmc.base_currency='BITCRYSTALS' AND EXISTS(
      SELECT 1 FROM market_price_observations zaif JOIN prices btc
        ON btc.day=zaif.day AND btc.currency='BTC'
      WHERE zaif.day=cmc.day AND zaif.base_currency='BITCRYSTALS' AND zaif.quote_currency='BTC'
        AND zaif.source='zaif' AND zaif.venue='cex'
    ) THEN 'independent_overlap_within_2x' ELSE 'not_independently_observed' END,
    'reviewed_exact_day_cmc_bridge'
  FROM market_price_observations cmc
  WHERE cmc.source='coinmarketcap' AND cmc.venue='aggregate' AND cmc.quote_currency='USD'
    AND cmc.base_currency IN (${quoted})
    AND NOT (cmc.base_currency='BITCRYSTALS' AND EXISTS(
      SELECT 1 FROM market_price_observations zaif JOIN prices btc
        ON btc.day=zaif.day AND btc.currency='BTC'
      WHERE zaif.day=cmc.day AND zaif.base_currency='BITCRYSTALS' AND zaif.quote_currency='BTC'
        AND zaif.source='zaif' AND zaif.venue='cex'
        AND (cmc.price>2*zaif.price*btc.usd OR zaif.price*btc.usd>2*cmc.price)
    ))
  ON CONFLICT(day,currency) DO NOTHING`);

const selected = executeRemoteD1(`SELECT currency,source,COUNT(*) days,MIN(day) first_day,MAX(day) last_day
  FROM prices WHERE currency IN (${quoted}) GROUP BY currency,source ORDER BY currency,source`).rows;
const rejected = executeRemoteD1(`SELECT COUNT(*) days FROM market_price_observations cmc
  WHERE cmc.source='coinmarketcap' AND cmc.venue='aggregate' AND cmc.base_currency='BITCRYSTALS'
    AND cmc.quote_currency='USD' AND EXISTS(
      SELECT 1 FROM market_price_observations zaif JOIN prices btc
        ON btc.day=zaif.day AND btc.currency='BTC'
      WHERE zaif.day=cmc.day AND zaif.base_currency='BITCRYSTALS' AND zaif.quote_currency='BTC'
        AND zaif.source='zaif' AND zaif.venue='cex'
        AND (cmc.price>2*zaif.price*btc.usd OR zaif.price*btc.usd>2*cmc.price))`).rows[0];

console.log(JSON.stringify({ inserted: result.meta.changes ?? 0, rejected_bitcrystals_days: rejected.days, selected }));
