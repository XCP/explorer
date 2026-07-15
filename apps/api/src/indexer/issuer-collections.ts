/**
 * Collections defined by ISSUER — every asset a given address minted is one collection — rather than a
 * curated card list (that's tokenscan-collections.ts / crawlCollections). Rebuildable: drop source='issuer'
 * and re-derive from ISSUER_COLLECTIONS by querying the assets table. Meta carries {collection, site} exactly
 * like the other collection sources, so it flows through assetCollection() → the asset page's green band and
 * the /collections + /tag pages with no special-casing. buildTags' computed rebuild leaves source='issuer'
 * intact (it only touches source='computed').
 */
import type { Env } from "#api/env";

interface IssuerCollection {
  issuer: string;
  tag: string;
  name: string;
  site?: string;
}

export const ISSUER_COLLECTIONS: readonly IssuerCollection[] = [
  {
    issuer: "bc1qv9zuv6ycly3gvnt2qrrw7ve9f3vlyjapmefrym",
    tag: "corruptionaires",
    name: "Corruptionaires",
    site: "https://corruptionaires.neocities.org/",
  },
  {
    issuer: "1DPPDehtoLLjhXKHibfC3iJVSqwCooivUX",
    tag: "new-liberty-standard",
    name: "New Liberty Standard",
    site: "https://newlibertystandard.io/",
  },
  {
    issuer: "1ChvF5WNhVMg6heJdruRXgs6bUwQAaVWzL",
    tag: "based-intellectuals",
    name: "Based Intellectuals",
  },
];

export function issuerCollection(issuer: unknown): IssuerCollection | null {
  if (typeof issuer !== "string") return null;
  return ISSUER_COLLECTIONS.find((collection) => collection.issuer === issuer) ?? null;
}

export function issuerCollectionMeta(collection: IssuerCollection): string {
  return JSON.stringify({
    collection: collection.name,
    ...(collection.site ? { site: collection.site } : {}),
  });
}

export async function buildIssuerCollections(env: Env): Promise<Record<string, unknown>> {
  // Upsert + per-tag reconcile (no blanket wipe): add current members, then drop only tags for assets that
  // no longer belong to the issuer. The tag set is never emptied mid-run.
  let tagged = 0;
  for (const c of ISSUER_COLLECTIONS) {
    const meta = issuerCollectionMeta(c);
    await env.CORE_DB.prepare(
      `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
       SELECT 'asset',asset.asset FROM assets state
       JOIN asset_dictionary asset ON asset.asset_id=state.asset_id
       JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
       WHERE issuer.address=?`,
    )
      .bind(c.issuer)
      .run();
    const res = await env.CORE_DB.prepare(
      `INSERT INTO tags(entity_id,tag,source,meta)
       SELECT entity.entity_id,?,'issuer',? FROM assets state
       JOIN asset_dictionary asset ON asset.asset_id=state.asset_id
       JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
       JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=asset.asset
       WHERE issuer.address=?
       ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
    )
      .bind(c.tag, meta, c.issuer)
      .run();
    tagged += res?.meta?.rows_written ?? 0;
    // reconcile removals (e.g. an asset transferred away) — scoped to this issuer's assets, so never a full wipe.
    await env.CORE_DB.prepare(
      `DELETE FROM tags AS tag WHERE tag.source='issuer' AND tag.tag=? AND NOT EXISTS (
         SELECT 1 FROM entity_dictionary entity
         JOIN asset_dictionary asset ON asset.asset=entity.entity_key
         JOIN assets state ON state.asset_id=asset.asset_id
         JOIN address_dictionary issuer ON issuer.address_id=state.issuer_id
         WHERE entity.entity_id=tag.entity_id AND entity.entity_type='asset' AND issuer.address=?
       )`,
    )
      .bind(c.tag, c.issuer)
      .run();
  }
  return { collections: ISSUER_COLLECTIONS.length, tagged };
}
