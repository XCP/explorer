/**
 * Network-wide stat queries — the home/lifetime counts, the daily chart series, and the leaderboard
 * boards. Handlers compose presentation only (chart point mapping, echoing the include_hidden flag) and
 * pass in the config-driven reputation SQL; every DB read and every SQL string lives here. The
 * counts/totals row shapes are the wire contract (@xcp/shared/stats).
 */
import type { NetworkStats } from "@xcp/shared/stats";
import { q, one } from "#api/db";

/** The lifetime-counts half of NetworkStats (everything the totals query does not supply). */
export type NetworkCounts = Omit<NetworkStats, "btc_fees" | "btc_fees_complete" | "xcp_destroyed">;
/** The lifetime-totals half of NetworkStats (BTC miner fees + XCP destroyed). */
export type NetworkTotals = Pick<NetworkStats, "btc_fees" | "btc_fees_complete" | "xcp_destroyed">;

/** A single day bucket returned by a metrics series query. */
export interface MetricDayRow {
  d: number;
  v: number;
}

/** The daily chart series the /metrics panel plots. Each is a GROUP BY day on block_time. */
export type MetricName =
  | "transactions"
  | "bitcoin_transactions"
  | "xcp_share"
  | "issuances"
  | "dispenses"
  | "trades"
  | "sends"
  | "btc_fees"
  | "xcp_burned";

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

export interface LeaderboardParams {
  includeHidden: boolean; // show low-quality assets + the bridge/exchange BTC flow that distorts boards
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
  top_rated: Board;
}

/**
 * The whole leaderboard fan-out in one call. Low-quality assets (bridge/exchange tokens + wash) are HIDDEN
 * by default — they distort the BTC/dispense boards; address boards use CLEAN BTC so bridge deposit flow
 * doesn't inflate merchants/spenders. Reputation/quality boards use the composed score exprs passed in.
 */
export async function leaderboards(db: D1Database, p: LeaderboardParams): Promise<Leaderboards> {
  const dispCol = p.includeHidden ? "dispense_btc" : "clean_dispense_btc";
  const spendCol = p.includeHidden ? "btc_spent" : "clean_btc_spent";
  const lowqF = p.includeHidden ? "" : " AND low_quality=0";
  const b = (sql: string) => board(db, sql);
  const [
    topCreators,
    topCollectors,
    topMerchants,
    bigSpenders,
    richXcp,
    mostHeld,
    mostTraded,
    durable,
    topDispensed,
    topDispensers,
    topHits,
    broadestHolders,
    mostCreatorHeld,
    stampCreators,
    stampCollectors,
    src20Deployers,
    mostHeldStamps,
    topReputation,
    topQuality,
  ] = await Promise.all([
    b(
      `SELECT dictionary.address,signal.survived_assets,signal.assets_held FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.survived_assets>0 ORDER BY signal.survived_assets DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.address,signal.assets_held,signal.survived_assets FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.assets_held>0 ORDER BY signal.assets_held DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.address,ROUND(signal.${dispCol},3) dispense_btc FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.${dispCol}>0 ORDER BY signal.${dispCol} DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.address,ROUND(signal.${spendCol},3) btc_spent FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.${spendCol}>0 ORDER BY signal.${spendCol} DESC LIMIT 12`,
    ),
    b(
      `SELECT address.address holder,balance.quantity_normalized FROM balances balance
       JOIN asset_dictionary asset ON asset.asset_id=balance.asset_id AND asset.asset='XCP'
       JOIN address_dictionary address ON address.address_id=balance.address_id
       WHERE CAST(balance.quantity AS INTEGER)>0 ORDER BY CAST(balance.quantity AS INTEGER) DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,signal.holders FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       WHERE signal.holders>0${lowqF} ORDER BY signal.holders DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,signal.trades FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       WHERE signal.trades>0${lowqF} ORDER BY signal.trades DESC,signal.asset_id LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,
       ROUND((signal.last_trade_blk-signal.first_trade_blk)/4320.0,1) months_traded
       FROM asset_signals signal JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       WHERE signal.trades>=50 AND signal.self_trade_pct<30${lowqF}
       ORDER BY (signal.last_trade_blk-signal.first_trade_blk) DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,ROUND(signal.dispense_btc,3) dispense_btc
       FROM asset_signals signal JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       WHERE signal.dispense_btc>0${lowqF} ORDER BY signal.dispense_btc DESC LIMIT 12`,
    ),
    // trusted dispenser operators, creator "hits", and two asset-quality lenses
    b(
      `SELECT dictionary.address,ROUND(signal.disp_trust,1) disp_trust,signal.dispenses
       FROM address_signals signal JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.disp_trust>0 AND signal.is_exchange=0 ORDER BY signal.disp_trust DESC,signal.address_id LIMIT 12`,
    ),
    b(
      `SELECT dictionary.address,signal.assets_hits,signal.survived_assets FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.assets_hits>0 ORDER BY signal.assets_hits DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,ROUND(signal.holder_breadth,0) holder_breadth,signal.holders
       FROM asset_signals signal JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       WHERE signal.holders>=25${lowqF} ORDER BY signal.holder_breadth DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,ROUND(signal.pct_creator_holders,1) pct_creator_holders,
       signal.holders FROM asset_signals signal JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       WHERE signal.holders>=25${lowqF} ORDER BY signal.pct_creator_holders DESC LIMIT 12`,
    ),
    // Bitcoin Stamps / SRC-20 segmentation boards
    b(
      `SELECT dictionary.address,signal.stamps_created,signal.src20_deploys FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.stamps_created>0 ORDER BY signal.stamps_created DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.address,signal.stamps_collected FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.stamps_collected>0 ORDER BY signal.stamps_collected DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.address,signal.src20_deploys,signal.stamps_created FROM address_signals signal
       JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
       WHERE signal.src20_deploys>0 ORDER BY signal.src20_deploys DESC LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,signal.holders FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets state ON state.asset_id=signal.asset_id
       JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
       JOIN tags tag ON tag.entity_id=entity.entity_id AND tag.tag='stamp'
       WHERE signal.holders>0 ORDER BY signal.holders DESC LIMIT 12`,
    ),
    // reputation: highest-ranked address track records and highest-rated assets
    b(
      `SELECT dictionary.address,ROUND(reputation.reputation,1) score
       FROM address_reputations reputation JOIN address_dictionary dictionary USING(address_id)
       ORDER BY reputation.reputation DESC,reputation.address_id LIMIT 12`,
    ),
    b(
      `SELECT dictionary.asset,state.asset_longname,rating.rating
       FROM asset_ratings rating JOIN asset_dictionary dictionary ON dictionary.asset_id=rating.asset_id
       LEFT JOIN assets state ON state.asset_id=rating.asset_id
       ORDER BY rating.rating DESC,rating.asset_id LIMIT 12`,
    ),
  ]);
  return {
    top_creators: topCreators,
    top_collectors: topCollectors,
    top_merchants: topMerchants,
    biggest_spenders: bigSpenders,
    richest_xcp: richXcp,
    most_held: mostHeld,
    most_traded: mostTraded,
    most_durable: durable,
    top_dispensed: topDispensed,
    top_dispensers: topDispensers,
    top_hits: topHits,
    broadest_holders: broadestHolders,
    most_creator_held: mostCreatorHeld,
    top_stamp_creators: stampCreators,
    top_stamp_collectors: stampCollectors,
    top_src20_deployers: src20Deployers,
    most_held_stamps: mostHeldStamps,
    top_reputation: topReputation,
    top_rated: topQuality,
  };
}
