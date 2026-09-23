#!/usr/bin/env node
/** Run AFTER migration 0099 and deployment. Compile with npm test first.
 * Uses the shipping queries and existing BTC/USD calendar; never imports new
 * prices or rewrites raw chain records. Every phase is safe to repeat.
 */
import { repairPaymentBridges } from "./lib/payment-bridge-repair.mjs";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { DISPENSE_TRADES_SQL, DISPENSE_TRADE_LEGS_SQL } from "../.test-dist/src/indexer/trades.js";
import * as prices from "../.test-dist/src/indexer/prices.js";
import { ASSET_RATING_UPSERT_SQL, ASSET_RATING_RECONCILE_SQL } from "../.test-dist/src/indexer/asset-rating.js";
import {
  ADDRESS_REPUTATION_UPSERT_SQL,
  ADDRESS_REPUTATION_RECONCILE_SQL,
} from "../.test-dist/src/indexer/address-reputation.js";

if (!process.argv.includes("--apply")) {
  console.log(
    "Historical repair: payment ledger, XCP/BTC observations, XCP/USD calendar, trade USD, monetary signals and rankings. Run with --apply after migration and deployment.",
  );
  process.exit(0);
}
function numericBindings(sql, values) {
  let index = 0;
  return sql.replace(/\?(\d+)?/g, (_, number) => {
    const value = values[number ? Number(number) - 1 : index++];
    if (!Number.isSafeInteger(value)) throw new Error("Expected an integer SQL binding");
    return String(value);
  });
}
function run(label, sql, values = []) {
  let result;
  for (let attempt = 0; ; attempt++) {
    try {
      result = executeRemoteD1(numericBindings(sql, values));
      break;
    } catch (error) {
      if (attempt >= 5 || !/overloaded|7429|7403|timed out/i.test(String(error))) throw error;
      console.log(JSON.stringify({ phase: label, retry: attempt + 1 }));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10000, 2000 * (attempt + 1)));
    }
  }
  console.log(JSON.stringify({ phase: label, ...result.meta }));
  return result.rows;
}
// Share the scheduler's lease so bulk repair cannot overlap canonical maintenance.
const leaseKey = "canonical_maintenance_lease_until";
const leaseUntil = Math.floor(Date.now() / 1000) + 15 * 60;
const claimed = run(
  "maintenance-lease",
  `INSERT INTO core_state(key,value) VALUES('${leaseKey}',?1)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(core_state.value AS INTEGER)<?2
  RETURNING value`,
  [leaseUntil, Math.floor(Date.now() / 1000)],
);
if (!claimed.length) throw new Error("Canonical maintenance is active; rerun after it releases its lease.");
try {
  const tip = Number(run("tip", "SELECT MAX(block_index) tip FROM blocks")[0].tip);
  for (let low = 0; low < tip; low += 100000) {
    const high = Math.min(low + 100000, tip);
    run(`payments:${high}`, DISPENSE_TRADES_SQL, [low, high]);
    run(`legs:${high}`, DISPENSE_TRADE_LEGS_SQL, [low, high]);
  }
  for (const key of [
    "BUILD_DISPENSE_PRICE_OBSERVATIONS_SQL",
    "PRUNE_DISPENSE_PRICE_OBSERVATIONS_SQL",
    "BUILD_MARKET_PRICE_OBSERVATIONS_SQL",
    "PRUNE_MARKET_PRICE_OBSERVATIONS_SQL",
    "PRUNE_XCP_USD_SQL",
    "BUILD_XCP_USD_SQL",
    "BUILD_THIN_XCP_USD_SQL",
  ])
    run(key, prices[key]);
  repairPaymentBridges(run);
  const tradeTip = Number(run("trade-tip", "SELECT MAX(rowid) tip FROM trades")[0].tip);
  for (let low = 0; low < tradeTip; low += 200000)
    run(`trade-usd:${low}`, prices.APPLY_TRADE_USD_SQL, [low, Math.min(low + 200000, tradeTip)]);
  // Price changes affect realized-value signals beyond dispensers: re-derive the
  // same monetary fields used by core-asset-signals from the corrected ledger.
  run(
    "asset-sale-money",
    `WITH sales AS (
  SELECT asset_id,COALESCE(MAX(CASE WHEN buyer_id IS NULL OR seller_id IS NULL OR buyer_id<>seller_id
    THEN usd_value END),0) largest FROM trades WHERE asset_id IS NOT NULL GROUP BY asset_id
), clean AS (
  SELECT asset_id,COALESCE(SUM(CASE WHEN usd_value>0 THEN usd_value ELSE 0 END),0) total
  FROM trades WHERE asset_id IS NOT NULL AND block_time>0 AND total>0
    AND buyer_id IS NOT NULL AND seller_id IS NOT NULL AND buyer_id<>seller_id
    AND (venue='dex' OR (venue='dispense' AND sale_class='single')
      OR (venue='tokenly_swapbot' AND sale_class='single')
      OR (venue='otc' AND sale_class IN ('likely','corroborated')) OR (venue='emblem' AND sale_class='real'))
  GROUP BY asset_id
)
UPDATE asset_signals SET max_realized_usd=s.largest,clean_realized_usd=COALESCE(c.total,0)
FROM sales s LEFT JOIN clean c USING(asset_id) WHERE asset_signals.asset_id=s.asset_id`,
  );
  const now = Math.floor(Date.now() / 1000);
  run("asset-ratings", ASSET_RATING_UPSERT_SQL, [now]);
  run("asset-rating-prune", ASSET_RATING_RECONCILE_SQL);
  run("address-reputations", ADDRESS_REPUTATION_UPSERT_SQL, [now]);
  run("address-reputation-prune", ADDRESS_REPUTATION_RECONCILE_SQL);
  run(
    "address-distribution",
    `INSERT INTO address_reputation_histogram(singleton,bins)
  SELECT 1,json_group_array(json_object('bin',bin,'count',n)) FROM (
    SELECT MIN(100,CAST(reputation AS INTEGER)) bin,COUNT(*) n FROM address_reputations GROUP BY bin ORDER BY bin
  ) WHERE 1 ON CONFLICT(singleton) DO UPDATE SET bins=excluded.bins`,
  );
  run("pricing-health", prices.REFRESH_PRICING_HEALTH_SQL, [now]);
  run(
    "completed-projections",
    `INSERT INTO core_state(key,value) VALUES
    ('trades_cur_dispense_payments',?1),('usd_cur',?2),('prices_synced_blk',?1),
    ('asset_ratings_refreshed_at',?3),('address_reputations_refreshed_at',?3)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [tip, tradeTip, now],
  );
  // Expire existing bodies gradually through SWR, avoiding another all-route cold start.
  run("expire-stale-responses", "UPDATE cache SET expires_at=MIN(expires_at,?)", [now - 1]);
  const check = run(
    "verify",
    `SELECT
  (SELECT COUNT(*) FROM dispenses WHERE payment_asset_count=0) unaccounted,
  (SELECT COUNT(*) FROM (SELECT tx_index,payment_group FROM dispenses GROUP BY tx_index,payment_group
    HAVING SUM(quote_sats)>MAX(CAST(btc_amount AS REAL))+0.0001 OR MIN(quote_sats)<0)) invalid_payments,
  (SELECT COUNT(*) FROM trades t JOIN prices p ON p.currency=t.currency AND p.day=date(t.block_time,'unixepoch')
    WHERE t.currency NOT IN ('USD','USDC') AND (t.usd_value IS NULL OR ABS(t.usd_value-t.total*p.usd)>0.000001)) stale_usd`,
  )[0];
  console.log(JSON.stringify({ verification: check }));
  if (Object.values(check).some((value) => Number(value) !== 0))
    throw new Error("Historical accounting verification failed");
} finally {
  run("release-maintenance-lease", `DELETE FROM core_state WHERE key='${leaseKey}' AND value=CAST(? AS TEXT)`, [
    leaseUntil,
  ]);
}
