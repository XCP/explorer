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

const ISSUER_COLLECTIONS: IssuerCollection[] = [
  {
    issuer: "1DPPDehtoLLjhXKHibfC3iJVSqwCooivUX",
    tag: "new-liberty-standard",
    name: "New Liberty Standard",
    site: "https://newlibertystandard.io/",
  },
];

export async function buildIssuerCollections(env: Env): Promise<Record<string, unknown>> {
  // Upsert + per-tag reconcile (no blanket wipe): add current members, then drop only tags for assets that
  // no longer belong to the issuer. The tag set is never emptied mid-run.
  let tagged = 0;
  for (const c of ISSUER_COLLECTIONS) {
    const meta = JSON.stringify({ collection: c.name, ...(c.site ? { site: c.site } : {}) });
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source,meta)
       SELECT 'asset', asset, ?, 'issuer', ? FROM assets WHERE issuer=?`,
    )
      .bind(c.tag, meta, c.issuer)
      .run();
    tagged += res?.meta?.rows_written ?? 0;
    // reconcile removals (e.g. an asset transferred away) — scoped to this issuer's assets, so never a full wipe.
    await env.DB.prepare(
      `DELETE FROM tags WHERE source='issuer' AND tag=? AND entity_id NOT IN (SELECT asset FROM assets WHERE issuer=?)`,
    )
      .bind(c.tag, c.issuer)
      .run();
  }
  return { collections: ISSUER_COLLECTIONS.length, tagged };
}
