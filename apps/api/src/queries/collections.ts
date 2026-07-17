import type { CollectionProfile } from "@xcp/shared/collections";
import { one, q } from "#api/db";

const SOURCES = "'manual','issuer','discovered','collection','digirare','tokenscan'";

const profileSql = (scoped: boolean) => `WITH member AS MATERIALIZED (
  SELECT evidence.tag,evidence.entity_id,asset.asset_id,state.issuer_id,
    rating.rating,COALESCE(signal.low_quality,0) low_quality,
    COALESCE(signal.clean_active_trade_months,0) active_months,
    COALESCE(signal.distinct_paid_buyers,0) paid_buyers,
    COALESCE(signal.clean_realized_usd,0) realized_usd
  FROM collection_membership_evidence evidence
  JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id AND entity.entity_type='asset'
  LEFT JOIN asset_dictionary asset ON asset.asset=entity.entity_key
  LEFT JOIN assets state ON state.asset_id=asset.asset_id
  LEFT JOIN asset_signals signal ON signal.asset_id=asset.asset_id
  LEFT JOIN asset_ratings rating ON rating.asset_id=asset.asset_id
  WHERE evidence.source IN (${SOURCES}) ${scoped ? "AND evidence.tag=?" : ""}
  GROUP BY evidence.tag,evidence.entity_id
), rated_ranked AS (
  SELECT tag,rating,ROW_NUMBER() OVER(PARTITION BY tag ORDER BY rating) rating_rank,
    COUNT(*) OVER(PARTITION BY tag) rated_count
  FROM member WHERE rating IS NOT NULL
), rating_median AS (
  SELECT tag,ROUND(AVG(CASE WHEN rating_rank IN ((rated_count+1)/2,(rated_count/2)+1)
    THEN rating END),1) median_rating
  FROM rated_ranked GROUP BY tag
), base AS (
  SELECT tag,COUNT(*) members,COUNT(DISTINCT issuer_id) issuers,
    SUM(rating IS NOT NULL) rated_members,
    SUM(CASE WHEN rating>=9 THEN 1 ELSE 0 END) rating_exceptional,
    SUM(CASE WHEN rating>=7 AND rating<9 THEN 1 ELSE 0 END) rating_strong,
    SUM(CASE WHEN rating>=4 AND rating<7 THEN 1 ELSE 0 END) rating_developing,
    SUM(CASE WHEN rating<4 THEN 1 ELSE 0 END) rating_limited,
    SUM(active_months>0) market_assets,SUM(active_months) total_active_months,
    SUM(paid_buyers) total_paid_buyers,SUM(realized_usd) total_realized_usd,
    MAX(realized_usd) top_asset_value,SUM(low_quality=1) integrity_assets
  FROM member GROUP BY tag HAVING COUNT(*)>=3
), holder AS (
  SELECT member.tag,COUNT(*) holder_relationships,COUNT(DISTINCT balance.address_id) unique_holders
  FROM member JOIN balances balance ON balance.asset_id=member.asset_id
  WHERE balance.address_id IS NOT NULL AND CAST(balance.quantity AS INTEGER)>0 GROUP BY member.tag
), evidence AS (
  SELECT tag,COUNT(DISTINCT source) sources,GROUP_CONCAT(DISTINCT source) source_list
  FROM collection_membership_evidence WHERE source IN (${SOURCES}) ${scoped ? "AND tag=?" : ""} GROUP BY tag
), metadata AS (
  SELECT tag,MIN(CASE WHEN json_valid(meta) THEN meta END) meta
  FROM tags WHERE source IN (${SOURCES}) ${scoped ? "AND tag=?" : ""} GROUP BY tag
)
SELECT base.tag,COALESCE(json_extract(metadata.meta,'$.collection'),base.tag) name,
  json_extract(metadata.meta,'$.site') site,evidence.sources,evidence.source_list,
  base.members,base.issuers,base.rated_members,ROUND(100.0*base.rated_members/base.members,1) rated_pct,
  rating_median.median_rating,base.rating_exceptional,base.rating_strong,
  base.rating_developing,base.rating_limited,
  base.market_assets,ROUND(100.0*base.market_assets/base.members,1) market_pct,
  base.total_active_months,base.total_paid_buyers,ROUND(base.total_realized_usd,2) total_realized_usd,
  COALESCE(holder.holder_relationships,0) holder_relationships,COALESCE(holder.unique_holders,0) unique_holders,
  ROUND(100.0*(holder.holder_relationships-holder.unique_holders)/NULLIF(holder.holder_relationships,0),1)
    holder_overlap_pct,
  ROUND(100.0*base.top_asset_value/NULLIF(base.total_realized_usd,0),1) top_asset_value_pct,
  base.integrity_assets,ROUND(100.0*base.integrity_assets/base.members,1) integrity_pct
FROM base JOIN evidence USING(tag) LEFT JOIN metadata USING(tag)
LEFT JOIN rating_median USING(tag) LEFT JOIN holder USING(tag)`;

/** Independent observed collection axes. No composite grade or collection rank. */
export function listCollectionProfiles(db: D1Database): Promise<CollectionProfile[]> {
  return q<CollectionProfile>(
    db,
    `${profileSql(false)} ORDER BY rated_pct DESC,median_rating DESC,members DESC,tag`,
  );
}

export function getCollectionProfile(db: D1Database, tag: string): Promise<CollectionProfile | null> {
  return one<CollectionProfile>(db, profileSql(true), tag, tag, tag);
}
