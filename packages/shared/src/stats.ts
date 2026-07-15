/** Network-wide surfaces — home summary, lifetime stats, chart series, leaderboards, firsts. */

/** GET /v2/ — the home summary payload (cached). */
export interface StatsOverview {
  tip: number | null;
  assets: number;
  transactions: number;
  balances: number;
  indexed_block: string | null; // indexer cursor (stored as text in indexer_state)
}

/** GET /v2/status - cheap live heartbeat; never scans the large mirror tables. */
export interface SyncOverview {
  tip: number | null;
  indexed_block: string | null;
}

/** GET /v2/stats — lifetime network counts + totals (cached). */
export interface NetworkStats {
  tip: number | null;
  assets: number;
  addresses: number;
  transactions: number;
  sends: number;
  issuances: number;
  dispensers: number;
  dispenses: number;
  orders: number;
  order_matches: number;
  sweeps: number;
  broadcasts: number;
  dividends: number;
  fairmints: number;
  destructions: number;
  burns: number;
  fairminters: number;
  bets: number;
  bet_matches: number;
  btcpays: number;
  cancels: number;
  rps: number;
  rps_matches: number;
  pools: number;
  pool_matches: number;
  pool_deposits: number;
  pool_withdrawals: number;
  holders: number;
  btc_fees: number;
  xcp_destroyed: number;
}

/** A single daily point in a chart series. t = unix seconds (day bucket). */
export interface MetricPoint {
  t: number;
  v: number;
}

/** GET /v2/metrics — daily time-series for the activity charts. */
export interface Metrics {
  transactions: MetricPoint[];
  issuances: MetricPoint[];
  trades: MetricPoint[];
  dispenses: MetricPoint[];
  sends: MetricPoint[];
  btc_fees: MetricPoint[];
  xcp_burned: MetricPoint[];
}

/** GET /v2/leaderboards — derived boards across the whole dataset (cached). Each board is an array
 *  of small ad-hoc row objects (address/asset + the board's metric column); exact columns are the
 *  board's business. */
export interface Leaderboards {
  top_creators: Array<Record<string, unknown>>;
  top_collectors: Array<Record<string, unknown>>;
  top_merchants: Array<Record<string, unknown>>;
  biggest_spenders: Array<Record<string, unknown>>;
  richest_xcp: Array<Record<string, unknown>>;
  most_held: Array<Record<string, unknown>>;
  most_traded: Array<Record<string, unknown>>;
  most_durable: Array<Record<string, unknown>>;
  top_dispensed: Array<Record<string, unknown>>;
  top_dispensers: Array<Record<string, unknown>>;
  top_hits: Array<Record<string, unknown>>;
  broadest_holders: Array<Record<string, unknown>>;
  most_creator_held: Array<Record<string, unknown>>;
  top_stamp_creators: Array<Record<string, unknown>>;
  top_stamp_collectors: Array<Record<string, unknown>>;
  top_src20_deployers: Array<Record<string, unknown>>;
  most_held_stamps: Array<Record<string, unknown>>;
  top_reputation: Array<Record<string, unknown>>;
  top_quality: Array<Record<string, unknown>>;
  include_hidden: boolean;
}

/** GET /v2/firsts — the earliest record of each kind of on-chain moment. */
export interface FirstRow {
  key: string;
  label: string;
  block: number;
  date: string; // ISO yyyy-mm-dd
  ref: string; // display + link id
  type: "block" | "tx" | "address" | "asset" | string;
}
