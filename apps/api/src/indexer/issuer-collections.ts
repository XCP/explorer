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
    const res = await env.DB.prepare(
      `INSERT INTO tags (entity_type,entity_id,tag,source,meta)
       SELECT 'asset', asset, ?, 'issuer', ? FROM assets WHERE issuer=?
       ON CONFLICT(entity_type,entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
    )
      .bind(c.tag, meta, c.issuer)
      .run();
    tagged += res?.meta?.rows_written ?? 0;
    const compactReady = await env.CORE_DB.prepare(
      `SELECT count(*) ready FROM core_state WHERE key IN ('build_complete','import_complete') AND value='1'`,
    ).first<{ ready: number }>();
    if (Number(compactReady?.ready ?? 0) === 2) {
      const assets = await env.DB.prepare(`SELECT asset FROM assets WHERE issuer=? ORDER BY asset`)
        .bind(c.issuer)
        .all<{ asset: string }>();
      for (let index = 0; index < assets.results.length; index += 80) {
        const page = assets.results.slice(index, index + 80);
        await env.CORE_DB.batch(
          page.map((row) =>
            env.CORE_DB.prepare(
              `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key) VALUES('asset',?)`,
            ).bind(row.asset),
          ),
        );
        await env.CORE_DB.batch(
          page.map((row) =>
            env.CORE_DB.prepare(
              `INSERT INTO tags(entity_id,tag,source,meta)
               SELECT entity_id,?,'issuer',? FROM entity_dictionary
                WHERE entity_type='asset' AND entity_key=?
               ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
            ).bind(c.tag, meta, row.asset),
          ),
        );
      }
    }
    // reconcile removals (e.g. an asset transferred away) — scoped to this issuer's assets, so never a full wipe.
    await env.DB.prepare(
      `DELETE FROM tags WHERE source='issuer' AND tag=? AND entity_id NOT IN (SELECT asset FROM assets WHERE issuer=?)`,
    )
      .bind(c.tag, c.issuer)
      .run();
  }
  return { collections: ISSUER_COLLECTIONS.length, tagged };
}
