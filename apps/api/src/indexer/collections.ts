/**
 * Collection-membership tags — the "which canonical series is this card in" layer (Rare Pepe, Fake Rare,
 * Bitcorn, Dank Rare, …). This is NOT derivable on-chain; it comes from pepe.wtf's directory API — the same
 * authoritative feed app.xcp.io's Media/Collections jobs used (`api.pepe.wtf/api/asset?collection=<slug>`).
 *
 * The one feed carries three things we index in a single daily pass:
 *   1. collection membership  → tag(source='collection')
 *   2. serie + card position  → meta {serie,card} + value (serie*1000+card, a canonical sort key) on that tag
 *   3. artist attribution      → tag(source='artist'), so an artist's catalogue rides the normal tag pages
 *
 * All written as non-computed sources, so buildTags' computed-tag rebuild leaves them intact. Rebuild is
 * per-collection and transient-safe: a fetch that returns empty/errors leaves that collection untouched.
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

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

interface Member {
  name: string;
  series: number | null;
  card: number | null;
  artist: { name: string; slug: string } | null;
}

async function fetchMembers(slug: string): Promise<Member[]> {
  // NB: the endpoint requires a real user-agent — an unknown/absent one returns []. It's also loose about the
  // slug, so we keep only rows it actually attributes to THIS collection.
  const r = await fetch(`https://api.pepe.wtf/api/asset?collection=${slug}`,
    { headers: { "user-agent": "xcp.io-indexer" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`pepe.wtf ${slug} ${r.status}`);
  const arr = (await r.json()) as Array<{
    name?: string; collection?: string; serie?: number | null; card?: number | null;
    artist?: { name?: string; slug?: string } | null;
  }>;
  const seen = new Set<string>();
  const out: Member[] = [];
  for (const a of arr) {
    if (!a?.name || a.collection !== slug || seen.has(a.name)) continue;
    seen.add(a.name);
    const artistName = a.artist?.name?.trim();
    out.push({
      name: String(a.name),
      series: typeof a.serie === "number" ? a.serie : null, // pepe.wtf spells it "serie"; we normalize to "series"
      card: typeof a.card === "number" ? a.card : null,
      artist: artistName ? { name: artistName, slug: slugify(String(a.artist?.slug || artistName)) } : null,
    });
  }
  return out;
}

export async function crawlCollections(env: Env): Promise<Record<string, unknown>> {
  const out: { collections: Record<string, string | number>; artists?: number; total_collection_tags?: number } = { collections: {} };
  for (const [slug, tag] of Object.entries(PEPEWTF)) {
    let members: Member[];
    try { members = await fetchMembers(slug); }
    catch (e) { out.collections[tag] = `err:${String(e).slice(0, 40)}`; continue; }
    if (!members.length) { out.collections[tag] = "empty(kept prior)"; continue; } // transient-safe: don't wipe

    // Rebuild this collection's membership from scratch (drop stale, re-insert the fresh set with serie/card).
    await env.DB.prepare(`DELETE FROM tags WHERE tag=? AND source='collection'`).bind(tag).run();
    const stmts: D1PreparedStatement[] = [];
    for (const m of members) {
      const meta = m.series != null || m.card != null ? JSON.stringify({ series: m.series, card: m.card }) : null;
      // Canonical intra-collection sort key: Series 1 Card 1 = 1001, Series 2 Card 1 = 2001, …
      const value = m.series != null && m.card != null ? m.series * 1000 + m.card : null;
      stmts.push(env.DB.prepare(
        `INSERT OR REPLACE INTO tags (entity_type,entity_id,tag,source,value,meta) VALUES ('asset',?,?,'collection',?,?)`
      ).bind(m.name, tag, value, meta));
      // Artist tag (source='artist'): upsert rather than delete-by-tag — an artist spans collections, so we
      // must not wipe their other cards when rebuilding one collection.
      if (m.artist) {
        stmts.push(env.DB.prepare(
          `INSERT OR REPLACE INTO tags (entity_type,entity_id,tag,source,meta) VALUES ('asset',?,?,'artist',?)`
        ).bind(m.name, `artist-${m.artist.slug}`, JSON.stringify({ name: m.artist.name, slug: m.artist.slug })));
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    out.collections[tag] = members.length;
  }
  const nc = await env.DB.prepare(`SELECT COUNT(*) c FROM tags WHERE source='collection'`).first<{ c: number }>();
  const na = await env.DB.prepare(`SELECT COUNT(DISTINCT tag) c FROM tags WHERE source='artist'`).first<{ c: number }>();
  out.total_collection_tags = nc?.c ?? 0;
  out.artists = na?.c ?? 0;
  return out;
}
