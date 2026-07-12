/**
 * Tokenscan collection directory → collection-membership tags. tokenscan.io ships a static JS array
 * (`/js/nfts.js`: `NFT_DATA = [{ name, site, cards: ["ASSET.ext", …] }, …]`) that powers its "official card
 * in the X project" banners — a hand-curated directory of ~60 Counterparty art/collectible projects, each
 * with a project site. Broader than our pepe.wtf feed (Age of Chains, Rare Pigeons, Bitgirls, …), so we fold
 * it in as its OWN tag source, carrying the project name + site in the tag's meta JSON (migration 0037).
 *
 * Written as tags with source='tokenscan' (buildTags' computed rebuild leaves non-computed sources intact),
 * refreshed on the cron. Transient-safe: a failed/empty fetch leaves the existing tokenscan tags untouched.
 */
import type { Env } from "#api/env";
import { fetchTokenscanDirectory, type TokenscanCollection } from "#api/integrations/tokenscan-directory";
import { canonicalCollection, EXCLUDED_COLLECTIONS } from "#api/indexer/collections";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const assetOf = (card: string) => card.replace(/\.[^.]+$/, "").trim(); // "RAREPIGEON.png" -> "RAREPIGEON"
export const TOKENSCAN_TAG_UPSERT_SQL = `INSERT INTO tags (entity_type,entity_id,tag,source,meta)
  VALUES ('asset',?,?,'tokenscan',?)
  ON CONFLICT(entity_type,entity_id,tag) DO UPDATE SET
    meta=CASE WHEN tags.source='tokenscan' THEN excluded.meta ELSE tags.meta END`;

async function fetchNftData(): Promise<TokenscanCollection[]> {
  return fetchTokenscanDirectory();
}

/** Refresh the tokenscan collection tags (asset → project, with {collection, site} meta). */
export async function crawlTokenscanCollections(env: Env): Promise<Record<string, unknown>> {
  let data: TokenscanCollection[];
  try {
    data = await fetchNftData();
  } catch (e) {
    return { skipped: `fetch:${String(e).slice(0, 60)}` };
  }
  if (!data.length) return { skipped: "empty(kept prior)" }; // transient-safe: never wipe on a blip

  const prior = await env.DB.prepare(`SELECT entity_id,tag FROM tags WHERE source='tokenscan'`).all<{
    entity_id: string;
    tag: string;
  }>();
  const fresh = new Set<string>();
  const upserts: D1PreparedStatement[] = [];
  let collections = 0,
    tagged = 0;
  for (const c of data) {
    if (!c.name || !c.cards?.length) continue;
    const tag = canonicalCollection(slugify(c.name)); // collapse known dupes onto the pepe.wtf/canonical slug
    if (!tag || EXCLUDED_COLLECTIONS.has(tag)) continue; // owner-removed collections stay removed
    const meta = JSON.stringify({ collection: c.name, ...(c.site ? { site: c.site } : {}) });
    const assets = [...new Set(c.cards.map(assetOf).filter(Boolean))];
    for (const asset of assets) {
      fresh.add(`${tag}\0${asset}`);
      upserts.push(env.DB.prepare(TOKENSCAN_TAG_UPSERT_SQL).bind(asset, tag, meta));
    }
    collections++;
    tagged += assets.length;
  }
  for (let i = 0; i < upserts.length; i += 100) await env.DB.batch(upserts.slice(i, i + 100));

  // Reconcile only after every fresh membership is durable. A failed upsert leaves the complete prior
  // generation visible; tags owned by another source are never overwritten or removed.
  const stale = (prior.results ?? []).filter((row) => !fresh.has(`${row.tag}\0${row.entity_id}`));
  for (let i = 0; i < stale.length; i += 100) {
    await env.DB.batch(
      stale
        .slice(i, i + 100)
        .map((row) =>
          env.DB.prepare(`DELETE FROM tags WHERE source='tokenscan' AND tag=? AND entity_id=?`).bind(
            row.tag,
            row.entity_id,
          ),
        ),
    );
  }
  return { collections, tagged, removed: stale.length };
}
