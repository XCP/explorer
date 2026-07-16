#!/usr/bin/env node

/** Current-state provenance and robust collection-profile audit. No writes; JSON to stdout. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

export const COLLECTION_SOURCES = ["manual", "issuer", "discovered", "collection", "digirare", "tokenscan"];
const sources = COLLECTION_SOURCES.map((source) => `'${source}'`).join(",");

export const TAG_SOURCE_CENSUS_SQL = `SELECT source,COUNT(*) rows,COUNT(DISTINCT tag) tags,
  SUM(meta IS NOT NULL) with_meta,SUM(value IS NOT NULL) with_value,COUNT(DISTINCT entity_id) entities
FROM tags GROUP BY source ORDER BY rows DESC`;

export const COLLECTION_SOURCE_OVERLAP_SQL = `SELECT tag,COUNT(DISTINCT source) sources,
  COUNT(DISTINCT entity_id) members,COUNT(*) evidence_rows,
  GROUP_CONCAT(DISTINCT source) source_list
FROM collection_membership_evidence WHERE source IN (${sources}) GROUP BY tag HAVING COUNT(DISTINCT source)>1
ORDER BY members DESC,tag`;

export const COLLECTION_PROFILE_SQL = `WITH member AS (
  SELECT evidence.tag,evidence.entity_id,COUNT(*) sources,state.issuer_id,
    COALESCE(signal.holders,0) holders,
    COALESCE(signal.trades,0)+COALESCE(signal.dispenses,0) market_events,
    COALESCE(signal.max_realized_usd,0) max_realized_usd
  FROM collection_membership_evidence evidence
  JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id AND entity.entity_type='asset'
  LEFT JOIN asset_dictionary asset ON asset.asset=entity.entity_key
  LEFT JOIN assets state ON state.asset_id=asset.asset_id
  LEFT JOIN asset_signals signal ON signal.asset_id=asset.asset_id
  WHERE evidence.source IN (${sources})
  GROUP BY evidence.tag,evidence.entity_id
), ranked AS (
  SELECT member.*,
    ROW_NUMBER() OVER(PARTITION BY tag ORDER BY holders) holder_rank,
    ROW_NUMBER() OVER(PARTITION BY tag ORDER BY market_events) event_rank,
    COUNT(*) OVER(PARTITION BY tag) n
  FROM member
), base AS (
  SELECT tag,COUNT(*) members,MAX(sources) max_sources_per_member,COUNT(DISTINCT issuer_id) issuers,
    SUM(market_events>0) market_assets,SUM(holders>0) held_assets,SUM(market_events) market_events,
    SUM(max_realized_usd) realized_peak_sum,MAX(market_events) max_asset_events,
    MAX(max_realized_usd) max_asset_value
  FROM member GROUP BY tag HAVING COUNT(*)>=5
)
SELECT base.tag,base.members,base.max_sources_per_member,base.issuers,base.market_assets,
  ROUND(100.0*base.market_assets/base.members,1) market_pct,base.held_assets,
  ROUND(100.0*base.held_assets/base.members,1) held_pct,
  ROUND(AVG(CASE WHEN ranked.holder_rank IN ((ranked.n+1)/2,(ranked.n/2)+1)
    THEN ranked.holders END),1) median_holders,
  ROUND(AVG(CASE WHEN ranked.event_rank IN ((ranked.n+1)/2,(ranked.n/2)+1)
    THEN ranked.market_events END),1) median_events,
  ROUND(100.0*base.max_asset_events/NULLIF(base.market_events,0),1) top_asset_event_pct,
  ROUND(100.0*base.max_asset_value/NULLIF(base.realized_peak_sum,0),1) top_asset_value_pct
FROM base JOIN ranked ON ranked.tag=base.tag GROUP BY base.tag
ORDER BY market_pct DESC,median_events DESC,base.members DESC,base.tag`;

export function buildTagCollectionAudit(census, overlaps, profiles, metas = []) {
  return {
    schema: "xcp-tag-collection-audit/1",
    generated_at: new Date().toISOString(),
    methodology: {
      collection_sources: COLLECTION_SOURCES,
      membership: "canonical union by entity/tag with independent source evidence retained",
      profile: "current descriptive medians, breadth, and single-asset concentration; not a quality grade",
      minimum_members: 5,
    },
    d1: {
      rows_read: metas.reduce((sum, meta) => sum + Number(meta.rows_read ?? 0), 0),
      sql_duration_ms: metas.reduce((sum, meta) => sum + Number(meta.timings?.sql_duration_ms ?? 0), 0),
    },
    tag_sources: census,
    multi_source_collections: overlaps,
    collection_profiles: profiles,
  };
}

function run() {
  const census = executeRemoteD1(TAG_SOURCE_CENSUS_SQL);
  const overlaps = executeRemoteD1(COLLECTION_SOURCE_OVERLAP_SQL);
  const profiles = executeRemoteD1(COLLECTION_PROFILE_SQL);
  process.stdout.write(
    `${JSON.stringify(
      buildTagCollectionAudit(census.rows, overlaps.rows, profiles.rows, [census.meta, overlaps.meta, profiles.meta]),
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) run();
