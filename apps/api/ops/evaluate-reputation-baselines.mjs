#!/usr/bin/env node

/**
 * Historical, leakage-safe reputation/rating baselines over canonical D1 events.
 *
 * This first stage deliberately uses only immutable trades and originating-transaction ledgers. Current
 * signal rows are snapshots and MUST NOT be projected into historical cutoffs. Run from apps/api:
 *
 *   npm run evaluate:reputation
 *   npm run evaluate:reputation -- --assets-only
 *   npm run evaluate:reputation -- --addresses-only
 *
 * The JSON report is written to stdout. Redirect it to a dated artifact when establishing a release baseline.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HORIZON_DAYS = 180;
export const CUTOFFS = [
  ["2025-01-01", 1735689600],
  ["2025-07-01", 1751328000],
  ["2026-01-01", 1767225600],
];

const horizonSeconds = HORIZON_DAYS * 86400;
const cutoffSql = CUTOFFS.map(([label, timestamp]) => `('${label}',${timestamp},${timestamp + horizonSeconds})`).join(
  ",",
);

export const ASSET_MARKET_BASELINE_SQL = `
WITH cutoffs(label,cutoff,outcome_end) AS (VALUES ${cutoffSql}),
past AS (
  SELECT cutoff.label,cutoff.cutoff,cutoff.outcome_end,trade.asset_id,
    COUNT(*) past_sales,
    COUNT(DISTINCT trade.buyer_id) past_buyers,
    COUNT(DISTINCT strftime('%Y-%m',trade.block_time,'unixepoch')) past_active_months,
    MAX(trade.block_time) last_sale_time,
    SUM(CASE WHEN trade.usd_value>0 THEN trade.usd_value ELSE 0 END) past_usd
  FROM cutoffs cutoff JOIN trades trade
    ON trade.asset_id IS NOT NULL AND trade.block_time>0 AND trade.block_time<=cutoff.cutoff
  GROUP BY cutoff.label,cutoff.cutoff,cutoff.outcome_end,trade.asset_id
),
future AS (
  SELECT past.label,past.asset_id,
    COUNT(trade.ref) future_sales,
    COUNT(DISTINCT trade.buyer_id) future_buyers,
    COUNT(DISTINCT CASE WHEN trade.ref IS NOT NULL THEN strftime('%Y-%m',trade.block_time,'unixepoch') END)
      future_active_months,
    SUM(CASE WHEN trade.usd_value>0 THEN trade.usd_value ELSE 0 END) future_usd,
    MIN(trade.block_time) first_outcome_time,
    MAX(trade.block_time) last_outcome_time
  FROM past LEFT JOIN trades trade
    ON trade.asset_id=past.asset_id AND trade.block_time>past.cutoff AND trade.block_time<=past.outcome_end
  GROUP BY past.label,past.asset_id
),
cohort AS (
  SELECT past.*,future.future_sales,future.future_buyers,future.future_active_months,future.future_usd,
    future.first_outcome_time,future.last_outcome_time
  FROM past JOIN future USING(label,asset_id)
),
normalized AS MATERIALIZED (
  SELECT cohort.*,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY last_sale_time) recency_pct,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY past_active_months) active_months_pct,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY past_buyers) buyers_pct,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY past_usd) realized_usd_pct
  FROM cohort
),
predictors AS (
  SELECT normalized.label,normalized.asset_id,predictor.column1 predictor,
    CASE predictor.column1
      WHEN 'recency' THEN last_sale_time
      WHEN 'sales' THEN past_sales
      WHEN 'buyers' THEN past_buyers
      WHEN 'active_months' THEN past_active_months
      WHEN 'realized_usd' THEN LN(1+past_usd)
      WHEN 'balanced_market' THEN (recency_pct+active_months_pct+buyers_pct+realized_usd_pct)/4.0
      WHEN 'balanced_no_recency' THEN (active_months_pct+buyers_pct+realized_usd_pct)/3.0
      WHEN 'balanced_no_active_months' THEN (recency_pct+buyers_pct+realized_usd_pct)/3.0
      WHEN 'compact_market' THEN (recency_pct+active_months_pct+realized_usd_pct)/3.0
      WHEN 'persistence_core' THEN (recency_pct+active_months_pct)/2.0
      ELSE (recency_pct+active_months_pct+buyers_pct)/3.0
    END score
  FROM normalized CROSS JOIN (
    VALUES ('recency'),('sales'),('buyers'),('active_months'),('realized_usd'),('balanced_market'),
      ('balanced_no_recency'),('balanced_no_active_months'),('balanced_no_realized_usd'),
      ('compact_market'),('persistence_core')
  ) predictor
),
ranked AS (
  SELECT predictor.label,predictor.predictor,predictor.asset_id,
    NTILE(10) OVER (PARTITION BY predictor.label,predictor.predictor ORDER BY predictor.score DESC, predictor.asset_id) decile
  FROM predictors predictor
),
evaluated AS (
  SELECT ranked.label,ranked.predictor,ranked.decile,cohort.*
  FROM ranked JOIN cohort ON cohort.label=ranked.label AND cohort.asset_id=ranked.asset_id
)
SELECT label,predictor,
  COUNT(*) eligible_assets,
  SUM(CASE WHEN future_sales>0 THEN 1 ELSE 0 END) returning_assets,
  ROUND(AVG(CASE WHEN future_sales>0 THEN 1.0 ELSE 0 END),6) population_return_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_sales>0 THEN 1.0 ELSE 0 END END),6) top_decile_return_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_sales>0 THEN 1.0 ELSE 0 END END)
    / NULLIF(AVG(CASE WHEN future_sales>0 THEN 1.0 ELSE 0 END),0),3) return_lift,
  ROUND(AVG(CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END),6) population_persistent_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END END),6)
    top_decile_persistent_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END END)
    / NULLIF(AVG(CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END),0),3) persistence_lift,
  ROUND(AVG(CASE WHEN future_buyers>=2 THEN 1.0 ELSE 0 END),6) population_buyer_breadth_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_buyers>=2 THEN 1.0 ELSE 0 END END),6)
    top_decile_buyer_breadth_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_buyers>=2 THEN 1.0 ELSE 0 END END)
    / NULLIF(AVG(CASE WHEN future_buyers>=2 THEN 1.0 ELSE 0 END),0),3) buyer_breadth_lift,
  ROUND(AVG(future_buyers),3) population_future_buyers,
  ROUND(AVG(CASE WHEN decile=1 THEN future_buyers END),3) top_decile_future_buyers,
  ROUND(AVG(CASE WHEN decile=1 THEN future_buyers END)/NULLIF(AVG(future_buyers),0),3) buyer_lift,
  ROUND(AVG(LN(1+future_usd)),3) population_log_future_usd,
  ROUND(AVG(CASE WHEN decile=1 THEN LN(1+future_usd) END),3) top_decile_log_future_usd,
  MIN(first_outcome_time) first_outcome_time,
  MAX(last_outcome_time) last_outcome_time
FROM evaluated
GROUP BY label,predictor
ORDER BY label,predictor`;

export function addressActivityBaselineSql(cutoffs = CUTOFFS) {
  const values = cutoffs
    .map(([label, timestamp]) => `('${label}',${timestamp},${Number(timestamp) + horizonSeconds})`)
    .join(",");
  return `
WITH cutoffs(label,cutoff,outcome_end) AS (VALUES ${values}),
past AS (
  SELECT cutoff.label,cutoff.cutoff,cutoff.outcome_end,tx.source_id address_id,
    COUNT(*) past_transactions,
    COUNT(DISTINCT strftime('%Y-%m',tx.block_time,'unixepoch')) past_active_months,
    MAX(tx.block_time) last_transaction_time
  FROM cutoffs cutoff JOIN transactions tx
    ON tx.source_id IS NOT NULL AND tx.supported=1 AND tx.block_time>0 AND tx.block_time<=cutoff.cutoff
  GROUP BY cutoff.label,cutoff.cutoff,cutoff.outcome_end,tx.source_id
),
future AS (
  SELECT past.label,past.address_id,
    COUNT(tx.tx_index) future_transactions,
    COUNT(DISTINCT CASE WHEN tx.tx_index IS NOT NULL THEN strftime('%Y-%m',tx.block_time,'unixepoch') END)
      future_active_months,
    MIN(tx.block_time) first_outcome_time,
    MAX(tx.block_time) last_outcome_time
  FROM past LEFT JOIN transactions tx
    ON tx.source_id=past.address_id AND tx.supported=1
      AND tx.block_time>past.cutoff AND tx.block_time<=past.outcome_end
  GROUP BY past.label,past.address_id
),
cohort AS (
  SELECT past.*,future.future_transactions,future.future_active_months,
    future.first_outcome_time,future.last_outcome_time
  FROM past JOIN future USING(label,address_id)
),
normalized AS MATERIALIZED (
  SELECT cohort.*,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY last_transaction_time) recency_pct,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY past_active_months) active_months_pct,
    PERCENT_RANK() OVER (PARTITION BY label ORDER BY past_transactions) transactions_pct
  FROM cohort
),
predictors AS (
  SELECT normalized.label,normalized.address_id,predictor.column1 predictor,
    CASE predictor.column1
      WHEN 'recency' THEN last_transaction_time
      WHEN 'transactions' THEN past_transactions
      WHEN 'active_months' THEN past_active_months
      ELSE (recency_pct+active_months_pct+transactions_pct)/3.0
    END score
  FROM normalized CROSS JOIN (
    VALUES ('recency'),('transactions'),('active_months'),('balanced_participation')
  ) predictor
),
ranked AS (
  SELECT predictor.label,predictor.predictor,predictor.address_id,
    NTILE(10) OVER (PARTITION BY predictor.label,predictor.predictor
      ORDER BY predictor.score DESC,predictor.address_id) decile
  FROM predictors predictor
),
evaluated AS (
  SELECT ranked.label,ranked.predictor,ranked.decile,cohort.*
  FROM ranked JOIN cohort ON cohort.label=ranked.label AND cohort.address_id=ranked.address_id
)
SELECT label,predictor,
  COUNT(*) eligible_addresses,
  SUM(CASE WHEN future_transactions>0 THEN 1 ELSE 0 END) returning_addresses,
  ROUND(AVG(CASE WHEN future_transactions>0 THEN 1.0 ELSE 0 END),6) population_return_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_transactions>0 THEN 1.0 ELSE 0 END END),6)
    top_decile_return_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_transactions>0 THEN 1.0 ELSE 0 END END)
    / NULLIF(AVG(CASE WHEN future_transactions>0 THEN 1.0 ELSE 0 END),0),3) return_lift,
  ROUND(AVG(CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END),6) population_persistent_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END END),6)
    top_decile_persistent_rate,
  ROUND(AVG(CASE WHEN decile=1 THEN CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END END)
    / NULLIF(AVG(CASE WHEN future_active_months>=2 THEN 1.0 ELSE 0 END),0),3) persistence_lift,
  MIN(first_outcome_time) first_outcome_time,
  MAX(last_outcome_time) last_outcome_time
FROM evaluated
GROUP BY label,predictor
ORDER BY label,predictor`;
}

export const ADDRESS_ACTIVITY_BASELINE_SQL = addressActivityBaselineSql();

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function parseWranglerResults(stdout) {
  const clean = stripAnsi(stdout);
  const start = clean.indexOf("[\n  {");
  if (start < 0) throw new Error(`Wrangler did not return a JSON result: ${clean.slice(-500)}`);
  const payload = JSON.parse(clean.slice(start));
  const statement = payload[0];
  if (!statement?.success || !Array.isArray(statement.results)) throw new Error("D1 baseline query failed");
  return { rows: statement.results, meta: statement.meta ?? {} };
}

export function validateLeakage(rows) {
  const cutoffs = new Map(CUTOFFS.map(([label, cutoff]) => [label, cutoff]));
  for (const row of rows) {
    const cutoff = cutoffs.get(row.label);
    if (!cutoff) throw new Error(`Unknown cutoff returned by D1: ${row.label}`);
    const end = cutoff + horizonSeconds;
    if (row.first_outcome_time != null && row.first_outcome_time <= cutoff)
      throw new Error(`${row.label}/${row.predictor}: outcome leaked across cutoff`);
    if (row.last_outcome_time != null && row.last_outcome_time > end)
      throw new Error(`${row.label}/${row.predictor}: outcome exceeded ${HORIZON_DAYS}-day horizon`);
  }
}

export function comparePredictors(rows, challenger, baseline, metrics) {
  const byKey = new Map(rows.map((row) => [`${row.label}:${row.predictor}`, row]));
  const cutoffs = [...new Set(rows.map((row) => row.label))].sort();
  const deltas = cutoffs
    .map((label) => {
      const candidate = byKey.get(`${label}:${challenger}`);
      const control = byKey.get(`${label}:${baseline}`);
      if (!candidate || !control) return null;
      return {
        label,
        metrics: Object.fromEntries(
          metrics.map((metric) => [metric, Number(candidate[metric]) - Number(control[metric])]),
        ),
      };
    })
    .filter(Boolean);
  return {
    challenger,
    baseline,
    cutoffs: deltas,
    summary: Object.fromEntries(
      metrics.map((metric) => {
        const values = deltas.map((row) => row.metrics[metric]);
        return [
          metric,
          {
            wins: values.filter((value) => value > 0).length,
            ties: values.filter((value) => value === 0).length,
            losses: values.filter((value) => value < 0).length,
            worst_delta: values.length ? Math.min(...values) : null,
            mean_delta: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          },
        ];
      }),
    ),
  };
}

export function buildReport(assetRows, assetMeta = {}, addressRows = [], addressMeta = {}) {
  validateLeakage([...assetRows, ...addressRows]);
  return {
    schema: "xcp-reputation-baseline/1",
    generated_at: new Date().toISOString(),
    database: "xcpio-core",
    horizon_days: HORIZON_DAYS,
    cutoffs: CUTOFFS.map(([date, timestamp]) => ({ date, timestamp })),
    methodology: {
      asset_population: "assets with at least one canonical trade at or before each cutoff",
      address_population: "addresses originating a supported Counterparty transaction at or before each cutoff",
      features: "canonical history at or before cutoff only; current signal snapshots prohibited",
      outcomes: "canonical history strictly after cutoff through cutoff + horizon",
      top_bucket: "highest predictor decile, deterministic asset_id tie-break",
      challengers: {
        balanced_market: "equal mean of within-cutoff recency, active-month, buyer, and realized-USD percentiles",
        balanced_participation: "equal mean of within-cutoff recency, active-month, and transaction percentiles",
      },
      warning: "history-only baselines; current signal snapshots are intentionally excluded",
    },
    d1: {
      asset_market: {
        rows_read: assetMeta.rows_read ?? null,
        sql_duration_ms: assetMeta.timings?.sql_duration_ms ?? null,
      },
      address_activity: {
        rows_read: addressMeta.rows_read ?? null,
        sql_duration_ms: addressMeta.timings?.sql_duration_ms ?? null,
      },
    },
    asset_market: assetRows,
    address_activity: addressRows,
    comparisons: {
      asset_balanced_vs_active_months: comparePredictors(assetRows, "balanced_market", "active_months", [
        "return_lift",
        "persistence_lift",
        "buyer_breadth_lift",
      ]),
      asset_compact_vs_persistence_core: comparePredictors(assetRows, "compact_market", "persistence_core", [
        "return_lift",
        "persistence_lift",
        "top_decile_log_future_usd",
      ]),
      address_balanced_vs_recency: comparePredictors(addressRows, "balanced_participation", "recency", [
        "return_lift",
        "persistence_lift",
      ]),
    },
  };
}

function execute(wrangler, sql) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "xcpio-core", "--remote", "--command", sql], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.error?.message || result.stderr || result.stdout || `Wrangler exited ${result.status}`);
  return parseWranglerResults(result.stdout);
}

function run() {
  const wrangler = fileURLToPath(new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const assetsOnly = process.argv.includes("--assets-only");
  const addressesOnly = process.argv.includes("--addresses-only");
  if (assetsOnly && addressesOnly) throw new Error("Choose at most one evaluation scope");
  const asset = addressesOnly ? { rows: [], meta: {} } : execute(wrangler, ASSET_MARKET_BASELINE_SQL);
  const addressParts = assetsOnly
    ? []
    : CUTOFFS.map((cutoff) => execute(wrangler, addressActivityBaselineSql([cutoff])));
  const addressRows = addressParts.flatMap((part) => part.rows);
  const addressMeta = {
    rows_read: addressParts.reduce((sum, part) => sum + Number(part.meta.rows_read ?? 0), 0),
    timings: {
      sql_duration_ms: addressParts.reduce((sum, part) => sum + Number(part.meta.timings?.sql_duration_ms ?? 0), 0),
    },
  };
  process.stdout.write(`${JSON.stringify(buildReport(asset.rows, asset.meta, addressRows, addressMeta), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) run();
