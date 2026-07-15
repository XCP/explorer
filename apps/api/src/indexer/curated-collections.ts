/**
 * Small, research-backed collections whose membership is an explicit asset list. These are neither
 * derivable from an issuer nor supplied by one of our collection feeds. Keeping the lists here makes
 * the provenance and rebuild path explicit instead of leaving one-off production rows behind.
 */
import type { Env } from "#api/env";
import { THE_COUNTERPART_ASSETS } from "#api/indexer/the-counterpart";

interface CuratedCollection {
  tag: string;
  name: string;
  site?: string;
  assets: readonly string[];
}

export const CURATED_COLLECTIONS: readonly CuratedCollection[] = [
  {
    tag: "rarepenpen",
    name: "RarePenPen",
    assets: [
      "RAREPENPEN", "PENPENRARE", "CLUBPENPEN", "PENPENGEON", "FLYPENPEFLY", "PEPENG", "PENPENCOIN",
      "ZOOPEN", "MRPALPHA", "PENPE", "PENPENCASH", "OOPENPEN", "GAMESOFPEN", "DIGIPENPEN", "LESGOPENPEN",
      "COVPENPEN", "HOMERPENPEN", "XIJINPINGUIN", "ZENPENPEN", "KINGOFPEN", "LORDPEN", "LETSCOOK",
      "PENPENSCHOOL", "PENPENSCREED", "PENPENLISSA", "PENPENNOWAY", "TOKENOPENPEN", "MODERNPENPEN",
      "PENSCAM", "PENBLINDERS", "BORNTOCHILL", "BLENDPEN", "PENPENGOLD", "CYBORPEN", "BITPENPEN",
      "PPAPENPEN", "PENIETZ", "STEAMPENKPEN", "PENPENBUSKER", "PENASCENDER", "ONLYONEPNPN",
      "PENSINGULRTY", "PENPENFUTURE", "THELASTPEN", "PENPENMON", "THOTHPENPEN", "HAIRPENPEN", "PENPENVIP",
      "ZOROPENPEN", "YENGUIN", "PENPENDULUM", "PENJAMIN", "PENPENCARD", "UAREPEN", "BLKSWANGUIN",
      "PENPENHEIRR", "PENASCENSION", "PENPENPIZZA", "IPENGOAT", "PENPEKOMBAT", "SLAPEN", "VLADIMPEROR",
      "PENPENSUSHI", "PSILOCYPEN", "SPACEPENPEN", "PENPENBUGGED", "PENPENTROPY", "PENSALUTPEN", "PENPENDEX",
      "SCOTTIEPENPEN", "PENPENHEAL", "PENKWAST", "WAKEUPPEN", "XCPENPEN", "PENPENTABLE", "PENPENJESS",
      "PENHARMONY", "NAKAPENPEN", "PENPENTOSHI",
    ],
  },
  {
    tag: "the-counterpart",
    name: "The CounterpART",
    site: "https://www.thecounterp.art/",
    assets: THE_COUNTERPART_ASSETS,
  },
];

export async function buildCuratedCollections(env: Env): Promise<Record<string, unknown>> {
  let tagged = 0;
  for (const collection of CURATED_COLLECTIONS) {
    const meta = JSON.stringify({
      collection: collection.name,
      ...(collection.site ? { site: collection.site } : {}),
    });
    const statements = collection.assets.flatMap((asset) => [
      env.CORE_DB.prepare(
        `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
         SELECT 'asset',asset FROM asset_dictionary WHERE asset=?`,
      ).bind(asset),
      env.CORE_DB.prepare(
        `INSERT INTO tags(entity_id,tag,source,meta)
         SELECT entity_id,?,'manual',? FROM entity_dictionary WHERE entity_type='asset' AND entity_key=?
         ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
      ).bind(collection.tag, meta, asset),
    ]);
    for (let index = 0; index < statements.length; index += 90) {
      const results = await env.CORE_DB.batch(statements.slice(index, index + 90));
      tagged += results.reduce((sum, result) => sum + (result.meta?.rows_written ?? 0), 0);
    }

    await env.CORE_DB.prepare(
      `DELETE FROM tags WHERE source='manual' AND tag=? AND entity_id IN (
         SELECT entity_id FROM entity_dictionary
         WHERE entity_type='asset' AND entity_key NOT IN (SELECT value FROM json_each(?))
       )`,
    )
      .bind(collection.tag, JSON.stringify(collection.assets))
      .run();
  }
  await env.CORE_DB.prepare(`DELETE FROM cache WHERE key IN ('tags:all','collection-candidates')`).run();
  return { collections: CURATED_COLLECTIONS.length, tagged };
}
