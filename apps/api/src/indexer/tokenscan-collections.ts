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

  await env.DB.prepare(`DELETE FROM tags WHERE source='tokenscan'`).run();
  let collections = 0,
    tagged = 0;
  for (const c of data) {
    if (!c.name || !c.cards?.length) continue;
    const tag = canonicalCollection(slugify(c.name)); // collapse known dupes onto the pepe.wtf/canonical slug
    if (!tag || EXCLUDED_COLLECTIONS.has(tag)) continue; // owner-removed collections stay removed
    const meta = JSON.stringify({ collection: c.name, ...(c.site ? { site: c.site } : {}) });
    const assets = [...new Set(c.cards.map(assetOf).filter(Boolean))];
    for (let i = 0; i < assets.length; i += 100) {
      // OR IGNORE so a pre-existing collection tag from another source (same asset+slug) is left as-is.
      await env.DB.batch(
        assets
          .slice(i, i + 100)
          .map((n) =>
            env.DB.prepare(
              `INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source,meta) VALUES ('asset',?,?,'tokenscan',?)`,
            ).bind(n, tag, meta),
          ),
      );
    }
    collections++;
    tagged += assets.length;
  }
  return { collections, tagged };
}
