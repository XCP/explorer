/**
 * collection_creators — who created the cards in each curated collection.
 *
 * Membership is per asset (tags / collection_membership_evidence); nothing persisted said which ADDRESSES
 * a collection's cards came from, so a caller asking "did this address create a Rare Pepe" had to walk a
 * collection's members or an address's issued list per question. This projects the answer once: for every
 * member asset, the source of its first valid issuance — the creator, whoever holds issuance rights today —
 * counted per (creator, collection).
 *
 * Rebuilt after every collections crawl. Both statements derive the same fresh set inside D1; the upsert
 * is delta-guarded so an unchanged row is never rewritten, and the prune removes only rows the fresh set
 * no longer contains. About five thousand rows across ~75 collections.
 */

const SOURCES = "'manual','issuer','discovered','collection','digirare','tokenscan'";

const FRESH = `WITH member AS (
  SELECT DISTINCT tag.tag,asset.asset_id
  FROM tags tag
  JOIN entity_dictionary entity ON entity.entity_id=tag.entity_id AND entity.entity_type='asset'
  JOIN asset_dictionary asset ON asset.asset=entity.entity_key
  WHERE tag.source IN (${SOURCES})
), first AS (
  SELECT issuance.asset_id,MIN(issuance.event_index) event_index
  FROM issuances issuance
  WHERE issuance.status='valid' AND issuance.asset_id IN (SELECT asset_id FROM member)
  GROUP BY issuance.asset_id
), creator AS (
  SELECT issuance.source_id address_id,member.tag,COUNT(*) cards
  FROM member
  JOIN first ON first.asset_id=member.asset_id
  JOIN issuances issuance ON issuance.event_index=first.event_index
  WHERE issuance.source_id IS NOT NULL
  GROUP BY issuance.source_id,member.tag
)`;

const UPSERT = `${FRESH}
INSERT INTO collection_creators(address_id,tag,cards)
SELECT address_id,tag,cards FROM creator WHERE true
ON CONFLICT(address_id,tag) DO UPDATE SET cards=excluded.cards
WHERE collection_creators.cards IS NOT excluded.cards`;

const PRUNE = `${FRESH}
DELETE FROM collection_creators
WHERE NOT EXISTS (
  SELECT 1 FROM creator
  WHERE creator.address_id=collection_creators.address_id AND creator.tag=collection_creators.tag
)`;

export async function rebuildCollectionCreators(db: D1Database): Promise<{ written: number; removed: number }> {
  const upsert = await db.prepare(UPSERT).run();
  const prune = await db.prepare(PRUNE).run();
  return { written: upsert.meta.rows_written ?? 0, removed: prune.meta.rows_written ?? 0 };
}
