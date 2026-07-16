import { q } from "#api/db";

const DAY = 86_400;

export interface EmergingAsset {
  asset: string;
  asset_longname: string | null;
  issued_at: number;
  observation_cutoff: number;
  evidence_updated_at: number;
  age_days: number;
  market_formation: number;
  trades: number;
  buyers: number;
  sellers: number;
  active_days: number;
  late_buyers: number;
  late_active_days: number;
  market_span_days: number;
  venues: number;
  holders: number;
  supply: number;
}

/** Ranked day-30 evidence for assets that have not yet reached day 90. */
export function listEmergingAssets(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
  limit = 40,
): Promise<EmergingAsset[]> {
  return q<EmergingAsset>(
    db,
    `WITH eligible AS MATERIALIZED (
       SELECT evidence.*,dictionary.asset,state.asset_longname,
              signal.holders,signal.supply
         FROM asset_emergence evidence
         JOIN asset_dictionary dictionary ON dictionary.asset_id=evidence.asset_id
         JOIN assets state ON state.asset_id=evidence.asset_id
         JOIN asset_signals signal ON signal.asset_id=evidence.asset_id
        WHERE evidence.finalized=1 AND evidence.trades>0
          AND evidence.issued_at<=?1-${30 * DAY}
          AND evidence.issued_at>?1-${90 * DAY}
          AND signal.low_quality=0 AND signal.supply>0
     ), ranked AS (
       SELECT eligible.*,
              PERCENT_RANK() OVER (ORDER BY buyers) buyer_rank,
              PERCENT_RANK() OVER (ORDER BY active_days) active_day_rank
         FROM eligible
     )
     SELECT asset,asset_longname,issued_at,observation_cutoff,updated_at evidence_updated_at,
            CAST((?1-issued_at)/${DAY} AS INTEGER) age_days,
            ROUND(50.0*buyer_rank+50.0*active_day_rank,2) market_formation,
            trades,buyers,sellers,active_days,late_buyers,late_active_days,
            ROUND(market_span_days,1) market_span_days,venues,holders,
            CAST(ROUND(supply) AS INTEGER) supply
       FROM ranked
      ORDER BY market_formation DESC,buyers DESC,active_days DESC,issued_at ASC,asset ASC
      LIMIT ?2`,
    now,
    limit,
  );
}
