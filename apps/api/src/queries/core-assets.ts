import type { AssetFeedCounts, AssetIndexRow, AssetSales } from "@xcp/shared/assets";
import type { AssetRow, AssetSignalsRow } from "#api/storage-types";
import type { AssetAccounting } from "#api/queries/asset-accounting";
import { one, q } from "#api/db";

export interface CoreAssetListFilter {
  query?: string;
  limit: number;
  offset: number;
  sort?: string;
  dir?: "asc" | "desc";
}

const SORTS: Record<string, string> = {
  created: "assets.last_issuance_block_index",
  supply: "CAST(assets.supply_normalized AS REAL)",
  asset: "dictionary.asset",
};

const SELECT = `SELECT dictionary.asset,assets.asset_longname,assets.type,issuer.address issuer,owner.address owner,
  assets.divisible,assets.locked,assets.supply_normalized,substr(assets.description,1,140) description,
  EXISTS(SELECT 1 FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
          WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tags.tag='stamp') stamp,
  assets.first_issuance_block_time,assets.last_issuance_block_index
FROM assets
JOIN asset_dictionary dictionary ON dictionary.asset_id=assets.asset_id
LEFT JOIN address_dictionary issuer ON issuer.address_id=assets.issuer_id
LEFT JOIN address_dictionary owner ON owner.address_id=assets.owner_id`;

const nextPrefix = (prefix: string) =>
  prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

export function listCoreAssets(db: D1Database, filter: CoreAssetListFilter): Promise<AssetIndexRow[]> {
  const query = (filter.query ?? "").trim();
  if (query === "") {
    const sort = SORTS[filter.sort ?? ""] ?? SORTS.created;
    const direction = filter.dir === "asc" ? "ASC" : "DESC";
    return q<AssetIndexRow>(
      db,
      `${SELECT} ORDER BY ${sort} ${direction} LIMIT ? OFFSET ?`,
      filter.limit,
      filter.offset,
    );
  }
  const upper = query.toUpperCase();
  const lower = query.toLowerCase();
  return q<AssetIndexRow>(
    db,
    `${SELECT} WHERE dictionary.asset>=?1 AND dictionary.asset<?2
     UNION ${SELECT} WHERE assets.asset_longname>=?3 AND assets.asset_longname<?4
     UNION ${SELECT} WHERE assets.asset_longname>=?5 AND assets.asset_longname<?6
     ORDER BY last_issuance_block_index DESC LIMIT ?7 OFFSET ?8`,
    upper,
    nextPrefix(upper),
    query,
    nextPrefix(query),
    lower,
    nextPrefix(lower),
    filter.limit,
    filter.offset,
  );
}

export function getCoreAsset(db: D1Database, asset: string): Promise<AssetRow | null> {
  return one<AssetRow>(
    db,
    `SELECT dictionary.asset,assets.asset_longname,assets.numeric_asset_id asset_id,assets.type,
            issuer.address issuer,owner.address owner,assets.divisible,assets.locked,
            assets.description_locked,assets.supply,assets.supply_normalized,assets.description,assets.mime_type,
            assets.first_issuance_block_index,assets.last_issuance_block_index,
            assets.first_issuance_block_time,assets.last_issuance_block_time,assets.updated_at
       FROM assets JOIN asset_dictionary dictionary ON dictionary.asset_id=assets.asset_id
       LEFT JOIN address_dictionary issuer ON issuer.address_id=assets.issuer_id
       LEFT JOIN address_dictionary owner ON owner.address_id=assets.owner_id
      WHERE dictionary.asset=? OR assets.asset_longname=?`,
    asset.toUpperCase(),
    asset,
  );
}

export function coreAssetAccounting(db: D1Database, asset: string): Promise<AssetAccounting | null> {
  return one<AssetAccounting>(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1)
     SELECT
       (SELECT COUNT(*) FROM balances WHERE asset_id=(SELECT asset_id FROM identity)
          AND CAST(quantity AS INTEGER)>0) holder_count,
       CAST((SELECT coalesce(SUM(CAST(quantity AS INTEGER)),0) FROM issuances
              WHERE asset_id=(SELECT asset_id FROM identity) AND status LIKE 'valid%')
          - (SELECT coalesce(SUM(CAST(quantity AS INTEGER)),0) FROM destructions
              WHERE asset_id=(SELECT asset_id FROM identity) AND status LIKE 'valid%') AS TEXT) supply,
       CAST((SELECT coalesce(SUM(CAST(balance.quantity AS INTEGER)),0) FROM balances balance
              JOIN address_signals signal ON signal.address_id=balance.address_id
             WHERE balance.asset_id=(SELECT asset_id FROM identity) AND signal.is_burn=1) AS TEXT) burned,
       CAST((SELECT coalesce(SUM(CAST(give_remaining AS INTEGER)),0) FROM dispensers
              WHERE asset_id=(SELECT asset_id FROM identity) AND status=0)
          + (SELECT coalesce(SUM(CAST(give_remaining AS INTEGER)),0) FROM orders
              WHERE give_asset_id=(SELECT asset_id FROM identity) AND status='open') AS TEXT) escrow`,
    asset,
  );
}

export function coreAssetSignals(db: D1Database, asset: string): Promise<AssetSignalsRow | null> {
  return one<AssetSignalsRow>(
    db,
    `SELECT dictionary.asset,assets.asset_longname,issuer.address issuer,signal.*
       FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets ON assets.asset_id=signal.asset_id
       LEFT JOIN address_dictionary issuer ON issuer.address_id=signal.issuer_id
      WHERE dictionary.asset=?`,
    asset,
  );
}

export async function coreAssetTags(db: D1Database, asset: string): Promise<string[]> {
  const rows = await q<{ tag: string }>(
    db,
    `SELECT tags.tag FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
      WHERE entity.entity_type='asset' AND entity.entity_key=? ORDER BY tags.tag`,
    asset,
  );
  return rows.map((row) => row.tag);
}

export function coreAssetSales(db: D1Database, asset: string): Promise<AssetSales | null> {
  return one<AssetSales>(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
          last AS (SELECT usd_value,quantity,block_time FROM trades
                    WHERE asset_id=(SELECT asset_id FROM identity) AND usd_value IS NOT NULL
                    ORDER BY block_time DESC LIMIT 1)
     SELECT (SELECT SUM(usd_value) FROM trades WHERE asset_id=(SELECT asset_id FROM identity)) realized_usd,
            (SELECT CASE WHEN quantity>0 THEN usd_value/quantity END FROM last) last_price_usd,
            (SELECT block_time FROM last) last_sale_time`,
    asset,
  );
}

export function coreAssetFeedCounts(
  db: D1Database,
  asset: string,
  issuer: string | null,
): Promise<AssetFeedCounts | null> {
  return one<AssetFeedCounts>(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
          issuer AS (SELECT address_id FROM address_dictionary WHERE address=?2)
     SELECT counts.sales,counts.issuances,counts.dispensers,counts.dispenses,counts.orders,counts.sends,
            counts.fairmints,counts.dividends,counts.destructions,counts.pools,counts.subassets,
            (SELECT COUNT(*) FROM assets
              WHERE issuer_id=(SELECT address_id FROM issuer) OR owner_id=(SELECT address_id FROM issuer)) from_issuer
       FROM asset_feed_counts counts WHERE counts.asset_id=(SELECT asset_id FROM identity)`,
    asset,
    issuer,
  );
}

export function coreXcpSupply(db: D1Database): Promise<{ supply: string } | null> {
  return one<{ supply: string }>(db, `SELECT xcp_supply supply FROM network_stats_snapshot WHERE singleton=1`);
}

async function coreAssetTag(
  db: D1Database,
  asset: string,
  sourcePredicate: string,
  order = "",
): Promise<{ tag: string; meta: string | null } | null> {
  return one<{ tag: string; meta: string | null }>(
    db,
    `SELECT tags.tag,tags.meta FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
      WHERE entity.entity_type='asset' AND entity.entity_key=? AND ${sourcePredicate} ${order} LIMIT 1`,
    asset,
  );
}

export async function coreAssetCollection(
  db: D1Database,
  asset: string,
): Promise<{ tag: string; site: string | null; series: number | null; card: number | null } | null> {
  const row = await coreAssetTag(
    db,
    asset,
    `tags.source IN ('manual','collection','tokenscan','digirare','issuer','discovered')`,
    `ORDER BY CASE tags.source WHEN 'manual' THEN 0 WHEN 'collection' THEN 1 WHEN 'tokenscan' THEN 2
                               WHEN 'digirare' THEN 3 WHEN 'issuer' THEN 4 ELSE 5 END`,
  );
  if (!row) return null;
  try {
    const meta = row.meta ? (JSON.parse(row.meta) as { site?: string; series?: number; card?: number }) : null;
    return {
      tag: row.tag,
      site: meta?.site ?? null,
      series: meta?.series ?? null,
      card: meta?.card ?? null,
    };
  } catch {
    return { tag: row.tag, site: null, series: null, card: null };
  }
}

export async function coreAssetArtist(
  db: D1Database,
  asset: string,
): Promise<{ tag: string; name: string; slug: string } | null> {
  const row = await coreAssetTag(db, asset, `tags.source='artist'`);
  if (!row?.meta) return null;
  try {
    const meta = JSON.parse(row.meta) as { name?: string; slug?: string };
    return meta.name ? { tag: row.tag, name: meta.name, slug: meta.slug ?? row.tag.replace(/^artist-/, "") } : null;
  } catch {
    return null;
  }
}
