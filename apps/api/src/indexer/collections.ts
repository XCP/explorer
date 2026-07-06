/**
 * Collection-membership tags — the "which canonical series is this card in" layer (Rare Pepe, Fake Rare,
 * Bitcorn, Dank Rare, …). This is NOT derivable on-chain; it comes from pepe.wtf's directory API — the same
 * authoritative feed app.xcp.io's Media/Collections jobs used (`api.pepe.wtf/api/asset?collection=<slug>`).
 *
 * Written as tags with source='collection' (so buildTags' computed-tag rebuild leaves them intact), refreshed
 * on the cron ~daily. Rebuild is per-collection and transient-safe: a fetch that returns empty/errors leaves
 * the existing tags for that collection untouched (never wipe on a blip).
 */
import type { Env } from "../index";

// pepe.wtf collection slug -> our tag slug. `stamps` (26k) is intentionally excluded — we already carry a
// protocol-derived `stamp` tag; folding all Bitcoin Stamps in here would swamp the collection layer.
const PEPEWTF: Record<string, string> = {
  "rare-pepes": "rare-pepe", "fake-rares": "fake-rare", "fake-commons": "fake-common",
  "dank-rares": "dank-rare", "rare-coco": "rare-coco", "community-rewards": "community-rewards",
  "the-wojak-way": "the-wojak-way", "notable-pepes": "notable-pepe",
  "potentially-notable-pepes": "potentially-notable-pepe", "memeables": "memeable", "bitcorn": "bitcorn",
};

async function fetchMembers(slug: string): Promise<string[]> {
  const r = await fetch(`https://api.pepe.wtf/api/asset?collection=${slug}`,
    { headers: { "user-agent": "xcp.io-indexer" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`pepe.wtf ${slug} ${r.status}`);
  const arr = (await r.json()) as any[];
  // keep only rows the API attributes to THIS collection (the endpoint is loose about the slug)
  return [...new Set(arr.filter((a) => a?.name && a?.collection === slug).map((a) => String(a.name)))];
}

export async function crawlCollections(env: Env): Promise<any> {
  const out: any = { collections: {} };
  for (const [slug, tag] of Object.entries(PEPEWTF)) {
    let names: string[];
    try { names = await fetchMembers(slug); }
    catch (e) { out.collections[tag] = `err:${String(e).slice(0, 40)}`; continue; }
    if (!names.length) { out.collections[tag] = "empty(kept prior)"; continue; } // transient-safe: don't wipe
    // rebuild this collection: drop its stale membership, re-insert the fresh set
    await env.DB.prepare(`DELETE FROM tags WHERE tag=? AND source='collection'`).bind(tag).run();
    for (let i = 0; i < names.length; i += 100) {
      await env.DB.batch(names.slice(i, i + 100).map((n) =>
        env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) VALUES ('asset',?,?,'collection')`).bind(n, tag)));
    }
    out.collections[tag] = names.length;
  }
  const n = await env.DB.prepare(`SELECT COUNT(*) c FROM tags WHERE source='collection'`).first<{ c: number }>();
  out.total_collection_tags = n?.c ?? 0;
  return out;
}
