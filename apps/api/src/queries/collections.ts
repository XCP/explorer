import type { CollectionProfile } from "@xcp/shared/collections";
import { q } from "#api/db";

const SOURCES = "'manual','issuer','discovered','collection','digirare','tokenscan'";

/** Robust descriptive profiles over canonical membership unions. No composite collection grade. */
export function listCollectionProfiles(db: D1Database): Promise<CollectionProfile[]> {
  return q<CollectionProfile>(
    db,
    `WITH member AS MATERIALIZED (
       SELECT evidence.tag,evidence.entity_id,COUNT(DISTINCT evidence.source) sources,state.issuer_id,
         COALESCE(signal.holders,0) holders,
         COALESCE(signal.trades,0)+COALESCE(signal.dispenses,0) market_events,
         COALESCE(signal.max_realized_usd,0) max_realized_usd
       FROM collection_membership_evidence evidence
       JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id AND entity.entity_type='asset'
       LEFT JOIN asset_dictionary asset ON asset.asset=entity.entity_key
       LEFT JOIN assets state ON state.asset_id=asset.asset_id
       LEFT JOIN asset_signals signal ON signal.asset_id=asset.asset_id
       WHERE evidence.source IN (${SOURCES})
       GROUP BY evidence.tag,evidence.entity_id
     ), ranked AS (
       SELECT member.*,
         ROW_NUMBER() OVER(PARTITION BY tag ORDER BY holders) holder_rank,
         ROW_NUMBER() OVER(PARTITION BY tag ORDER BY market_events) event_rank,
         COUNT(*) OVER(PARTITION BY tag) n
       FROM member
     ), base AS (
       SELECT tag,COUNT(*) members,COUNT(DISTINCT issuer_id) issuers,
         SUM(market_events>0) market_assets,SUM(holders>0) held_assets,
         SUM(market_events) market_events,SUM(max_realized_usd) total_realized_usd,
         SUM(holders) total_holders,MAX(market_events) max_asset_events,MAX(max_realized_usd) max_asset_value
       FROM member GROUP BY tag HAVING COUNT(*)>=3
     ), evidence AS (
       SELECT tag,COUNT(DISTINCT source) sources,GROUP_CONCAT(DISTINCT source) source_list
       FROM collection_membership_evidence WHERE source IN (${SOURCES}) GROUP BY tag
     ), metadata AS (
       SELECT tag,MIN(CASE WHEN json_valid(meta) THEN meta END) meta
       FROM tags WHERE source IN (${SOURCES}) GROUP BY tag
     )
     SELECT base.tag,
       COALESCE(json_extract(metadata.meta,'$.collection'),base.tag) name,
       json_extract(metadata.meta,'$.site') site,evidence.sources,evidence.source_list,
       base.members,base.issuers,base.market_assets,ROUND(100.0*base.market_assets/base.members,1) market_pct,
       base.held_assets,ROUND(100.0*base.held_assets/base.members,1) held_pct,
       ROUND(AVG(CASE WHEN ranked.holder_rank IN ((ranked.n+1)/2,(ranked.n/2)+1)
         THEN ranked.holders END),1) median_holders,
       ROUND(AVG(CASE WHEN ranked.event_rank IN ((ranked.n+1)/2,(ranked.n/2)+1)
         THEN ranked.market_events END),1) median_events,
       ROUND(base.total_realized_usd,2) total_realized_usd,base.total_holders,
       ROUND(100.0*base.max_asset_events/NULLIF(base.market_events,0),1) top_asset_event_pct,
       ROUND(100.0*base.max_asset_value/NULLIF(base.total_realized_usd,0),1) top_asset_value_pct
     FROM base JOIN ranked ON ranked.tag=base.tag JOIN evidence ON evidence.tag=base.tag
     LEFT JOIN metadata ON metadata.tag=base.tag
     GROUP BY base.tag ORDER BY market_pct DESC,median_events DESC,base.members DESC,base.tag`,
  );
}
