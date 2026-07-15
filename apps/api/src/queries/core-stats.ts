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

/** Asset-filtered lifetime snapshot producer. Its result is materialized by the API cache; protocol-wide
 * relations without an asset identity remain equal to the canonical network snapshot. */
export function coreQualityNetworkStats(db: D1Database): Promise<(NetworkCounts & NetworkTotals) | null> {
  return one<NetworkCounts & NetworkTotals>(
    db,
    `WITH snapshot AS (SELECT * FROM network_stats_snapshot WHERE singleton=1),
      lowq_tx_core AS (
        SELECT item.tx_index FROM asset_signals signal CROSS JOIN sends item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN issuances item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN dispensers item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN dispenses item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN orders item ON item.give_asset_id=signal.asset_id WHERE signal.low_quality=1
      ), lowq_tx_protocol AS (
        SELECT item.tx_index FROM asset_signals signal CROSS JOIN orders item ON item.get_asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN dividends item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN fairmints item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
        UNION SELECT item.tx_index FROM asset_signals signal CROSS JOIN destructions item ON item.asset_id=signal.asset_id WHERE signal.low_quality=1
      ), lowq_tx AS (
        SELECT tx_index FROM lowq_tx_core UNION SELECT tx_index FROM lowq_tx_protocol
      )
    SELECT (SELECT MAX(block_index) FROM blocks) tip,
      snapshot.assets-(SELECT COUNT(*) FROM asset_signals WHERE low_quality=1) assets,
      snapshot.transactions,
      snapshot.sends-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN sends item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) sends,
      snapshot.issuances-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN issuances item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) issuances,
      snapshot.dispensers-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN dispensers item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) dispensers,
      snapshot.dispenses-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN dispenses item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) dispenses,
      (SELECT COUNT(*) FROM orders item
        LEFT JOIN asset_signals give_signal ON give_signal.asset_id=item.give_asset_id
        LEFT JOIN asset_signals get_signal ON get_signal.asset_id=item.get_asset_id
        WHERE COALESCE(give_signal.low_quality,0)=0 AND COALESCE(get_signal.low_quality,0)=0) orders,
      (SELECT COUNT(*) FROM order_matches item
        LEFT JOIN asset_signals forward_signal ON forward_signal.asset_id=item.forward_asset_id
        LEFT JOIN asset_signals backward_signal ON backward_signal.asset_id=item.backward_asset_id
        WHERE COALESCE(forward_signal.low_quality,0)=0 AND COALESCE(backward_signal.low_quality,0)=0) order_matches,
      snapshot.sweeps,snapshot.broadcasts,
      snapshot.dividends-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN dividends item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) dividends,
      snapshot.fairmints-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN fairmints item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) fairmints,
      snapshot.destructions-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN destructions item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1) destructions,
      snapshot.holders-(SELECT COUNT(*) FROM asset_signals signal CROSS JOIN balances item ON item.asset_id=signal.asset_id
        WHERE signal.low_quality=1 AND CAST(item.quantity AS INTEGER)>0) holders,
      (SELECT COALESCE(SUM(CAST(tx.fee AS REAL)),0)/100000000.0 FROM transactions tx
        LEFT JOIN lowq_tx hidden ON hidden.tx_index=tx.tx_index WHERE hidden.tx_index IS NULL) btc_fees,
      (SELECT COALESCE(SUM(CAST(amount AS REAL)),0)/100000000.0 FROM (
        SELECT item.fee_paid amount FROM issuances item LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
          WHERE item.status LIKE 'valid%' AND item.fee_paid IS NOT NULL AND COALESCE(signal.low_quality,0)=0
        UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
        UNION ALL SELECT item.fee_paid FROM dividends item LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
          WHERE item.fee_paid IS NOT NULL AND COALESCE(signal.low_quality,0)=0
        UNION ALL SELECT item.quantity FROM destructions item WHERE item.status LIKE 'valid%'
          AND item.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
      )) xcp_destroyed
    FROM snapshot`,
  );
}

const CORE_METRICS: Record<MetricName, string> = {
  transactions: "transactions",
  issuances: "issuances",
  dispenses: "dispenses",
  trades: "trades",
  sends: "sends",
  btc_fees: "btc_fees",
  xcp_burned: "xcp_burned",
};

const CLEAN_METRICS: Record<Exclude<MetricName, "transactions">, string> = {
  issuances: `SELECT item.block_time/86400 d,COUNT(*) v FROM issuances item
    LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
    WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks) AND COALESCE(signal.low_quality,0)=0 GROUP BY d`,
  dispenses: `SELECT item.block_time/86400 d,COUNT(*) v FROM dispenses item
    LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
    WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks) AND COALESCE(signal.low_quality,0)=0 GROUP BY d`,
  trades: `SELECT item.block_time/86400 d,COUNT(*) v FROM order_matches item
    LEFT JOIN asset_signals forward_signal ON forward_signal.asset_id=item.forward_asset_id
    LEFT JOIN asset_signals backward_signal ON backward_signal.asset_id=item.backward_asset_id
    WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks)
      AND COALESCE(forward_signal.low_quality,0)=0 AND COALESCE(backward_signal.low_quality,0)=0 GROUP BY d`,
  sends: `SELECT item.block_time/86400 d,COUNT(*) v FROM sends item
    LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
    WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks) AND COALESCE(signal.low_quality,0)=0 GROUP BY d`,
  btc_fees: `SELECT tx.block_time/86400 d,SUM(CAST(tx.fee AS REAL))/100000000.0 v FROM transactions tx
    WHERE tx.block_index>(SELECT MAX(block_index)-? FROM blocks) AND tx.fee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT asset_id FROM sends WHERE tx_index=tx.tx_index
        UNION SELECT asset_id FROM issuances WHERE tx_index=tx.tx_index
        UNION SELECT asset_id FROM dispensers WHERE tx_index=tx.tx_index
        UNION SELECT asset_id FROM dispenses WHERE tx_index=tx.tx_index
        UNION SELECT give_asset_id FROM orders WHERE tx_index=tx.tx_index
      ) event JOIN asset_signals signal ON signal.asset_id=event.asset_id WHERE signal.low_quality=1
    ) AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT get_asset_id asset_id FROM orders WHERE tx_index=tx.tx_index
        UNION SELECT asset_id FROM dividends WHERE tx_index=tx.tx_index
        UNION SELECT asset_id FROM fairmints WHERE tx_index=tx.tx_index
        UNION SELECT asset_id FROM destructions WHERE tx_index=tx.tx_index
      ) event JOIN asset_signals signal ON signal.asset_id=event.asset_id WHERE signal.low_quality=1
    ) GROUP BY d`,
  xcp_burned: `SELECT block_time/86400 d,SUM(amount)/100000000.0 v FROM (
      SELECT item.block_time,CAST(item.fee_paid AS REAL) amount FROM issuances item
        LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
        WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks) AND item.status LIKE 'valid%'
          AND item.fee_paid IS NOT NULL AND COALESCE(signal.low_quality,0)=0
      UNION ALL SELECT block_time,CAST(fee_paid AS REAL) FROM sweeps
        WHERE block_index>(SELECT MAX(block_index)-? FROM blocks) AND fee_paid IS NOT NULL
      UNION ALL SELECT item.block_time,CAST(item.fee_paid AS REAL) FROM dividends item
        LEFT JOIN asset_signals signal ON signal.asset_id=item.asset_id
        WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks) AND item.fee_paid IS NOT NULL
          AND COALESCE(signal.low_quality,0)=0
      UNION ALL SELECT item.block_time,CAST(item.quantity AS REAL) FROM destructions item
        WHERE item.block_index>(SELECT MAX(block_index)-? FROM blocks) AND item.status LIKE 'valid%'
          AND item.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
    ) GROUP BY d`,
};

export function coreMetricSeries(
  db: D1Database,
  name: MetricName,
  days: number,
  includeHidden = true,
): Promise<MetricDayRow[]> {
  const column = CORE_METRICS[name];
  if (!includeHidden && name !== "transactions") {
    const sql = CLEAN_METRICS[name];
    const cutoff = (days + 2) * 144;
    const binds = Array(sql.matchAll(/\?/g)).map(() => cutoff);
    return q<MetricDayRow>(db, `SELECT d,v FROM (${sql}) WHERE d IS NOT NULL ORDER BY d DESC LIMIT ?`, ...binds, days);
  }
  return q<MetricDayRow>(
    db,
    `SELECT day d,${column} v FROM daily_metrics WHERE ${column} IS NOT NULL ORDER BY day DESC LIMIT ?`,
    days,
  );
}
