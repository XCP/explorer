#!/usr/bin/env node

/** Read-only production audit for canonical trade identity and execution-time USD coverage. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { assertUsdPricingAudit } from "./lib/usd-pricing-audit.mjs";

const run = (sql) => executeRemoteD1(sql).rows;
const one = (sql) => run(sql)[0];

const identity = one(`WITH source AS (
  SELECT COUNT(*) count FROM order_matches match
  JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
  WHERE match.status='completed'
    AND (forward_asset.asset IN ('XCP','BTC') OR backward_asset.asset IN ('XCP','BTC'))
)
SELECT source.count source_matches,
  COUNT(trade.ref) dex_trades,
  SUM(length(trade.ref)=129 AND substr(trade.ref,65,1)='_') canonical_refs,
  SUM(length(trade.ref)=128 AND trade.ref NOT GLOB '*[^0-9a-f]*') alternate_refs
FROM source LEFT JOIN trades trade ON trade.venue='dex'`);

const coverage = run(`SELECT venue,currency,COUNT(*) trades,
  SUM(usd_value IS NOT NULL) priced,SUM(usd_value IS NULL) missing,
  ROUND(100.0*SUM(usd_value IS NOT NULL)/COUNT(*),2) coverage_pct,
  ROUND(SUM(COALESCE(usd_value,0)),2) payment_usd
FROM trades GROUP BY venue,currency ORDER BY venue,currency`);

const yearly = run(`SELECT strftime('%Y',block_time,'unixepoch') year,currency,COUNT(*) trades,
  SUM(usd_value IS NULL) missing,
  ROUND(100.0*SUM(usd_value IS NOT NULL)/COUNT(*),2) coverage_pct
FROM trades GROUP BY year,currency ORDER BY year,currency`);

const calendar = run(`SELECT currency,source,fidelity,COUNT(*) days,MIN(day) first_day,MAX(day) last_day,
  MAX(CAST(julianday(day)-julianday(observed_day) AS INTEGER)) max_age_days
FROM prices GROUP BY currency,source,fidelity ORDER BY currency,fidelity DESC,source`);

const reconciliation = one(`SELECT
  COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='usd_cur'),0) cursor,
  COALESCE((SELECT MAX(rowid) FROM trades),0) tip,
  (SELECT COUNT(*) FROM trades trade
    WHERE trade.currency IN ('BTC','ETH','XCP') AND trade.usd_value IS NULL
      AND EXISTS(SELECT 1 FROM prices price WHERE price.currency=trade.currency
        AND price.day=date(trade.block_time,'unixepoch'))) calendar_available_unpriced,
  (SELECT COUNT(*) FROM trades trade
    WHERE trade.currency IN ('BTC','ETH','XCP') AND trade.usd_value IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM prices price WHERE price.currency=trade.currency
        AND price.day=date(trade.block_time,'unixepoch'))) priced_without_calendar,
  (SELECT COUNT(*) FROM trades WHERE currency='USDC' AND usd_value IS NOT total) usdc_mismatches,
  (SELECT COUNT(*) FROM prices WHERE currency='XCP' AND source='dex_vwm'
    AND julianday(day)-julianday(observed_day)>7) expired_xcp_carries`);

const latest = run(`SELECT price.currency,price.day,price.usd,price.source,price.observed_day,price.fidelity
FROM prices price JOIN (SELECT currency,MAX(day) day FROM prices GROUP BY currency) newest
  ON newest.currency=price.currency AND newest.day=price.day
ORDER BY price.currency`);

const report = {
  generated_at: new Date().toISOString(),
  contract: "usd_value is execution-time payment value; NULL means no admitted historical price",
  identity,
  reconciliation: {
    ...reconciliation,
    remaining: Math.max(0, Number(reconciliation.tip) - Number(reconciliation.cursor)),
  },
  coverage,
  yearly,
  calendar,
  latest,
};

assertUsdPricingAudit(identity, reconciliation);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
