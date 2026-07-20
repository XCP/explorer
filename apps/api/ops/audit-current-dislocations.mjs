#!/usr/bin/env node

/** Build a named, current-state Dislocations review list without changing the public Radar. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const root = resolve(".analytics/radar/ownership");
const trades = JSON.parse(readFileSync(resolve(root, "trade-history.json"), "utf8"));
if (!trades.complete) throw new Error("Trade snapshot is incomplete");
const db = new DatabaseSync(resolve(root, "ownership.sqlite"), { readOnly: true });
const asOf = Math.floor(Date.now() / 1000);
const referenceStart = asOf - 730 * 86400;
const referenceEnd = asOf - 90 * 86400;
const references = db
  .prepare(
    `WITH ranked AS (
    SELECT asset_id,strftime('%Y-%m',block_time,'unixepoch') month,usd_value/quantity unit_usd,
      ROW_NUMBER() OVER(PARTITION BY asset_id,strftime('%Y-%m',block_time,'unixepoch')
        ORDER BY usd_value/quantity) rank,
      COUNT(*) OVER(PARTITION BY asset_id,strftime('%Y-%m',block_time,'unixepoch')) month_sales
    FROM market_trades WHERE venue IN ('dispense','dex')
      AND asset_id IS NOT NULL AND block_time>=? AND block_time<?
      AND quantity>0 AND usd_value>0
  ), monthly AS (
    SELECT asset_id,month,AVG(unit_usd) month_median,MAX(month_sales) month_sales
    FROM ranked WHERE rank IN ((month_sales+1)/2,(month_sales+2)/2) GROUP BY asset_id,month
  ), reference_ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY month_median) rank,
      COUNT(*) OVER(PARTITION BY asset_id) active_months
    FROM monthly
  )
  SELECT asset_id,AVG(month_median) reference_usd,MAX(active_months) reference_months,
    SUM(month_sales) reference_sales
  FROM reference_ranked WHERE rank IN ((active_months+1)/2,(active_months+2)/2)
  GROUP BY asset_id HAVING reference_months>=2 AND reference_sales>=3`,
  )
  .all(referenceStart, referenceEnd)
  .map((row) => ({
    asset_id: Number(row.asset_id),
    reference_usd: Number(row.reference_usd),
    reference_months: Number(row.reference_months),
    reference_sales: Number(row.reference_sales),
  }));
db.close();

const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
function remote(sql) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return executeRemoteD1(sql);
    } catch (error) {
      lastError = error;
      if (attempt < 5) sleep(attempt * 2000);
    }
  }
  throw lastError;
}

const referenceById = new Map(references.map((row) => [row.asset_id, row]));
const offers = [];
for (let start = 0; start < references.length; start += 80) {
  const ids = references.slice(start, start + 80).map((row) => row.asset_id);
  const values = ids.join(",");
  const result = remote(`WITH px AS (SELECT usd FROM prices WHERE currency='BTC' ORDER BY day DESC LIMIT 1),
    disp AS (
      SELECT asset_id,MIN(CAST(satoshirate_normalized AS REAL)
        /NULLIF(CAST(give_quantity_normalized AS REAL),0)) ask_btc
      FROM dispensers WHERE asset_id IN (${values}) AND status=0
        AND CAST(give_remaining_normalized AS REAL)>0 GROUP BY asset_id
    ), candidates(asset_id) AS (VALUES
      ${ids.map((id) => `(${id})`).join(",")})
    SELECT candidate.asset_id,dictionary.asset,state.asset_longname,
      signal.holders,signal.top1_pct,signal.supply,signal.low_quality,
      'dispenser' venue,disp.ask_btc*(SELECT usd FROM px) ask_usd,disp.ask_btc ask_btc,
      (SELECT COUNT(DISTINCT evidence.source) FROM collection_membership_evidence evidence
        JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id
        WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset) collection_sources
    FROM candidates candidate JOIN asset_dictionary dictionary USING(asset_id)
    LEFT JOIN assets state USING(asset_id) LEFT JOIN asset_signals signal USING(asset_id)
    JOIN disp USING(asset_id)`);
  offers.push(...result.rows);
}

const candidates = offers
  .map((offer) => {
    const reference = referenceById.get(Number(offer.asset_id));
    const ask = Number(offer.ask_usd);
    return {
      asset_id: Number(offer.asset_id),
      asset: offer.asset,
      asset_longname: offer.asset_longname ?? null,
      venue: offer.venue,
      ask_usd: ask,
      ask_btc: offer.ask_btc == null ? null : Number(offer.ask_btc),
      reference_usd: reference.reference_usd,
      ask_to_reference: ask / reference.reference_usd,
      discount_pct: (1 - ask / reference.reference_usd) * 100,
      reference_months: reference.reference_months,
      reference_sales: reference.reference_sales,
      holders: Number(offer.holders ?? 0),
      supply: Number(offer.supply ?? 0),
      top1_pct: Number(offer.top1_pct ?? 0),
      collection_sources: Number(offer.collection_sources ?? 0),
      low_quality: Number(offer.low_quality ?? 0),
    };
  })
  .filter((row) => row.ask_usd > 0 && row.reference_usd > 0 && row.ask_to_reference < 1 && row.low_quality === 0)
  .sort(
    (a, b) =>
      a.ask_to_reference - b.ask_to_reference ||
      b.reference_months - a.reference_months ||
      b.holders - a.holders ||
      a.asset.localeCompare(b.asset),
  );

const report = {
  schema: "xcp-current-dislocations-audit/1",
  measured_at: new Date(asOf * 1000).toISOString(),
  reference_window: { start: referenceStart, end: referenceEnd, excluded_recent_days: 90 },
  reference_assets: references.length,
  assets_with_executable_offer: offers.length,
  discounted_candidates: candidates.length,
  caveats: [
    "Dispenser asks are canonical on-chain state.",
    "Emblem asks are excluded until vault inventory quantity is available; a whole-vault ask is not necessarily a per-token ask.",
    "A discount is evidence of price position, not a promise of liquidity or recovery.",
    "Collection source count is evidence breadth, not collection quality.",
  ],
  candidates,
};
writeFileSync(resolve(root, "current-dislocations.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      measured_at: report.measured_at,
      reference_assets: report.reference_assets,
      assets_with_executable_offer: report.assets_with_executable_offer,
      discounted_candidates: report.discounted_candidates,
      candidates: candidates.slice(0, 25),
    },
    null,
    2,
  )}\n`,
);
