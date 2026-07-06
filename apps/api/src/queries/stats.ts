/**
 * Network-wide stat queries — the home/lifetime counts, the daily chart series, and the leaderboard
 * boards. Handlers compose the payloads (chart mapping, board layout); every DB read goes through one of
 * these typed functions. The counts/totals row shapes are the wire contract (@xcp/shared/stats).
 */
import type { StatsOverview, NetworkStats } from "@xcp/shared/stats";
import { q, one } from "../db";

/** The lifetime-counts half of NetworkStats (everything the totals query does not supply). */
export type NetworkCounts = Omit<NetworkStats, "btc_fees" | "xcp_destroyed">;
/** The lifetime-totals half of NetworkStats (BTC miner fees + XCP destroyed). */
export type NetworkTotals = Pick<NetworkStats, "btc_fees" | "xcp_destroyed">;

/** A single day bucket returned by a metrics series query. */
export interface MetricDayRow {
  d: number;
  v: number;
}

/** Home summary — tip, headline counts, indexer cursor. */
export function homeOverview(db: D1Database): Promise<StatsOverview | null> {
  return one<StatsOverview>(
    db,
    `SELECT (SELECT MAX(block_index) FROM blocks) tip,
            (SELECT COUNT(*) FROM assets) assets,
            (SELECT COUNT(*) FROM transactions) transactions,
            (SELECT COUNT(*) FROM balances) balances,
            (SELECT value FROM indexer_state WHERE key='last_block_index') indexed_block`
  );
}

/** Lifetime network counts — O(n) covering-index scans (cached by the handler). */
export function networkCounts(db: D1Database): Promise<NetworkCounts | null> {
  return one<NetworkCounts>(
    db,
    `SELECT (SELECT MAX(block_index) FROM blocks) tip,
            (SELECT COUNT(*) FROM assets) assets,
            (SELECT COUNT(*) FROM transactions) transactions,
            (SELECT COUNT(*) FROM sends) sends,
            (SELECT COUNT(*) FROM issuances) issuances,
            (SELECT COUNT(*) FROM dispensers) dispensers,
            (SELECT COUNT(*) FROM dispenses) dispenses,
            (SELECT COUNT(*) FROM orders) orders,
            (SELECT COUNT(*) FROM order_matches) order_matches,
            (SELECT COUNT(*) FROM sweeps) sweeps,
            (SELECT COUNT(*) FROM broadcasts) broadcasts,
            (SELECT COUNT(*) FROM dividends) dividends,
            (SELECT COUNT(*) FROM fairmints) fairmints,
            (SELECT COUNT(*) FROM destructions) destructions,
            (SELECT COUNT(*) FROM balances WHERE CAST(quantity AS INTEGER)>0) holders`
  );
}

/**
 * Lifetime totals — BTC miner fees paid and XCP destroyed (deflation). The XCP-destroyed UNION-ALL
 * subquery is owned by read/shared (xcpDestroyed()) and shared with /metrics, so it is passed in.
 */
export function networkTotals(db: D1Database, xcpDestroyedSql: string): Promise<NetworkTotals | null> {
  return one<NetworkTotals>(
    db,
    `SELECT (SELECT COALESCE(SUM(CAST(fee AS REAL)),0)/100000000.0 FROM transactions) btc_fees,
            (SELECT COALESCE(SUM(CAST(amt AS REAL)),0)/100000000.0 FROM (${xcpDestroyedSql})) xcp_destroyed`
  );
}

/** One daily chart series (GROUP BY day on block_time); `sql` binds a single `days` LIMIT. */
export function metricSeries(db: D1Database, sql: string, days: number): Promise<MetricDayRow[]> {
  return q<MetricDayRow>(db, sql, days);
}

/** MAX(block_index) — the tip, used to age the reputation terms in the leaderboard SQL. */
export function maxBlock(db: D1Database): Promise<number> {
  return one<{ m: number }>(db, `SELECT MAX(block_index) m FROM blocks`).then((r) => Number(r?.m) || 0);
}

/**
 * Run one leaderboard board. Each board is a small ad-hoc SELECT off a precomputed signal table; the
 * column set is the board's business, so rows stay generic. Any error yields [] (a board never fails the
 * whole fan-out) — preserving the original per-board `.catch(() => [])`.
 */
export function board(db: D1Database, sql: string): Promise<Array<Record<string, unknown>>> {
  return q<Record<string, unknown>>(db, sql).catch(() => []);
}
