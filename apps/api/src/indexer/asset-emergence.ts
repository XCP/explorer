const DAY = 86_400;
const OBSERVATION_DAYS = 30;
const RETENTION_DAYS = 90;

const UPSERT = `INSERT INTO asset_emergence(
    asset_id,issued_at,observation_cutoff,observed_through,finalized,trades,buyers,sellers,
    active_days,late_buyers,late_active_days,market_span_days,venues,updated_at)
  WITH candidate AS MATERIALIZED (
    SELECT asset.asset_id,asset.first_issuance_block_time issued_at,
      asset.first_issuance_block_time+${OBSERVATION_DAYS * DAY} observation_cutoff
    FROM assets asset
    WHERE asset.type='asset' AND asset.first_issuance_block_time>0
      AND asset.first_issuance_block_time<=?1
      AND (asset.first_issuance_block_time>=?1-${RETENTION_DAYS * DAY} OR EXISTS(
        SELECT 1 FROM asset_emergence prior WHERE prior.asset_id=asset.asset_id AND prior.finalized=0
      ))
  ), evidence AS (
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
  )
  SELECT asset_id,issued_at,observation_cutoff,observed_through,
    observation_cutoff<=?1,trades,buyers,sellers,active_days,late_buyers,late_active_days,
    market_span_days,venues,?1 FROM evidence WHERE 1
  ON CONFLICT(asset_id) DO UPDATE SET
    issued_at=excluded.issued_at,observation_cutoff=excluded.observation_cutoff,
    observed_through=excluded.observed_through,finalized=excluded.finalized,trades=excluded.trades,
    buyers=excluded.buyers,sellers=excluded.sellers,active_days=excluded.active_days,
    late_buyers=excluded.late_buyers,late_active_days=excluded.late_active_days,
    market_span_days=excluded.market_span_days,venues=excluded.venues,updated_at=excluded.updated_at`;

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
