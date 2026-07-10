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
import type { Env } from "../index";
import { canonicalCollection } from "./collections";

const NFTS_URL = "https://tokenscan.io/js/nfts.js";

interface TsCollection { name?: string; site?: string; cards?: string[] }

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const assetOf = (card: string) => card.replace(/\.[^.]+$/, "").trim(); // "RAREPIGEON.png" -> "RAREPIGEON"

async function fetchNftData(): Promise<TsCollection[]> {
  const r = await fetch(NFTS_URL, { headers: { "user-agent": "xcp.io-indexer" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`tokenscan nfts.js ${r.status}`);
  const t = await r.text();
  const a = t.indexOf("["), b = t.lastIndexOf("]"); // the file is `NFT_DATA = [ … ]`; slice the array literal out
  if (a < 0 || b < 0 || b < a) throw new Error("NFT_DATA array not found");
  return JSON.parse(t.slice(a, b + 1)) as TsCollection[];
}

/** Refresh the tokenscan collection tags (asset → project, with {collection, site} meta). */
export async function crawlTokenscanCollections(env: Env): Promise<Record<string, unknown>> {
  let data: TsCollection[];
  try { data = await fetchNftData(); } catch (e) { return { skipped: `fetch:${String(e).slice(0, 60)}` }; }
  if (!data.length) return { skipped: "empty(kept prior)" }; // transient-safe: never wipe on a blip

  await env.DB.prepare(`DELETE FROM tags WHERE source='tokenscan'`).run();
  let collections = 0, tagged = 0;
  for (const c of data) {
    if (!c.name || !c.cards?.length) continue;
    const tag = canonicalCollection(slugify(c.name)); // collapse known dupes onto the pepe.wtf/canonical slug
    if (!tag) continue;
    const meta = JSON.stringify({ collection: c.name, ...(c.site ? { site: c.site } : {}) });
    const assets = [...new Set(c.cards.map(assetOf).filter(Boolean))];
    for (let i = 0; i < assets.length; i += 100) {
      // OR IGNORE so a pre-existing collection tag from another source (same asset+slug) is left as-is.
      await env.DB.batch(assets.slice(i, i + 100).map((n) =>
        env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source,meta) VALUES ('asset',?,?,'tokenscan',?)`).bind(n, tag, meta)));
    }
    collections++; tagged += assets.length;
  }
  return { collections, tagged };
}
