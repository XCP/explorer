/**
 * Collection-candidate discovery — the SQL behind GET /v2/collections/candidates. Surfaces issuers with a
 * CLUSTER of media assets that aren't in any collection yet, held by real, sophisticated collectors: de-facto
 * projects we simply haven't tagged. Ranked by a composite of holder sophistication × cluster size ×
 * creator-heaviness. Deliberately keeps never-traded clusters (art that was minted but never sold) — those
 * are exactly the overlooked projects the tagged sources miss.
 */
import type { CollectionCandidate } from "@xcp/shared/collections";
import { q } from "#api/db";

// The query row = the wire shape, but samples arrive as one GROUP_CONCAT string (split in the handler).
export type CandidateRow = Omit<CollectionCandidate, "samples"> & { samples: string | null };

// An asset is a candidate only if it has media AND isn't already accounted for by a collection source or a
// protocol family (stamps/src20 carry their own layer and would swamp the art signal).
export function collectionCandidates(
  db: D1Database,
  minAssets = 6,
  minHolders = 4,
  limit = 60,
): Promise<CandidateRow[]> {
  return q<CandidateRow>(
    db,
    `WITH excluded_entities AS MATERIALIZED (
       SELECT entity_id FROM tags WHERE source IN ('collection','tokenscan','digirare','discovered')
       UNION
       SELECT entity_id FROM tags WHERE tag IN ('stamp','src20','src721')
     ), excluded AS MATERIALIZED (
       SELECT dictionary.asset_id
         FROM excluded_entities excluded_entity
         JOIN entity_dictionary entity ON entity.entity_id=excluded_entity.entity_id
         JOIN asset_dictionary dictionary ON dictionary.asset=entity.entity_key
        WHERE entity.entity_type='asset'
     ), cand AS (
       SELECT issuer.address issuer,asset.asset,s.holders h,s.pct_creator_holders cpct,s.avg_holder_dex hdex,
              COALESCE(s.max_realized_usd,0) usd,
              ROW_NUMBER() OVER (PARTITION BY state.issuer_id ORDER BY s.holders DESC) rn
         FROM assets state JOIN asset_signals s ON s.asset_id=state.asset_id
         JOIN asset_dictionary asset ON asset.asset_id=state.asset_id
         JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
        WHERE state.mime_type IS NOT NULL AND state.asset_id NOT IN (SELECT asset_id FROM excluded)
     )
     SELECT issuer, COUNT(*) assets, ROUND(AVG(h),1) avg_holders, ROUND(AVG(hdex)) holder_dex,
            ROUND(AVG(cpct)) creator_pct, ROUND(SUM(usd)) realized_usd,
            ROUND(LN(1+AVG(hdex)) * LN(1+COUNT(*)) * (1 + AVG(cpct)/100.0), 1) score,
            GROUP_CONCAT(CASE WHEN rn<=6 THEN asset END) samples
       FROM cand
      GROUP BY issuer
     HAVING COUNT(*) >= ${minAssets} AND AVG(h) >= ${minHolders}
      ORDER BY score DESC LIMIT ${limit}`,
  );
}
