import type { AssetFeedCounts, AssetIndexRow, AssetSales, BalanceRow } from "@xcp/shared/assets";
import type {
  DestructionRow,
  DispenseRow,
  DispenserRow,
  DividendRow,
  FairmintRow,
  IssuanceRow,
  PoolMatchRow,
  PoolRow,
  SendRow,
} from "@xcp/shared/records";
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
  (EXISTS(SELECT 1 FROM entity_dictionary entity JOIN tags ON tags.entity_id=entity.entity_id
          WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tags.tag='stamp')
   OR EXISTS(SELECT 1 FROM issuances issuance
          WHERE issuance.asset_id=assets.asset_id AND lower(issuance.description) LIKE 'stamp:%')) stamp,
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
      `${SELECT} ORDER BY ${sort} ${direction},dictionary.asset ASC LIMIT ? OFFSET ?`,
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
     ORDER BY last_issuance_block_index DESC,asset ASC LIMIT ?7 OFFSET ?8`,
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
    `SELECT dictionary.asset,assets.asset_longname,issuer.address issuer,
            assets.divisible,assets.locked,signal.holders,signal.top1_pct,signal.trades,
            signal.self_trade_pct,signal.first_trade_blk,signal.last_trade_blk,signal.dispenses,
            signal.dispense_btc,signal.low_quality,signal.holder_breadth,signal.pct_creator_holders,
            signal.burned_pct,signal.distinct_traders,signal.distinct_dispensers,
            max(0,tip.block_index-coalesce(assets.first_issuance_block_index,tip.block_index)) age_blocks,
            signal.avg_holder_dex,signal.recent_events,
            max(0,tip.block_index-signal.last_trade_blk) recency_blocks,
            signal.max_dispense_btc,signal.max_trade_xcp,signal.supply,signal.max_realized_usd,
            signal.distinct_dispense_buyers,signal.max_dispense_btc_clean,signal.emblem_trades,
            signal.graph_trust,signal.graph_distrust,signal.holder_cohesion,
            signal.cohesion_edges,signal.cohesion_strong
       FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets ON assets.asset_id=signal.asset_id
       LEFT JOIN address_dictionary issuer ON issuer.address_id=signal.issuer_id
       CROSS JOIN (SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1) tip
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

export function listAssetBalances(db: D1Database, asset: string, limit: number, offset: number): Promise<BalanceRow[]> {
  return q<BalanceRow>(
    db,
    `SELECT CASE WHEN balance.address_id IS NOT NULL THEN address.address
                 ELSE lower(hex(balance.utxo_tx_hash))||':'||balance.utxo_vout END holder,
            balance.holder_type,balance.quantity,balance.quantity_normalized,
            CASE WHEN signal.is_burn=1 THEN 'burn' WHEN signal.is_exchange=1 THEN 'exchange'
                 WHEN signal.is_emblem_vault=1 THEN 'vault' WHEN signal.is_deposit=1 THEN 'deposit'
                 WHEN signal.likely_service=1 THEN 'service' WHEN signal.survived_assets>=20 THEN 'creator'
                 WHEN signal.assets_held>=500 THEN 'whale' WHEN signal.assets_held>=100 THEN 'collector' END role
       FROM balances balance
       LEFT JOIN address_dictionary address ON address.address_id=balance.address_id
       LEFT JOIN address_signals signal ON signal.address_id=balance.address_id
      WHERE balance.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
        AND CAST(balance.quantity AS INTEGER)>0
      ORDER BY CAST(balance.quantity AS INTEGER) DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

export function listAssetIssuances(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<IssuanceRow[]> {
  return q<IssuanceRow>(
    db,
    `SELECT lower(hex(issuance.tx_hash)) tx_hash,issuance.block_index,issuance.block_time,
            source.address source,issuer.address issuer,issuance.transfer,issuance.quantity_normalized,
            issuance.description,issuance.asset_events,issuance.status
       FROM issuances issuance
       LEFT JOIN address_dictionary source ON source.address_id=issuance.source_id
       LEFT JOIN address_dictionary issuer ON issuer.address_id=issuance.issuer_id
      WHERE issuance.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
      ORDER BY issuance.block_index DESC,issuance.event_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

export function listAssetSends(db: D1Database, asset: string, limit: number, offset: number): Promise<SendRow[]> {
  return q<SendRow>(
    db,
    `SELECT lower(hex(send.tx_hash)) tx_hash,send.block_index,send.block_time,source.address source,
            destination.address destination,dictionary.asset,send.quantity_normalized,send.send_type,send.status
       FROM sends send
       JOIN asset_dictionary dictionary ON dictionary.asset_id=send.asset_id
       LEFT JOIN address_dictionary source ON source.address_id=send.source_id
       LEFT JOIN address_dictionary destination ON destination.address_id=send.destination_id
      WHERE send.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
      ORDER BY send.block_index DESC,send.event_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

export function listAssetDispensers(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DispenserRow[]> {
  return q<DispenserRow>(
    db,
    `SELECT lower(hex(dispenser.tx_hash)) tx_hash,dispenser.block_index,dispenser.block_time,
            source.address source,dictionary.asset,dispenser.give_quantity_normalized,
            dispenser.give_remaining_normalized,dispenser.satoshirate,dispenser.satoshirate_normalized,
            dispenser.dispense_count,dispenser.status,round(coalesce(signal.disp_trust,0),1) operator_trust
       FROM dispensers dispenser
       JOIN asset_dictionary dictionary ON dictionary.asset_id=dispenser.asset_id
       JOIN address_dictionary source ON source.address_id=dispenser.source_id
       LEFT JOIN address_signals signal ON signal.address_id=dispenser.source_id
      WHERE dispenser.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
      ORDER BY dispenser.block_index DESC,dispenser.tx_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

export function listAssetDispenses(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DispenseRow[]> {
  return q<DispenseRow>(
    db,
    `SELECT lower(hex(dispense.tx_hash)) tx_hash,dispense.block_index,dispense.block_time,
            source.address source,destination.address destination,dictionary.asset,
            dispense.dispense_quantity_normalized,lower(hex(parent.tx_hash)) dispenser_tx_hash,
            dispense.btc_amount,trade.usd_value
       FROM dispenses dispense
       JOIN asset_dictionary dictionary ON dictionary.asset_id=dispense.asset_id
       LEFT JOIN transactions parent ON parent.tx_index=dispense.dispenser_tx_index
       LEFT JOIN address_dictionary source ON source.address_id=dispense.source_id
       LEFT JOIN address_dictionary destination ON destination.address_id=dispense.destination_id
       LEFT JOIN trades trade ON trade.venue='dispense' AND trade.ref=CAST(dispense.dispense_id AS TEXT)
      WHERE dispense.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
      ORDER BY dispense.block_index DESC,dispense.event_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

export function listAssetDividends(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DividendRow[]> {
  return q<DividendRow>(
    db,
    `SELECT lower(hex(dividend.tx_hash)) tx_hash,dividend.block_index,dividend.block_time,
            source.address source,paid.asset asset,currency.asset dividend_asset,
            dividend.quantity_per_unit_normalized,dividend.status
       FROM dividends dividend
       LEFT JOIN address_dictionary source ON source.address_id=dividend.source_id
       LEFT JOIN asset_dictionary paid ON paid.asset_id=dividend.asset_id
       LEFT JOIN asset_dictionary currency ON currency.asset_id=dividend.dividend_asset_id
      WHERE dividend.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
         OR dividend.dividend_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
      ORDER BY dividend.block_index DESC,dividend.tx_index DESC LIMIT ?2 OFFSET ?3`,
    asset,
    limit,
    offset,
  );
}

export function listAssetDestructions(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DestructionRow[]> {
  return q<DestructionRow>(
    db,
    `SELECT lower(hex(destruction.tx_hash)) tx_hash,destruction.block_index,destruction.block_time,
            source.address source,dictionary.asset,destruction.quantity_normalized,
            destruction.tag,destruction.status
       FROM destructions destruction
       JOIN asset_dictionary dictionary ON dictionary.asset_id=destruction.asset_id
       LEFT JOIN address_dictionary source ON source.address_id=destruction.source_id
      WHERE destruction.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
      ORDER BY destruction.block_index DESC,destruction.event_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

export function listAssetPools(db: D1Database, asset: string, limit: number, offset: number): Promise<PoolRow[]> {
  return q<PoolRow>(
    db,
    `SELECT pool.lp_asset,pool.pair,a.asset asset_a,b.asset asset_b,pool.reserve_a,pool.reserve_b,
            pool.lp_supply,pool.price,pool.status,pool.block_index
       FROM pools pool
       JOIN asset_dictionary a ON a.asset_id=pool.asset_a_id
       JOIN asset_dictionary b ON b.asset_id=pool.asset_b_id
      WHERE pool.asset_a_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
         OR pool.asset_b_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
         OR pool.lp_asset=?1
      ORDER BY pool.block_index DESC LIMIT ?2 OFFSET ?3`,
    asset,
    limit,
    offset,
  );
}

export function listAssetPoolMatches(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<PoolMatchRow[]> {
  return q<PoolMatchRow>(
    db,
    `SELECT lower(hex(match.tx_hash)) tx_hash,match.block_index,match.block_time,source.address source,
            match.lp_asset,match.pair,forward.asset forward_asset,match.forward_quantity,
            backward.asset backward_asset,match.backward_quantity
       FROM pool_matches match
       LEFT JOIN address_dictionary source ON source.address_id=match.source_id
       LEFT JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
       LEFT JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
      WHERE match.forward_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
         OR match.backward_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
      ORDER BY match.block_index DESC,match.event_index DESC LIMIT ?2 OFFSET ?3`,
    asset,
    limit,
    offset,
  );
}

export function listAssetFairmints(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<FairmintRow[]> {
  return q<FairmintRow>(
    db,
    `SELECT lower(hex(fairmint.tx_hash)) tx_hash,fairmint.block_index,fairmint.block_time,
            source.address source,lower(hex(parent.tx_hash)) fairminter_tx_hash,dictionary.asset,
            fairmint.earn_quantity,fairmint.paid_quantity,coalesce(details.divisible,0) divisible,fairmint.status
       FROM fairmints fairmint
       LEFT JOIN transactions parent ON parent.tx_index=fairmint.fairminter_tx_index
       LEFT JOIN address_dictionary source ON source.address_id=fairmint.source_id
       LEFT JOIN asset_dictionary dictionary ON dictionary.asset_id=fairmint.asset_id
       LEFT JOIN assets details ON details.asset_id=fairmint.asset_id
      WHERE fairmint.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
      ORDER BY fairmint.block_index DESC,fairmint.event_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}
