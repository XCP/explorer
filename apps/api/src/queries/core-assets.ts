import type { AssetIndexRow } from "@xcp/shared/assets";
import type { AssetRow } from "#api/storage-types";
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
