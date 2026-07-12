import type { AssetFeedCounts } from "@xcp/shared/assets";
import { one } from "../db";

/** Canonical live aggregation, retained as the rollout fallback and production parity oracle. */
export function readAssetFeedCountsLive(
  db: D1Database,
  asset: string,
  issuer: string | null,
): Promise<AssetFeedCounts | null> {
  return one<AssetFeedCounts>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM trades WHERE asset=?1) sales,
       (SELECT COUNT(*) FROM issuances WHERE asset=?1) issuances,
       (SELECT COUNT(*) FROM dispensers WHERE asset=?1) dispensers,
       (SELECT COUNT(*) FROM dispenses WHERE asset=?1) dispenses,
       (SELECT COUNT(*) FROM orders WHERE give_asset=?1 OR get_asset=?1) orders,
       (SELECT COUNT(*) FROM sends WHERE asset=?1) sends,
       (SELECT COUNT(*) FROM assets WHERE asset_longname LIKE ?2) subassets,
       (SELECT COUNT(*) FROM assets WHERE issuer=?3 OR owner=?3) from_issuer,
       (SELECT COUNT(*) FROM fairmints WHERE asset=?1) fairmints,
       (SELECT COUNT(*) FROM dividends WHERE asset=?1 OR dividend_asset=?1) dividends,
       (SELECT COUNT(*) FROM destructions WHERE asset=?1) destructions,
       (SELECT COUNT(*) FROM pools WHERE asset_a=?1 OR asset_b=?1 OR lp_asset=?1) pools`,
    asset, asset + ".%", issuer,
  );
}

/** Materialized hot counts plus the two cheap live counts, gated until the first full build completes. */
export async function readAssetFeedCounts(
  db: D1Database,
  asset: string,
  issuer: string | null,
): Promise<AssetFeedCounts | null> {
  const materialized = await one<AssetFeedCounts>(
    db,
    `SELECT fc.sales,fc.issuances,fc.dispensers,fc.dispenses,fc.orders,fc.sends,
            fc.fairmints,fc.dividends,fc.destructions,fc.pools,fc.subassets,
            (SELECT COUNT(*) FROM assets WHERE issuer=?2 OR owner=?2) from_issuer
       FROM asset_feed_counts fc
      WHERE fc.asset=?1
        AND EXISTS (SELECT 1 FROM indexer_state WHERE key='asset_feed_counts_ready' AND value='1')`,
    asset, issuer,
  ).catch(() => null);
  return materialized ?? readAssetFeedCountsLive(db, asset, issuer);
}
