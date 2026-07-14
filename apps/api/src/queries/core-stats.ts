import type { StatsOverview, SyncOverview } from "@xcp/shared/stats";
import { one } from "#api/db";
import type { NetworkCounts, NetworkTotals } from "#api/queries/stats";

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
