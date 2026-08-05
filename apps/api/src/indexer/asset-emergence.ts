const DAY = 86_400;
const OBSERVATION_DAYS = 30;
const RETENTION_DAYS = 90;

// The UPSERT's WHERE guard skips rows whose EVIDENCE is unchanged — the hourly refresh recomputes every
// candidate in the 90-day retention window, and most see no new trades or mints between runs. As a result
// observed_through/updated_at advance only when evidence changes (or at finalization); nothing reads them
// as a liveness clock.

const UPSERT = `INSERT INTO asset_emergence(
    asset_id,issued_at,observation_cutoff,observed_through,finalized,trades,buyers,sellers,
    active_days,late_buyers,late_active_days,market_span_days,venues,fairmints,minters,
    paid_minters,mint_active_days,late_minters,updated_at)
  WITH candidate AS MATERIALIZED (
    SELECT asset.asset_id,asset.first_issuance_block_time issued_at,
      asset.first_issuance_block_time+${OBSERVATION_DAYS * DAY} observation_cutoff,asset.issuer_id
    FROM assets asset
    WHERE asset.type='asset' AND asset.first_issuance_block_time>0
      AND asset.first_issuance_block_time<=?1
      AND (asset.first_issuance_block_time>=?1-${RETENTION_DAYS * DAY} OR EXISTS(
        SELECT 1 FROM asset_emergence prior WHERE prior.asset_id=asset.asset_id AND prior.finalized=0
      ))
  ), market_evidence AS (
    SELECT candidate.asset_id,candidate.issued_at,candidate.observation_cutoff,
      MIN(?1,candidate.observation_cutoff) observed_through,
      COUNT(trade.ref) trades,
      COUNT(DISTINCT trade.buyer_id) buyers,
      COUNT(DISTINCT trade.seller_id) sellers,
      COUNT(DISTINCT strftime('%Y-%m-%d',trade.block_time,'unixepoch')) active_days,
      COUNT(DISTINCT CASE WHEN trade.block_time>=candidate.issued_at+${15 * DAY} THEN trade.buyer_id END) late_buyers,
      COUNT(DISTINCT CASE WHEN trade.block_time>=candidate.issued_at+${15 * DAY}
        THEN strftime('%Y-%m-%d',trade.block_time,'unixepoch') END) late_active_days,
      COALESCE((MAX(trade.block_time)-MIN(trade.block_time))/${DAY}.0,0) market_span_days,
      COUNT(DISTINCT trade.venue) venues
    FROM candidate LEFT JOIN trades trade ON trade.asset_id=candidate.asset_id
      AND trade.block_time>=candidate.issued_at
      AND trade.block_time<=MIN(?1,candidate.observation_cutoff)
      AND (trade.buyer_id IS NULL OR trade.seller_id IS NULL OR trade.buyer_id<>trade.seller_id)
    GROUP BY candidate.asset_id,candidate.issued_at,candidate.observation_cutoff
  ), primary_evidence AS (
    SELECT candidate.asset_id,
      COUNT(mint.event_index) fairmints,
      COUNT(DISTINCT CASE WHEN mint.source_id<>candidate.issuer_id THEN mint.source_id END) minters,
      COUNT(DISTINCT CASE WHEN mint.source_id<>candidate.issuer_id
        AND CAST(mint.paid_quantity AS INTEGER)>0 THEN mint.source_id END) paid_minters,
      COUNT(DISTINCT CASE WHEN mint.source_id<>candidate.issuer_id
        THEN strftime('%Y-%m-%d',mint.block_time,'unixepoch') END) mint_active_days,
      COUNT(DISTINCT CASE WHEN mint.source_id<>candidate.issuer_id
        AND mint.block_time>=candidate.issued_at+${15 * DAY} THEN mint.source_id END) late_minters
    FROM candidate LEFT JOIN fairmints mint ON mint.asset_id=candidate.asset_id
      AND mint.status='valid' AND mint.block_time>=candidate.issued_at
      AND mint.block_time<=MIN(?1,candidate.observation_cutoff)
    GROUP BY candidate.asset_id
  )
  SELECT market.asset_id,market.issued_at,market.observation_cutoff,market.observed_through,
    market.observation_cutoff<=?1,market.trades,market.buyers,market.sellers,market.active_days,
    market.late_buyers,market.late_active_days,market.market_span_days,market.venues,
    minting.fairmints,minting.minters,minting.paid_minters,minting.mint_active_days,
    minting.late_minters,?1 FROM market_evidence market JOIN primary_evidence minting USING(asset_id)
  ON CONFLICT(asset_id) DO UPDATE SET
    issued_at=excluded.issued_at,observation_cutoff=excluded.observation_cutoff,
    observed_through=excluded.observed_through,finalized=excluded.finalized,trades=excluded.trades,
    buyers=excluded.buyers,sellers=excluded.sellers,active_days=excluded.active_days,
    late_buyers=excluded.late_buyers,late_active_days=excluded.late_active_days,
    market_span_days=excluded.market_span_days,venues=excluded.venues,fairmints=excluded.fairmints,
    minters=excluded.minters,paid_minters=excluded.paid_minters,
    mint_active_days=excluded.mint_active_days,late_minters=excluded.late_minters,
    updated_at=excluded.updated_at
  WHERE asset_emergence.finalized IS NOT excluded.finalized
    OR asset_emergence.issued_at IS NOT excluded.issued_at
    OR asset_emergence.observation_cutoff IS NOT excluded.observation_cutoff
    OR asset_emergence.trades IS NOT excluded.trades OR asset_emergence.buyers IS NOT excluded.buyers
    OR asset_emergence.sellers IS NOT excluded.sellers
    OR asset_emergence.active_days IS NOT excluded.active_days
    OR asset_emergence.late_buyers IS NOT excluded.late_buyers
    OR asset_emergence.late_active_days IS NOT excluded.late_active_days
    OR asset_emergence.market_span_days IS NOT excluded.market_span_days
    OR asset_emergence.venues IS NOT excluded.venues OR asset_emergence.fairmints IS NOT excluded.fairmints
    OR asset_emergence.minters IS NOT excluded.minters
    OR asset_emergence.paid_minters IS NOT excluded.paid_minters
    OR asset_emergence.mint_active_days IS NOT excluded.mint_active_days
    OR asset_emergence.late_minters IS NOT excluded.late_minters`;

export interface EmergenceRefresh {
  refreshed: number;
  fresh: number;
  emerging: number;
}

/** Refresh recent evidence and freeze it against the exact first-issuance + 30-day cutoff. */
export async function refreshAssetEmergence(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
): Promise<EmergenceRefresh> {
  await db.prepare(UPSERT).bind(now).run();
  const counts = await db
    .prepare(
      `SELECT COUNT(*) refreshed,
        SUM(issued_at>?1-${30 * DAY}) fresh,
        SUM(issued_at<=?1-${30 * DAY} AND issued_at>?1-${90 * DAY}) emerging
      FROM asset_emergence WHERE issued_at>?1-${90 * DAY}`,
    )
    .bind(now)
    .first<EmergenceRefresh>();
  return {
    refreshed: Number(counts?.refreshed ?? 0),
    fresh: Number(counts?.fresh ?? 0),
    emerging: Number(counts?.emerging ?? 0),
  };
}
