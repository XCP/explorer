import type { StatsOverview, SyncOverview } from "@xcp/shared/stats";
import { one, q } from "#api/db";
import type { MetricDayRow, MetricName, NetworkCounts, NetworkTotals } from "#api/queries/stats";

const CHAIN_POSITION = `(SELECT MAX(block_index) FROM blocks)`;

export function coreHomeOverview(db: D1Database): Promise<StatsOverview | null> {
  return one<StatsOverview>(
    db,
    `SELECT ${CHAIN_POSITION} tip,snapshot.assets,snapshot.transactions,snapshot.balances,
            CAST(${CHAIN_POSITION} AS TEXT) indexed_block
       FROM network_stats_snapshot snapshot WHERE snapshot.singleton=1`,
  );
}

export function coreSyncOverview(db: D1Database): Promise<SyncOverview | null> {
  return one<SyncOverview>(db, `SELECT ${CHAIN_POSITION} tip,CAST(${CHAIN_POSITION} AS TEXT) indexed_block`);
}

export function coreNetworkCounts(db: D1Database): Promise<NetworkCounts | null> {
  return one<NetworkCounts>(
    db,
    `SELECT ${CHAIN_POSITION} tip,assets,transactions,sends,issuances,dispensers,dispenses,orders,
            order_matches,sweeps,broadcasts,dividends,fairmints,destructions,holders
       FROM network_stats_snapshot WHERE singleton=1`,
  );
}

export function coreNetworkTotals(db: D1Database): Promise<NetworkTotals | null> {
  return one<NetworkTotals>(db, `SELECT btc_fees,xcp_destroyed FROM network_stats_snapshot WHERE singleton=1`);
}

const CORE_METRICS: Record<MetricName, string> = {
  transactions: `SELECT block_time/86400 d,SUM(transaction_count) v FROM blocks
    WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  issuances: `SELECT block_time/86400 d,COUNT(*) v FROM issuances
    WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  dispenses: `SELECT block_time/86400 d,COUNT(*) v FROM dispenses
    WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  trades: `SELECT block_time/86400 d,COUNT(*) v FROM order_matches
    WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  sends: `SELECT block_time/86400 d,COUNT(*) v FROM sends
    WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  btc_fees: `SELECT block_time/86400 d,SUM(CAST(fee AS REAL))/100000000.0 v FROM transactions
    WHERE block_time>0 AND fee IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT ?`,
  xcp_burned: `SELECT block_time/86400 d,SUM(CAST(amount AS REAL))/100000000.0 v FROM (
      SELECT block_time,fee_paid amount FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
      UNION ALL SELECT block_time,fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
      UNION ALL SELECT block_time,fee_paid FROM dividends WHERE fee_paid IS NOT NULL
      UNION ALL SELECT destruction.block_time,destruction.quantity FROM destructions destruction
        WHERE destruction.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
          AND destruction.status LIKE 'valid%'
    ) WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
};

export function coreMetricSeries(db: D1Database, name: MetricName, days: number): Promise<MetricDayRow[]> {
  return q<MetricDayRow>(db, CORE_METRICS[name], days);
}
