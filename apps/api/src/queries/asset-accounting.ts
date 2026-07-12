import { one } from "../db";

export interface AssetAccounting {
  holder_count: number;
  supply: string | null;
  burned: string | null;
  escrow: string | null;
}

/** Holder count and exact supply accounting in one D1 round trip. Every scalar subquery is index-backed. */
export function assetAccounting(db: D1Database, asset: string): Promise<AssetAccounting | null> {
  return one<AssetAccounting>(
    db,
    `SELECT
    (SELECT COUNT(*) FROM balances WHERE asset=?1 AND CAST(quantity AS INTEGER)>0) holder_count,
    CAST((SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM issuances WHERE asset=?1 AND status LIKE 'valid%')
       - (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM destructions WHERE asset=?1 AND status LIKE 'valid%') AS TEXT) supply,
    CAST((SELECT COALESCE(SUM(CAST(b.quantity AS INTEGER)),0) FROM balances b
      JOIN address_signals s ON s.address=b.holder WHERE b.asset=?1 AND s.is_burn=1) AS TEXT) burned,
    CAST((SELECT COALESCE(SUM(CAST(give_remaining AS INTEGER)),0) FROM dispensers WHERE asset=?1 AND status=0)
       + (SELECT COALESCE(SUM(CAST(give_remaining AS INTEGER)),0) FROM orders WHERE give_asset=?1 AND status='open') AS TEXT) escrow`,
    asset,
  );
}
