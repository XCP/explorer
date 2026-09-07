import type {
  AddressCollectionCreator,
  CollectionHolderMakeup,
  CollectionPersonaRow,
  CollectionProfile,
} from "@xcp/shared/collections";
import { PERSONA } from "#api/reputation/config";
import { one, q } from "#api/db";

const SOURCES = "'manual','issuer','discovered','collection','digirare','tokenscan'";

const profileSql = (scoped: boolean) => `WITH member AS MATERIALIZED (
  SELECT evidence.tag,evidence.entity_id,asset.asset_id,state.issuer_id,
    rating.rating,COALESCE(signal.low_quality,0) low_quality,
    COALESCE(signal.clean_active_trade_months,0) active_months,
    COALESCE(signal.distinct_paid_buyers,0) paid_buyers,
    COALESCE(signal.clean_realized_usd,0) realized_usd
  FROM collection_membership_evidence evidence
  JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id AND entity.entity_type='asset'
  LEFT JOIN asset_dictionary asset ON asset.asset=entity.entity_key
  LEFT JOIN assets state ON state.asset_id=asset.asset_id
  LEFT JOIN asset_signals signal ON signal.asset_id=asset.asset_id
  LEFT JOIN asset_ratings rating ON rating.asset_id=asset.asset_id
  WHERE evidence.source IN (${SOURCES}) ${scoped ? "AND evidence.tag=?" : ""}
  GROUP BY evidence.tag,evidence.entity_id
), rated_ranked AS (
  SELECT tag,rating,ROW_NUMBER() OVER(PARTITION BY tag ORDER BY rating) rating_rank,
    COUNT(*) OVER(PARTITION BY tag) rated_count
  FROM member WHERE rating IS NOT NULL
), rating_median AS (
  SELECT tag,ROUND(AVG(CASE WHEN rating_rank IN ((rated_count+1)/2,(rated_count/2)+1)
    THEN rating END),1) median_rating
  FROM rated_ranked GROUP BY tag
), base AS (
  SELECT tag,COUNT(*) members,COUNT(DISTINCT issuer_id) issuers,
    SUM(rating IS NOT NULL) rated_members,
    SUM(CASE WHEN rating>=9 THEN 1 ELSE 0 END) rating_exceptional,
    SUM(CASE WHEN rating>=7 AND rating<9 THEN 1 ELSE 0 END) rating_strong,
    SUM(CASE WHEN rating>=4 AND rating<7 THEN 1 ELSE 0 END) rating_developing,
    SUM(CASE WHEN rating<4 THEN 1 ELSE 0 END) rating_limited,
    SUM(active_months>0) market_assets,SUM(active_months) total_active_months,
    SUM(paid_buyers) total_paid_buyers,SUM(realized_usd) total_realized_usd,
    MAX(realized_usd) top_asset_value,SUM(low_quality=1) integrity_assets
  FROM member GROUP BY tag HAVING COUNT(*)>=3
), holder AS (
  SELECT member.tag,COUNT(*) holder_relationships,COUNT(DISTINCT balance.address_id) unique_holders
  FROM member JOIN balances balance ON balance.asset_id=member.asset_id
  WHERE balance.address_id IS NOT NULL AND CAST(balance.quantity AS INTEGER)>0 GROUP BY member.tag
), evidence AS (
  SELECT tag,COUNT(DISTINCT source) sources,GROUP_CONCAT(DISTINCT source) source_list
  FROM collection_membership_evidence WHERE source IN (${SOURCES}) ${scoped ? "AND tag=?" : ""} GROUP BY tag
), metadata AS (
  SELECT tag,MIN(CASE WHEN json_valid(meta) THEN meta END) meta
  FROM tags WHERE source IN (${SOURCES}) ${scoped ? "AND tag=?" : ""} GROUP BY tag
)
SELECT base.tag,COALESCE(json_extract(metadata.meta,'$.collection'),base.tag) name,
  json_extract(metadata.meta,'$.site') site,evidence.sources,evidence.source_list,
  base.members,base.issuers,base.rated_members,ROUND(100.0*base.rated_members/base.members,1) rated_pct,
  rating_median.median_rating,base.rating_exceptional,base.rating_strong,
  base.rating_developing,base.rating_limited,
  base.market_assets,ROUND(100.0*base.market_assets/base.members,1) market_pct,
  base.total_active_months,base.total_paid_buyers,ROUND(base.total_realized_usd,2) total_realized_usd,
  COALESCE(holder.holder_relationships,0) holder_relationships,COALESCE(holder.unique_holders,0) unique_holders,
  ROUND(100.0*(holder.holder_relationships-holder.unique_holders)/NULLIF(holder.holder_relationships,0),1)
    holder_overlap_pct,
  ROUND(100.0*base.top_asset_value/NULLIF(base.total_realized_usd,0),1) top_asset_value_pct,
  base.integrity_assets,ROUND(100.0*base.integrity_assets/base.members,1) integrity_pct
FROM base JOIN evidence USING(tag) LEFT JOIN metadata USING(tag)
LEFT JOIN rating_median USING(tag) LEFT JOIN holder USING(tag)`;

/** Independent observed collection axes. No composite grade or collection rank. */
export function listCollectionProfiles(db: D1Database): Promise<CollectionProfile[]> {
  return q<CollectionProfile>(db, `${profileSql(false)} ORDER BY rated_pct DESC,median_rating DESC,members DESC,tag`);
}

export function getCollectionProfile(db: D1Database, tag: string): Promise<CollectionProfile | null> {
  return one<CollectionProfile>(db, profileSql(true), tag, tag, tag);
}

/** Whether the tag would produce a profile — the same >=3-member floor profileSql applies, answered
 *  by a seek on the (tag, entity_id) index so an unknown tag can 404 without paying for the profile. */
export async function collectionProfileExists(db: D1Database, tag: string): Promise<boolean> {
  const row = await one<{ present: number }>(
    db,
    `SELECT 1 present FROM collection_membership_evidence
      WHERE tag=? AND source IN (${SOURCES})
      GROUP BY tag HAVING COUNT(DISTINCT entity_id)>=3`,
    tag,
  );
  return row !== null;
}

/** Every current holder of every member asset, classified by the SAME persona rules the address header
 *  uses (reputation/persona.ts, thresholds from reputation/config.ts — interpolated here so the two
 *  surfaces cannot drift apart on tuning). "light" holds but clears no floor; custody flags win first. */
export async function collectionHolderMakeup(db: D1Database, tag: string): Promise<CollectionHolderMakeup> {
  const P = PERSONA;
  const personas = await q<CollectionPersonaRow>(
    db,
    `WITH member_assets AS (
       SELECT DISTINCT asset.asset_id
       FROM collection_membership_evidence evidence
       JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id AND entity.entity_type='asset'
       JOIN asset_dictionary asset ON asset.asset=entity.entity_key
       WHERE evidence.tag=?1 AND evidence.source IN (${SOURCES})
     ), holders AS (
       SELECT DISTINCT balance.address_id
       FROM member_assets JOIN balances balance ON balance.asset_id=member_assets.asset_id
       WHERE balance.address_id IS NOT NULL AND CAST(balance.quantity AS INTEGER) > 0
     ), classified AS (
       SELECT CASE
         WHEN signal.is_exchange=1 OR signal.is_deposit=1 OR signal.is_emblem_vault=1 OR signal.is_burn=1
           THEN 'service'
         WHEN signal.vault_scams+signal.shell_scams+signal.dump_scams > 0 THEN 'integrity'
         WHEN reputation.reputation IS NULL THEN 'light'
         ELSE (
           WITH role(k, i, ok, w) AS (
             SELECT 'creator',
               ln(1+signal.assets_issued+signal.stamps_created+2*signal.src20_deploys)/ln(1+${P.creatorCap}),
               signal.assets_issued+signal.stamps_created+2*signal.src20_deploys >= ${P.creatorFloor}, 4
             UNION ALL SELECT 'merchant', ln(1+signal.dispenses)/ln(1+${P.merchantCap}),
               signal.dispenses >= ${P.merchantFloor}, 3
             UNION ALL SELECT 'trader', ln(1+signal.dex_trades)/ln(1+${P.traderCap}),
               signal.dex_trades >= ${P.traderFloor}, 2
             UNION ALL SELECT 'collector',
               ln(1+signal.assets_held+0.5*signal.assets_received)/ln(1+${P.collectorCap}),
               signal.assets_held >= ${P.collectorFloor}, 1
           )
           SELECT COALESCE(
             (SELECT k FROM role WHERE ok ORDER BY MIN(i,1.0) DESC, w DESC LIMIT 1),
             'light')
         )
       END persona
       FROM holders
       JOIN address_signals signal ON signal.address_id=holders.address_id
       LEFT JOIN address_reputations reputation ON reputation.address_id=holders.address_id
     )
     SELECT persona, COUNT(*) holders FROM classified GROUP BY persona ORDER BY holders DESC`,
    tag,
  );
  return { tag, holders: personas.reduce((sum, row) => sum + row.holders, 0), personas };
}

/** Which curated collections each requested address created cards in, from the collection_creators
 *  projection: one indexed probe per address, whatever the collection sizes. Addresses that created
 *  nothing are omitted, so the caller reads absence as "no badge", not "unknown". */
export async function listAddressCollectionCreators(
  db: D1Database,
  addresses: string[],
): Promise<AddressCollectionCreator[]> {
  const rows = await q<{ address: string; tag: string; cards: number }>(
    db,
    `SELECT dictionary.address,creator.tag,creator.cards
       FROM json_each(?1) request
       JOIN address_dictionary dictionary ON dictionary.address=request.value
       JOIN collection_creators creator ON creator.address_id=dictionary.address_id
      ORDER BY dictionary.address,creator.cards DESC,creator.tag`,
    JSON.stringify(addresses),
  );
  const out: AddressCollectionCreator[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last?.address === row.address) last.collections.push({ tag: row.tag, cards: row.cards });
    else out.push({ address: row.address, collections: [{ tag: row.tag, cards: row.cards }] });
  }
  return out;
}

/** Which curated collections each requested address currently holds a card of. Answered live from the
 *  addresses' own balance rows (one indexed range per address) probed against membership evidence, not
 *  from a projection: a holdings table would be thirty times the creators one and rebuilt daily for a
 *  reader that asks in batches a few times a day. Opt-in on the route for the same reason. */
export async function listAddressCollectionHoldings(
  db: D1Database,
  addresses: string[],
): Promise<Map<string, { tag: string; cards: number }[]>> {
  const rows = await q<{ address: string; tag: string; cards: number }>(
    db,
    `SELECT dictionary.address,evidence.tag,COUNT(DISTINCT balance.asset_id) cards
       FROM json_each(?1) request
       JOIN address_dictionary dictionary ON dictionary.address=request.value
       JOIN balances balance ON balance.address_id=dictionary.address_id AND CAST(balance.quantity AS INTEGER)>0
       JOIN asset_dictionary asset ON asset.asset_id=balance.asset_id
       JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=asset.asset
       JOIN collection_membership_evidence evidence ON evidence.entity_id=entity.entity_id
        AND evidence.source IN (${SOURCES})
      GROUP BY dictionary.address,evidence.tag
      ORDER BY dictionary.address,cards DESC,evidence.tag`,
    JSON.stringify(addresses),
  );
  const out = new Map<string, { tag: string; cards: number }[]>();
  for (const row of rows) {
    const list = out.get(row.address) ?? [];
    list.push({ tag: row.tag, cards: row.cards });
    out.set(row.address, list);
  }
  return out;
}

/** Creators and, when asked, holdings, merged per address in request order. */
export async function listAddressCollections(
  db: D1Database,
  addresses: string[],
  includeHeld: boolean,
): Promise<AddressCollectionCreator[]> {
  const created = await listAddressCollectionCreators(db, addresses);
  if (!includeHeld) return created;
  const held = await listAddressCollectionHoldings(db, addresses);
  const byAddress = new Map(created.map((row) => [row.address, row]));
  for (const address of addresses) {
    const list = held.get(address);
    if (!list) continue;
    const row = byAddress.get(address);
    if (row) row.held = list;
    else byAddress.set(address, { address, collections: [], held: list });
  }
  return addresses.flatMap((address) => byAddress.get(address) ?? []);
}
