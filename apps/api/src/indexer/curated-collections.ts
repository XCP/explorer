/**
 * Small, research-backed collections whose membership is an explicit asset list. These are neither
 * derivable from an issuer nor supplied by one of our collection feeds. Keeping the lists here makes
 * the provenance and rebuild path explicit instead of leaving one-off production rows behind.
 */
import type { Env } from "#api/env";
import { COLLECTION_EVIDENCE_UPSERT_SQL, projectCollectionMembership } from "#api/indexer/collection-membership";
import { ARTIST_TAG_UPSERT_SQL } from "#api/indexer/collections";
import { GREYPEPE_PROJECT_MEMBERS } from "#api/indexer/greypepe-project";
import { THE_COUNTERPART_ASSETS } from "#api/indexer/the-counterpart";

interface CuratedCollection {
  tag: string;
  name: string;
  site?: string;
  assets: readonly string[];
  artists?: ReadonlyMap<string, { name: string; slug: string }>;
}

export const CURATED_COLLECTIONS: readonly CuratedCollection[] = [
  {
    tag: "the-greypepe-project",
    name: "The GreyPepe Project",
    site: "https://greypepeproject.com/",
    assets: GREYPEPE_PROJECT_MEMBERS.map(({ asset }) => asset),
    artists: new Map(GREYPEPE_PROJECT_MEMBERS.map(({ asset, artist }) => [asset, artist])),
  },
  {
    tag: "rarepenpen",
    name: "RarePenPen",
    assets: [
      "RAREPENPEN",
      "PENPENRARE",
      "CLUBPENPEN",
      "PENPENGEON",
      "FLYPENPEFLY",
      "PEPENG",
      "PENPENCOIN",
      "ZOOPEN",
      "MRPALPHA",
      "PENPE",
      "PENPENCASH",
      "OOPENPEN",
      "GAMESOFPEN",
      "DIGIPENPEN",
      "LESGOPENPEN",
      "COVPENPEN",
      "HOMERPENPEN",
      "XIJINPINGUIN",
      "ZENPENPEN",
      "KINGOFPEN",
      "LORDPEN",
      "LETSCOOK",
      "PENPENSCHOOL",
      "PENPENSCREED",
      "PENPENLISSA",
      "PENPENNOWAY",
      "TOKENOPENPEN",
      "MODERNPENPEN",
      "PENSCAM",
      "PENBLINDERS",
      "BORNTOCHILL",
      "BLENDPEN",
      "PENPENGOLD",
      "CYBORPEN",
      "BITPENPEN",
      "PPAPENPEN",
      "PENIETZ",
      "STEAMPENKPEN",
      "PENPENBUSKER",
      "PENASCENDER",
      "ONLYONEPNPN",
      "PENSINGULRTY",
      "PENPENFUTURE",
      "THELASTPEN",
      "PENPENMON",
      "THOTHPENPEN",
      "HAIRPENPEN",
      "PENPENVIP",
      "ZOROPENPEN",
      "YENGUIN",
      "PENPENDULUM",
      "PENJAMIN",
      "PENPENCARD",
      "UAREPEN",
      "BLKSWANGUIN",
      "PENPENHEIRR",
      "PENASCENSION",
      "PENPENPIZZA",
      "IPENGOAT",
      "PENPEKOMBAT",
      "SLAPEN",
      "VLADIMPEROR",
      "PENPENSUSHI",
      "PSILOCYPEN",
      "SPACEPENPEN",
      "PENPENBUGGED",
      "PENPENTROPY",
      "PENSALUTPEN",
      "PENPENDEX",
      "SCOTTIEPENPEN",
      "PENPENHEAL",
      "PENKWAST",
      "WAKEUPPEN",
      "XCPENPEN",
      "PENPENTABLE",
      "PENPENJESS",
      "PENHARMONY",
      "NAKAPENPEN",
      "PENPENTOSHI",
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
    const statements = collection.assets.flatMap((asset) => {
      const artist = collection.artists?.get(asset);
      return [
        env.CORE_DB.prepare(
          `INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
         SELECT 'asset',asset FROM asset_dictionary WHERE asset=?`,
        ).bind(asset),
        env.CORE_DB.prepare(COLLECTION_EVIDENCE_UPSERT_SQL).bind(asset, collection.tag, "manual", null, meta),
        ...(artist
          ? [env.CORE_DB.prepare(ARTIST_TAG_UPSERT_SQL).bind(asset, `artist-${artist.slug}`, JSON.stringify(artist))]
          : []),
      ];
    });
    for (let index = 0; index < statements.length; index += 90) {
      const results = await env.CORE_DB.batch(statements.slice(index, index + 90));
      tagged += results.reduce((sum, result) => sum + (result.meta?.rows_written ?? 0), 0);
    }

    await env.CORE_DB.prepare(
      `DELETE FROM collection_membership_evidence WHERE source='manual' AND tag=? AND entity_id IN (
         SELECT entity_id FROM entity_dictionary
         WHERE entity_type='asset' AND entity_key NOT IN (SELECT value FROM json_each(?))
       )`,
    )
      .bind(collection.tag, JSON.stringify(collection.assets))
      .run();
    await projectCollectionMembership(env, collection.tag);
  }
  await env.CORE_DB.prepare(`DELETE FROM cache WHERE key IN ('tags:all','collection-candidates')`).run();
  return { collections: CURATED_COLLECTIONS.length, tagged };
}
