import type { EmergingAsset, FreshAsset } from "@xcp/shared/radar";
import { q } from "#api/db";
import { assetRankingEligibleSql } from "#api/reputation/eligibility";

const DAY = 86_400;
const ELIGIBLE = assetRankingEligibleSql("signal");

type EmergingRow = Omit<EmergingAsset, "reason">;
type FreshRow = Omit<FreshAsset, "reason">;

const EVIDENCE_COLUMNS = `asset,asset_longname,issued_at,observation_cutoff,updated_at evidence_updated_at,
  CAST((?1-issued_at)/${DAY} AS INTEGER) age_days,trades,buyers,sellers,active_days,late_buyers,
  late_active_days,ROUND(market_span_days,1) market_span_days,venues,fairmints,minters,paid_minters,
  mint_active_days,late_minters,holders,CAST(ROUND(supply) AS INTEGER) supply,ROUND(top1_pct,1) top1_pct`;

export function listFreshAssets(db: D1Database, now: number, limit = 40): Promise<FreshRow[]> {
  return q<FreshRow>(
    db,
    `WITH eligible AS MATERIALIZED (
       SELECT evidence.*,dictionary.asset,state.asset_longname,
              signal.holders,signal.supply,signal.top1_pct
         FROM asset_emergence evidence
         JOIN asset_dictionary dictionary ON dictionary.asset_id=evidence.asset_id
         JOIN assets state ON state.asset_id=evidence.asset_id
         JOIN asset_signals signal ON signal.asset_id=evidence.asset_id
        WHERE evidence.finalized=0 AND evidence.issued_at<=?1-${7 * DAY}
          AND evidence.issued_at>?1-${30 * DAY} AND ${ELIGIBLE} AND signal.supply>0
     )
     SELECT ${EVIDENCE_COLUMNS} FROM eligible
      ORDER BY issued_at DESC,asset ASC LIMIT ?2`,
    now,
    limit,
  );
}

/** Ranked day-30 evidence for assets that have not yet reached day 90. */
export function listEmergingAssets(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
  limit = 40,
): Promise<EmergingRow[]> {
  return q<EmergingRow>(
    db,
    `WITH eligible AS MATERIALIZED (
       SELECT evidence.*,dictionary.asset,state.asset_longname,
              signal.holders,signal.supply,signal.top1_pct
         FROM asset_emergence evidence
         JOIN asset_dictionary dictionary ON dictionary.asset_id=evidence.asset_id
         JOIN assets state ON state.asset_id=evidence.asset_id
         JOIN asset_signals signal ON signal.asset_id=evidence.asset_id
        WHERE evidence.finalized=1 AND evidence.trades>0
          AND evidence.issued_at<=?1-${30 * DAY}
          AND evidence.issued_at>?1-${90 * DAY}
          AND ${ELIGIBLE} AND signal.supply>0
     ), ranked AS (
       SELECT eligible.*,
              PERCENT_RANK() OVER (ORDER BY buyers) buyer_rank,
              PERCENT_RANK() OVER (ORDER BY active_days) active_day_rank
         FROM eligible
     )
     SELECT ${EVIDENCE_COLUMNS},
            ROUND(50.0*buyer_rank+50.0*active_day_rank,2) market_formation
       FROM ranked
      ORDER BY market_formation DESC,buyers DESC,active_days DESC,issued_at ASC,asset ASC
      LIMIT ?2`,
    now,
    limit,
  );
}
