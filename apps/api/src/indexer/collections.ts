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
import type { Env } from "../env";

// pepe.wtf collection slug -> our tag slug. `stamps` (26k) is intentionally excluded — we already carry a
// protocol-derived `stamp` tag; folding all Bitcoin Stamps in here would swamp the collection layer.
const PEPEWTF: Record<string, string> = {
  "rare-pepes": "rare-pepe",
  "fake-rares": "fake-rare",
  "fake-commons": "fake-common",
  "dank-rares": "dank-rare",
  "rare-coco": "rare-coco",
  "community-rewards": "community-rewards",
  "the-wojak-way": "the-wojak-way",
  "notable-pepes": "notable-pepe",
  "potentially-notable-pepes": "potentially-notable-pepe",
  memeables: "memeable",
  bitcorn: "bitcorn",
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Same collection curated under two feed slugs (pepe.wtf vs tokenscan) → one canonical tag, so the /collections
// list stops showing dupes and volume isn't double-counted. Applied in BOTH crawlers (collections + tokenscan)
// so neither can re-create a duplicate. Keys are the slugs each feed would otherwise emit; value is canonical.
const CANONICAL: Record<string, string> = {
  "dank-rare": "dank-directory", // pepe.wtf "Dank Rares"  ≡ tokenscan "Dank Directory"
  "fake-common": "fake-commons", // pepe.wtf "Fake Commons" (we slugged singular) ≡ tokenscan "Fake Commons"
  bitcorns: "bitcorn", // tokenscan "Bitcorns"    ≡ pepe.wtf/curated "Bitcorn"
};
export const canonicalCollection = (tag: string): string => CANONICAL[tag] ?? tag;

/** Collections the owner has REMOVED — every crawl skips these slugs so a deletion stays deleted
 *  across rebuilds. (wojak-npc: removed by owner 2026-07-11.) */
export const EXCLUDED_COLLECTIONS = new Set<string>(["wojak-npc"]);

interface Member {
  name: string;
  series: number | null;
  card: number | null;
  artist: { name: string; slug: string } | null;
}

async function fetchMembers(slug: string): Promise<Member[]> {
  // NB: the endpoint requires a real user-agent — an unknown/absent one returns []. It's also loose about the
  // slug, so we keep only rows it actually attributes to THIS collection.
  const r = await fetch(`https://api.pepe.wtf/api/asset?collection=${slug}`, {
    headers: { "user-agent": "xcp.io-indexer" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`pepe.wtf ${slug} ${r.status}`);
  const arr = (await r.json()) as Array<{
    name?: string;
    collection?: string;
    serie?: number | null;
    card?: number | null;
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
  const out: { collections: Record<string, string | number>; artists?: number; total_collection_tags?: number } = {
    collections: {},
  };
  for (const [slug, rawTag] of Object.entries(PEPEWTF)) {
    const tag = canonicalCollection(rawTag);
    let members: Member[];
    try {
      members = await fetchMembers(slug);
    } catch (e) {
      out.collections[tag] = `err:${String(e).slice(0, 40)}`;
      continue;
    }
    if (!members.length) {
      out.collections[tag] = "empty(kept prior)";
      continue;
    } // transient-safe: don't wipe

    // UPSERT-then-reconcile (never delete-first): the collection is never emptied mid-run, a partial feed
    // can't nuke it, and a crash between steps just leaves the prior set intact. `source='manual'` members
    // are outside this entirely (a different source) — the crawl never sees or touches them.
    const curRows = await env.DB.prepare(`SELECT entity_id FROM tags WHERE tag=? AND source='collection'`)
      .bind(tag)
      .all<{ entity_id: string }>();
    const cur = new Set((curRows.results || []).map((r) => r.entity_id));

    // 1) upsert the fresh set (membership + serie/card; artist tags spread across collections so are upsert-only).
    const stmts: D1PreparedStatement[] = [];
    for (const m of members) {
      const meta = m.series != null || m.card != null ? JSON.stringify({ series: m.series, card: m.card }) : null;
      const value = m.series != null && m.card != null ? m.series * 1000 + m.card : null; // sort key: S1C1=1001, S2C1=2001…
      stmts.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO tags (entity_type,entity_id,tag,source,value,meta) VALUES ('asset',?,?,'collection',?,?)`,
        ).bind(m.name, tag, value, meta),
      );
      if (m.artist) {
        stmts.push(
          env.DB.prepare(
            `INSERT OR REPLACE INTO tags (entity_type,entity_id,tag,source,meta) VALUES ('asset',?,?,'artist',?)`,
          ).bind(m.name, `artist-${m.artist.slug}`, JSON.stringify({ name: m.artist.name, slug: m.artist.slug })),
        );
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

    // 2) reconcile removals: drop feed members that vanished from the fresh set — but only when the pull looks
    //    complete. Cap one run's prune at 20% (min 10); a bigger drop signals a short/partial feed, so we keep
    //    the stale rows rather than risk gutting the collection on a bad response.
    const fresh = new Set(members.map((m) => m.name));
    const stale = [...cur].filter((n) => !fresh.has(n));
    const cap = Math.max(10, Math.floor(cur.size * 0.2));
    if (stale.length && stale.length <= cap) {
      const del = stale.map((n) =>
        env.DB.prepare(`DELETE FROM tags WHERE tag=? AND entity_id=? AND source='collection'`).bind(tag, n),
      );
      for (let i = 0; i < del.length; i += 100) await env.DB.batch(del.slice(i, i + 100));
    }
    out.collections[tag] =
      stale.length > cap ? `${members.length} (+${stale.length} stale kept — feed looked short)` : members.length;
  }
  const nc = await env.DB.prepare(`SELECT COUNT(*) c FROM tags WHERE source='collection'`).first<{ c: number }>();
  const na = await env.DB.prepare(`SELECT COUNT(DISTINCT tag) c FROM tags WHERE source='artist'`).first<{
    c: number;
  }>();
  out.total_collection_tags = nc?.c ?? 0;
  out.artists = na?.c ?? 0;
  return out;
}
