import type { Env } from "#api/env";

export const COLLECTION_MEMBERSHIP_SOURCES = [
  "manual",
  "issuer",
  "discovered",
  "collection",
  "digirare",
  "tokenscan",
] as const;

export type CollectionMembershipSource = (typeof COLLECTION_MEMBERSHIP_SOURCES)[number];

export const COLLECTION_EVIDENCE_UPSERT_SQL = `INSERT INTO collection_membership_evidence
  (entity_id,tag,source,value,meta,observed_at)
  SELECT entity_id,?2,?3,?4,?5,unixepoch() FROM entity_dictionary
  WHERE entity_type='asset' AND entity_key=?1
  ON CONFLICT(entity_id,tag,source) DO UPDATE SET
    value=excluded.value,meta=excluded.meta,observed_at=excluded.observed_at`;

export function collectionMembershipPrioritySql(sourceColumn: string): string {
  return `CASE ${sourceColumn}
  WHEN 'manual' THEN 1
  WHEN 'issuer' THEN 2
  WHEN 'discovered' THEN 3
  WHEN 'collection' THEN 4
  WHEN 'digirare' THEN 5
  WHEN 'tokenscan' THEN 6
  ELSE 99 END`;
}

/** Rebuild one canonical tag from its source-scoped evidence. */
export async function projectCollectionMembership(env: Env, tag: string): Promise<void> {
  await env.CORE_DB.prepare(
    `INSERT INTO tags(entity_id,tag,source,value,meta)
     SELECT entity_id,tag,source,value,meta FROM (
       SELECT evidence.*,
         ROW_NUMBER() OVER (PARTITION BY evidence.entity_id,evidence.tag
           ORDER BY ${collectionMembershipPrioritySql("evidence.source")}, evidence.source) AS priority
       FROM collection_membership_evidence evidence WHERE evidence.tag=?
     ) WHERE priority=1
     ON CONFLICT(entity_id,tag) DO UPDATE SET
       source=excluded.source,value=excluded.value,meta=excluded.meta`,
  )
    .bind(tag)
    .run();

  await env.CORE_DB.prepare(
    `DELETE FROM tags AS projection
     WHERE projection.tag=?
       AND projection.source IN ('manual','issuer','discovered','collection','digirare','tokenscan')
       AND NOT EXISTS (
         SELECT 1 FROM collection_membership_evidence evidence
         WHERE evidence.entity_id=projection.entity_id AND evidence.tag=projection.tag
       )`,
  )
    .bind(tag)
    .run();
}

export async function projectCollectionMembershipTags(env: Env, tags: Iterable<string>): Promise<void> {
  for (const tag of new Set(tags)) await projectCollectionMembership(env, tag);
}
