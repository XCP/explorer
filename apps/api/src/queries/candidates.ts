/**
 * Collection-candidate discovery — the SQL behind GET /v2/collections/candidates. Surfaces issuers with a
 * CLUSTER of media assets that aren't in any collection yet, held by real, sophisticated collectors: de-facto
 * projects we simply haven't tagged. Ranked by a composite of holder sophistication × cluster size ×
 * creator-heaviness. Deliberately keeps never-traded clusters (art that was minted but never sold) — those
 * are exactly the overlooked projects the tagged sources miss.
 */
import type { CollectionCandidate } from "@xcp/shared/collections";
import { q } from "../db";

// The query row = the wire shape, but samples arrive as one GROUP_CONCAT string (split in the handler).
export type CandidateRow = Omit<CollectionCandidate, "samples"> & { samples: string | null };

// An asset is a candidate only if it has media AND isn't already accounted for by a collection source or a
// protocol family (stamps/src20 carry their own layer and would swamp the art signal).
const UNCOLLECTED = `a.asset NOT IN (SELECT entity_id FROM tags WHERE entity_type='asset' AND source IN ('collection','tokenscan','digirare','discovered'))
   AND a.asset NOT IN (SELECT entity_id FROM tags WHERE entity_type='asset' AND tag IN ('stamp','src20','src721'))`;

export function collectionCandidates(db: D1Database, minAssets = 6, minHolders = 4, limit = 60): Promise<CandidateRow[]> {
  return q<CandidateRow>(
    db,
    `WITH cand AS (
       SELECT a.issuer, a.asset, s.holders h, s.pct_creator_holders cpct, s.avg_holder_dex hdex,
              COALESCE(s.max_realized_usd,0) usd,
              ROW_NUMBER() OVER (PARTITION BY a.issuer ORDER BY s.holders DESC) rn
         FROM assets a JOIN asset_signals s ON s.asset=a.asset
        WHERE a.mime_type IS NOT NULL AND a.issuer IS NOT NULL AND ${UNCOLLECTED}
     )
     SELECT issuer, COUNT(*) assets, ROUND(AVG(h),1) avg_holders, ROUND(AVG(hdex)) holder_dex,
            ROUND(AVG(cpct)) creator_pct, ROUND(SUM(usd)) realized_usd,
            ROUND(LN(1+AVG(hdex)) * LN(1+COUNT(*)) * (1 + AVG(cpct)/100.0), 1) score,
            GROUP_CONCAT(CASE WHEN rn<=6 THEN asset END) samples
       FROM cand
      GROUP BY issuer
     HAVING COUNT(*) >= ${minAssets} AND AVG(h) >= ${minHolders}
      ORDER BY score DESC LIMIT ${limit}`
  );
}
