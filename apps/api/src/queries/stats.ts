/**
 * Network-wide stat queries — the home/lifetime counts, the daily chart series, and the leaderboard
 * boards. Handlers compose presentation only (chart point mapping, echoing the include_hidden flag) and
 * pass in the config-driven reputation SQL; every DB read and every SQL string lives here. The
 * counts/totals row shapes are the wire contract (@xcp/shared/stats).
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

/**
 * XCP destroyed (deflation): issuance/sweep/dividend fees + explicit XCP destructions. `extra` prefixes
 * each SELECT (e.g. "block_time, ") for the time-series variant. Private to stats — the lifetime total
 * (networkTotals) and the daily burn series (metricSeries('xcp_burned')) are its only two callers.
 */
function xcpDestroyed(extra = ""): string {
  return `
  SELECT ${extra}fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
  UNION ALL SELECT ${extra}fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
  UNION ALL SELECT ${extra}fee_paid FROM dividends WHERE fee_paid IS NOT NULL
  UNION ALL SELECT ${extra}quantity FROM destructions WHERE asset='XCP' AND status LIKE 'valid%'`;
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

/** Lifetime totals — BTC miner fees paid and XCP destroyed (deflation). */
export function networkTotals(db: D1Database): Promise<NetworkTotals | null> {
  return one<NetworkTotals>(
    db,
    `SELECT (SELECT COALESCE(SUM(CAST(fee AS REAL)),0)/100000000.0 FROM transactions) btc_fees,
            (SELECT COALESCE(SUM(CAST(amt AS REAL)),0)/100000000.0 FROM (${xcpDestroyed()})) xcp_destroyed`
  );
}

/** The daily chart series the /metrics panel plots. Each is a GROUP BY day on block_time. */
export type MetricName =
  | "transactions" | "issuances" | "dispenses" | "trades" | "sends" | "btc_fees" | "xcp_burned";

// transactions come from blocks (cheap: 1 row/block carries Counterparty's tx_count); issuances/dispenses/trades/
// sends by daily count; btc_fees = daily BTC miner fees; xcp_burned = daily XCP destroyed (deflation).
const METRIC_SQL: Record<MetricName, string> = {
  transactions: `SELECT block_time/86400 d, SUM(transaction_count) v FROM blocks WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  issuances: `SELECT block_time/86400 d, COUNT(*) v FROM issuances WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  dispenses: `SELECT block_time/86400 d, COUNT(*) v FROM dispenses WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  trades: `SELECT block_time/86400 d, COUNT(*) v FROM order_matches WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  sends: `SELECT block_time/86400 d, COUNT(*) v FROM sends WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
  btc_fees: `SELECT block_time/86400 d, SUM(CAST(fee AS REAL))/100000000.0 v FROM transactions WHERE block_time>0 AND fee IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT ?`,
  xcp_burned: `SELECT block_time/86400 d, SUM(CAST(amt AS REAL))/100000000.0 v
    FROM (${xcpDestroyed("block_time, ")}) WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`,
};

/** One daily chart series (newest-first; the handler maps to {t,v} points and reverses). */
export function metricSeries(db: D1Database, name: MetricName, days: number): Promise<MetricDayRow[]> {
  return q<MetricDayRow>(db, METRIC_SQL[name], days);
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
function board(db: D1Database, sql: string): Promise<Array<Record<string, unknown>>> {
  return q<Record<string, unknown>>(db, sql).catch(() => []);
}

type Board = Array<Record<string, unknown>>;

/** Config-driven raw-score SQL composed by the handler (from reputation/config, not request input). */
export interface LeaderboardParams {
  includeHidden: boolean; // show low-quality assets + the bridge/exchange BTC flow that distorts boards
  addrExpr: string; // raw address score over address_signals (tip-aged)
  assetExpr: string; // raw asset score over asset_signals (with the low-quality penalty)
}

/** Every leaderboard board keyed by its wire field. Rows are generic (each board picks its own columns). */
export interface Leaderboards {
  top_creators: Board;
  top_collectors: Board;
  top_merchants: Board;
  biggest_spenders: Board;
  richest_xcp: Board;
  most_held: Board;
  most_traded: Board;
  most_durable: Board;
  top_dispensed: Board;
  top_dispensers: Board;
  top_hits: Board;
  broadest_holders: Board;
  most_creator_held: Board;
  top_stamp_creators: Board;
  top_stamp_collectors: Board;
  top_src20_deployers: Board;
  most_held_stamps: Board;
  top_reputation: Board;
  top_quality: Board;
}

/**
 * The whole leaderboard fan-out in one call. Low-quality assets (bridge/exchange tokens + wash) are HIDDEN
 * by default — they distort the BTC/dispense boards; address boards use CLEAN BTC so bridge deposit flow
 * doesn't inflate merchants/spenders. Reputation/quality boards use the composed score exprs passed in.
 */
export async function leaderboards(db: D1Database, p: LeaderboardParams): Promise<Leaderboards> {
  const dispCol = p.includeHidden ? "dispense_btc" : "clean_dispense_btc";
  const spendCol = p.includeHidden ? "btc_spent" : "clean_btc_spent";
  const lowqF = p.includeHidden ? "" : " AND COALESCE(low_quality,0)=0";
  const { addrExpr, assetExpr } = p;
  const b = (sql: string) => board(db, sql);
  const [topCreators, topCollectors, topMerchants, bigSpenders, richXcp, mostHeld, mostTraded, durable, topDispensed,
         topDispensers, topHits, broadestHolders, mostCreatorHeld,
         stampCreators, stampCollectors, src20Deployers, mostHeldStamps, topReputation, topQuality] = await Promise.all([
    b(`SELECT addr, survived_assets, assets_held FROM address_signals WHERE survived_assets>0 ORDER BY survived_assets DESC LIMIT 12`),
    b(`SELECT addr, assets_held, survived_assets FROM address_signals WHERE assets_held>0 ORDER BY assets_held DESC LIMIT 12`),
    b(`SELECT addr, ROUND(${dispCol},3) dispense_btc FROM address_signals WHERE ${dispCol}>0 ORDER BY ${dispCol} DESC LIMIT 12`),
    b(`SELECT addr, ROUND(${spendCol},3) btc_spent FROM address_signals WHERE ${spendCol}>0 ORDER BY ${spendCol} DESC LIMIT 12`),
    b(`SELECT holder, quantity_normalized FROM balances WHERE asset='XCP' AND holder_type='address' AND CAST(quantity AS INTEGER)>0 ORDER BY CAST(quantity AS INTEGER) DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, holders FROM asset_signals WHERE holders>0${lowqF} ORDER BY holders DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, trades FROM asset_signals WHERE trades>0${lowqF} ORDER BY trades DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, ROUND((last_trade_blk-first_trade_blk)/4320.0,1) months_traded FROM asset_signals WHERE trades>=50 AND self_trade_pct<30${lowqF} ORDER BY (last_trade_blk-first_trade_blk) DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, ROUND(dispense_btc,3) dispense_btc FROM asset_signals WHERE dispense_btc>0${lowqF} ORDER BY dispense_btc DESC LIMIT 12`),
    // trusted dispenser operators, creator "hits", and two asset-quality lenses
    b(`SELECT addr, ROUND(disp_trust,1) disp_trust, dispenses FROM address_signals WHERE disp_trust>0 AND is_exchange=0 ORDER BY disp_trust DESC LIMIT 12`),
    b(`SELECT addr, assets_hits, survived_assets FROM address_signals WHERE assets_hits>0 ORDER BY assets_hits DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, ROUND(holder_breadth,0) holder_breadth, holders FROM asset_signals WHERE holders>=25${lowqF} ORDER BY holder_breadth DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, ROUND(pct_creator_holders,1) pct_creator_holders, holders FROM asset_signals WHERE holders>=25${lowqF} ORDER BY pct_creator_holders DESC LIMIT 12`),
    // Bitcoin Stamps / SRC-20 segmentation boards
    b(`SELECT addr, stamps_created, src20_deploys FROM address_signals WHERE stamps_created>0 ORDER BY stamps_created DESC LIMIT 12`),
    b(`SELECT addr, stamps_collected FROM address_signals WHERE stamps_collected>0 ORDER BY stamps_collected DESC LIMIT 12`),
    b(`SELECT addr, src20_deploys, stamps_created FROM address_signals WHERE src20_deploys>0 ORDER BY src20_deploys DESC LIMIT 12`),
    b(`SELECT s.asset, s.asset_longname, s.holders FROM asset_signals s JOIN tags t ON t.entity_type='asset' AND t.entity_id=s.asset AND t.tag='stamp' WHERE s.holders>0 ORDER BY s.holders DESC LIMIT 12`),
    // reputation: highest-scoring real users (OG board) and highest-quality assets (Bluechip board)
    b(`SELECT addr, ROUND((${addrExpr}),1) score FROM address_signals WHERE is_exchange=0 AND is_deposit=0 AND is_burn=0 AND COALESCE(is_emblem_vault,0)=0 AND COALESCE(likely_service,0)=0 ORDER BY (${addrExpr}) DESC LIMIT 12`),
    b(`SELECT asset, asset_longname, ROUND((${assetExpr}),1) score FROM asset_signals WHERE (trades>0 OR dispenses>0)${lowqF} ORDER BY (${assetExpr}) DESC LIMIT 12`),
  ]);
  return {
    top_creators: topCreators, top_collectors: topCollectors, top_merchants: topMerchants, biggest_spenders: bigSpenders,
    richest_xcp: richXcp, most_held: mostHeld, most_traded: mostTraded, most_durable: durable, top_dispensed: topDispensed,
    top_dispensers: topDispensers, top_hits: topHits, broadest_holders: broadestHolders, most_creator_held: mostCreatorHeld,
    top_stamp_creators: stampCreators, top_stamp_collectors: stampCollectors, top_src20_deployers: src20Deployers,
    most_held_stamps: mostHeldStamps, top_reputation: topReputation, top_quality: topQuality,
  };
}
