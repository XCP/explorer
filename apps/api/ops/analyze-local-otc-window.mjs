#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const baselinePath = resolve(option("baseline", "C:/BitcoinIndex/otc-census.sqlite"));
const widePath = resolve(option("wide", "C:/BitcoinIndex/otc-census-wide.sqlite"));
const ledgerPath = resolve(option("ledger", "C:/BitcoinIndex/otc-ledger.sqlite"));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(":memory:");
db.exec(`ATTACH DATABASE ${quote(baselinePath)} AS baseline;
  ATTACH DATABASE ${quote(widePath)} AS wide;
  ATTACH DATABASE ${quote(ledgerPath)} AS ledger;`);

const baselineThrough = Number(
  db.prepare("SELECT max(indexed_through_block) height FROM baseline.otc_candidate").get().height,
);
const cohort = (membership) =>
  db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT w.asset_id) assets,count(DISTINCT w.buyer_id) buyers,
      sum(w.payment_sats) sats,round(sum(w.payment_sats/1e8*price.usd),2) usd
    FROM wide.otc_admitted w
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(w.btc_time,'unixepoch')
    WHERE w.asset_block<=? AND ${membership}`,
    )
    .get(baselineThrough);

const keyMatch = `EXISTS(SELECT 1 FROM baseline.otc_admitted b
  WHERE b.event_index=w.event_index AND b.btc_tx_hash=w.btc_tx_hash)`;
const result = {
  baseline_through: baselineThrough,
  common: cohort(keyMatch),
  added: cohort(`NOT ${keyMatch}`),
  removed: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT b.asset_id) assets,count(DISTINCT b.buyer_id) buyers,
      sum(b.payment_sats) sats,round(sum(b.payment_sats/1e8*price.usd),2) usd
    FROM baseline.otc_admitted b
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(b.btc_time,'unixepoch')
    WHERE NOT EXISTS(SELECT 1 FROM wide.otc_admitted w
      WHERE w.event_index=b.event_index AND w.btc_tx_hash=b.btc_tx_hash)`,
    )
    .get(),
  added_timing: db
    .prepare(
      `SELECT w.relative_blocks,count(*) trades,sum(w.payment_sats) sats,
      round(sum(w.payment_sats/1e8*price.usd),2) usd
    FROM wide.otc_admitted w
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(w.btc_time,'unixepoch')
    WHERE w.asset_block<=? AND NOT ${keyMatch}
    GROUP BY w.relative_blocks ORDER BY w.relative_blocks`,
    )
    .all(baselineThrough),
  delayed_support_sweep: [3, 5, 10, 25, 100].map((minimumLane) => ({
    minimum_lane: minimumLane,
    ...db
      .prepare(
        `SELECT count(*) trades,count(DISTINCT w.asset_id) assets,
        count(DISTINCT w.buyer_id) buyers,sum(w.payment_sats) sats,
        round(sum(w.payment_sats/1e8*price.usd),2) usd
      FROM wide.otc_admitted w
      LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(w.btc_time,'unixepoch')
      WHERE w.asset_block<=? AND w.relative_blocks BETWEEN 4 AND 24
        AND w.lane_candidates>=?`,
      )
      .get(baselineThrough, minimumLane),
  })),
  added_assets: db
    .prepare(
      `SELECT asset.asset,count(*) trades,count(DISTINCT w.buyer_id) buyers,
      count(DISTINCT w.seller_id) sellers,sum(w.payment_sats) sats,
      round(sum(w.payment_sats/1e8*price.usd),2) usd
    FROM wide.otc_admitted w JOIN ledger.asset_dictionary asset USING(asset_id)
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(w.btc_time,'unixepoch')
    WHERE w.asset_block<=? AND NOT ${keyMatch}
    GROUP BY w.asset_id ORDER BY usd DESC,trades DESC LIMIT 30`,
    )
    .all(baselineThrough),
  added_examples: db
    .prepare(
      `SELECT asset.asset,w.quantity,w.payment_sats,round(w.payment_sats/1e8*price.usd,2) usd,
      w.relative_blocks,seller.address seller,buyer.address buyer,
      lower(hex(w.asset_tx_hash)) asset_tx,lower(hex(w.btc_tx_hash)) btc_tx
    FROM wide.otc_admitted w JOIN ledger.asset_dictionary asset USING(asset_id)
    JOIN ledger.address_dictionary seller ON seller.address_id=w.seller_id
    JOIN ledger.address_dictionary buyer ON buyer.address_id=w.buyer_id
    LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(w.btc_time,'unixepoch')
    WHERE w.asset_block<=? AND NOT ${keyMatch}
    ORDER BY usd DESC,w.payment_sats DESC LIMIT 30`,
    )
    .all(baselineThrough),
};

console.log(JSON.stringify(result, null, 2));
db.close();
