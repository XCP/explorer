import type {
  AssetActiveUser,
  AssetCohortRow,
  AssetFeedCounts,
  AssetIndexRow,
  AssetListRow,
  AssetSales,
  BalanceRow,
} from "@xcp/shared/assets";
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
import { collectionMembershipPrioritySql } from "#api/indexer/collection-membership";

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
      `WITH page AS MATERIALIZED (
         SELECT assets.asset_id FROM assets
         JOIN asset_dictionary dictionary ON dictionary.asset_id=assets.asset_id
         ORDER BY ${sort} ${direction},dictionary.asset ASC LIMIT ? OFFSET ?
       )
       ${SELECT} WHERE assets.asset_id IN (SELECT asset_id FROM page)
       ORDER BY ${sort} ${direction},dictionary.asset ASC`,
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
    `WITH identity AS (
       SELECT coalesce(
         (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
         (SELECT asset_id FROM assets WHERE asset_longname=?2)
       ) asset_id
     )
     SELECT dictionary.asset,assets.asset_longname,assets.numeric_asset_id asset_id,assets.type,
            issuer.address issuer,owner.address owner,assets.divisible,assets.locked,
            assets.description_locked,assets.supply,assets.supply_normalized,assets.description,assets.mime_type,
            assets.first_issuance_block_index,assets.last_issuance_block_index,
            assets.first_issuance_block_time,assets.last_issuance_block_time,assets.updated_at
       FROM identity JOIN assets ON assets.asset_id=identity.asset_id
       JOIN asset_dictionary dictionary ON dictionary.asset_id=assets.asset_id
       LEFT JOIN address_dictionary issuer ON issuer.address_id=assets.issuer_id
       LEFT JOIN address_dictionary owner ON owner.address_id=assets.owner_id`,
    asset.toUpperCase(),
    asset,
  );
}

export function coreAssetBrief(
  db: D1Database,
  asset: string,
): Promise<{ supply_normalized: string | null; divisible: 0 | 1 | null; locked: 0 | 1 | null } | null> {
  return one<{ supply_normalized: string | null; divisible: 0 | 1 | null; locked: 0 | 1 | null }>(
    db,
    `WITH identity AS (
       SELECT coalesce(
         (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
         (SELECT asset_id FROM assets WHERE asset_longname=?2)
       ) asset_id
     )
     SELECT state.supply_normalized,state.divisible,state.locked
       FROM identity JOIN assets state ON state.asset_id=identity.asset_id`,
    asset.toUpperCase(),
    asset,
  );
}

export function listCoreSubassets(
  db: D1Database,
  parent: string,
  limit: number,
  offset: number,
): Promise<AssetListRow[]> {
  return q<AssetListRow>(
    db,
    `WITH page AS (
       SELECT asset_id FROM assets
        WHERE asset_longname>=?1 AND asset_longname<?2
        ORDER BY first_issuance_block_index DESC,asset_id DESC LIMIT ?3 OFFSET ?4
     )
     SELECT dictionary.asset,asset.asset_longname,asset.divisible,asset.locked,issuer.address issuer,
       asset.first_issuance_block_index
     FROM page JOIN assets asset ON asset.asset_id=page.asset_id
     JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
     LEFT JOIN address_dictionary issuer ON issuer.address_id=asset.issuer_id
     ORDER BY asset.first_issuance_block_index DESC,asset.asset_id DESC`,
    `${parent}.`,
    `${parent}/`,
    limit,
    offset,
  );
}

export function coreAssetCohort(
  db: D1Database,
  asset: string,
  limit: number,
  excludeCollection: string | null = null,
): Promise<AssetCohortRow[]> {
  const collectionFilter = excludeCollection
    ? `AND NOT EXISTS (
         SELECT 1 FROM entity_dictionary entity JOIN tags tag ON tag.entity_id=entity.entity_id
          WHERE entity.entity_type='asset' AND entity.entity_key=other_dictionary.asset AND tag.tag=?3
       )`
    : "";
  const limitBind = excludeCollection ? "?4" : "?3";
  const args = excludeCollection ? [asset, asset, excludeCollection, limit] : [asset, asset, limit];
  return q<AssetCohortRow>(
    db,
    `WITH subject AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
     subject_holders AS MATERIALIZED (
       SELECT address_id FROM balances WHERE asset_id=(SELECT asset_id FROM subject)
         AND address_id IS NOT NULL AND CAST(quantity AS INTEGER)>0
     )
     SELECT other_dictionary.asset,other_state.asset_longname,COUNT(*) shared,
       ROUND(100.0*COUNT(*)/NULLIF((SELECT COUNT(*) FROM subject_holders),0),1) pct
     FROM subject_holders subject_balance
     CROSS JOIN balances other_balance INDEXED BY idx_balances_address_asset
       ON other_balance.address_id=subject_balance.address_id
     JOIN asset_dictionary other_dictionary ON other_dictionary.asset_id=other_balance.asset_id
     LEFT JOIN assets other_state ON other_state.asset_id=other_balance.asset_id
     WHERE other_dictionary.asset<>?2 AND other_dictionary.asset<>'XCP'
       AND CAST(other_balance.quantity AS INTEGER)>0 ${collectionFilter}
     GROUP BY other_balance.asset_id ORDER BY shared DESC,other_dictionary.asset ASC LIMIT ${limitBind}`,
    ...args,
  );
}

export function coreAssetRelated(
  db: D1Database,
  asset: string,
  collection: string | null,
  collectionLimit: number,
  cohortLimit: number,
): Promise<(AssetCohortRow & { in_collection: number })[]> {
  return q<AssetCohortRow & { in_collection: number }>(
    db,
    `WITH subject AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
     subject_holders AS MATERIALIZED (
       SELECT address_id FROM balances WHERE asset_id=(SELECT asset_id FROM subject)
         AND address_id IS NOT NULL AND CAST(quantity AS INTEGER)>0
     ), overlap AS MATERIALIZED (
       SELECT other_balance.asset_id,COUNT(*) shared
       FROM subject_holders subject_balance
       CROSS JOIN balances other_balance INDEXED BY idx_balances_address_asset
         ON other_balance.address_id=subject_balance.address_id
       WHERE other_balance.asset_id<>(SELECT asset_id FROM subject)
         AND CAST(other_balance.quantity AS INTEGER)>0
       GROUP BY other_balance.asset_id
     ), related AS (
       SELECT dictionary.asset,state.asset_longname,overlap.shared,
         ROUND(100.0*overlap.shared/NULLIF((SELECT COUNT(*) FROM subject_holders),0),1) pct,
         ?2 IS NOT NULL AND EXISTS (
           SELECT 1 FROM entity_dictionary entity JOIN tags tag ON tag.entity_id=entity.entity_id
           WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tag.tag=?2
         ) in_collection
       FROM overlap JOIN asset_dictionary dictionary ON dictionary.asset_id=overlap.asset_id
       LEFT JOIN assets state ON state.asset_id=overlap.asset_id
       WHERE dictionary.asset<>'XCP'
     ), ranked AS (
       SELECT *,ROW_NUMBER() OVER (
         PARTITION BY in_collection ORDER BY shared DESC,asset ASC
       ) position FROM related
     )
     SELECT asset,asset_longname,shared,pct,in_collection FROM ranked
     WHERE (in_collection=1 AND position<=?3) OR (in_collection=0 AND position<=?4)
     ORDER BY in_collection DESC,position`,
    asset,
    collection,
    collectionLimit,
    cohortLimit,
  );
}

export function coreAssetActivityVenues(
  db: D1Database,
  asset: string,
): Promise<{ month: string; orders: number; dispensers: number }[]> {
  return q(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1)
     SELECT month,SUM(CASE WHEN kind IN ('match','order') THEN n ELSE 0 END) orders,
       SUM(CASE WHEN kind IN ('dispense','dispenser') THEN n ELSE 0 END) dispensers
     FROM (
       SELECT strftime('%Y-%m',block_time,'unixepoch') month,'match' kind,COUNT(*) n FROM order_matches
        WHERE forward_asset_id=(SELECT asset_id FROM identity) OR backward_asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'order',COUNT(*) FROM orders
        WHERE give_asset_id=(SELECT asset_id FROM identity) OR get_asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'dispense',COUNT(*) FROM dispenses
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'dispenser',COUNT(*) FROM dispensers
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
     ) GROUP BY month`,
    asset,
  );
}

export function coreAssetActivityFlows(
  db: D1Database,
  asset: string,
): Promise<{ month: string; sends: number; supply: number }[]> {
  return q(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1)
     SELECT month,SUM(CASE WHEN kind='send' THEN n ELSE 0 END) sends,
       SUM(CASE WHEN kind IN ('issuance','fairmint','destruction','dividend') THEN n ELSE 0 END) supply
     FROM (
       SELECT strftime('%Y-%m',block_time,'unixepoch') month,'send' kind,COUNT(*) n FROM sends
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'issuance',COUNT(*) FROM issuances
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'fairmint',COUNT(*) FROM fairmints
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'destruction',COUNT(*) FROM destructions
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'),'dividend',COUNT(*) FROM dividends
        WHERE asset_id=(SELECT asset_id FROM identity) GROUP BY 1
     ) GROUP BY month`,
    asset,
  );
}

export function coreAssetActiveUsers(db: D1Database, asset: string, limit: number): Promise<AssetActiveUser[]> {
  return q<AssetActiveUser>(
    db,
    `SELECT address.address,
       SUM(CASE WHEN event.direction=1 THEN 1 ELSE 0 END) credits,
       SUM(CASE WHEN event.direction=0 THEN 1 ELSE 0 END) debits,
       COUNT(*) activity
     FROM ledger_events event JOIN address_dictionary address ON address.address_id=event.address_id
     WHERE event.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
     GROUP BY event.address_id ORDER BY activity DESC,address.address ASC LIMIT ?2`,
    asset,
    limit,
  );
}

export function coreAssetHolderCount(db: D1Database, asset: string): Promise<number> {
  return one<{ holder_count: number }>(
    db,
    `SELECT COUNT(*) holder_count FROM balances
      WHERE asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1)
        AND CAST(quantity AS INTEGER)>0`,
    asset,
  ).then((row) => row?.holder_count ?? 0);
}

export function coreAssetAccounting(
  db: D1Database,
  asset: string,
): Promise<Omit<AssetAccounting, "holder_count"> | null> {
  return one<Omit<AssetAccounting, "holder_count">>(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1)
     SELECT
       COALESCE(
         (SELECT supply FROM assets WHERE asset_id=(SELECT asset_id FROM identity)),
         CAST((SELECT coalesce(SUM(CAST(quantity AS INTEGER)),0) FROM issuances
                WHERE asset_id=(SELECT asset_id FROM identity) AND status LIKE 'valid%')
            - (SELECT coalesce(SUM(CAST(quantity AS INTEGER)),0) FROM destructions
                WHERE asset_id=(SELECT asset_id FROM identity) AND status LIKE 'valid%') AS TEXT)
       ) supply,
       CAST((SELECT coalesce(SUM(CAST(balance.quantity AS INTEGER)),0)
               FROM address_signals signal INDEXED BY idx_address_signals_burns
               JOIN balances balance INDEXED BY idx_balances_address_asset
                 ON balance.address_id=signal.address_id
                AND balance.asset_id=(SELECT asset_id FROM identity)
              WHERE signal.is_burn=1) AS TEXT) burned,
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
            assets.divisible,assets.locked,signal.holders holder_count,signal.holders,signal.top1_pct,signal.trades,
            signal.self_trade_pct,signal.first_trade_blk,signal.last_trade_blk,signal.dispenses,
            signal.dispense_btc,signal.low_quality,signal.holder_breadth,signal.pct_creator_holders,
            signal.burned_pct,signal.distinct_traders,signal.distinct_dispensers,
            max(0,tip.block_index-coalesce(assets.first_issuance_block_index,tip.block_index)) age_blocks,
            signal.avg_holder_dex,signal.recent_events,
            max(0,tip.block_index-signal.last_trade_blk) recency_blocks,
            signal.max_dispense_btc,signal.max_trade_xcp,signal.supply,signal.max_realized_usd,
            signal.distinct_dispense_buyers,signal.max_dispense_btc_clean,signal.emblem_trades,
            signal.graph_trust,signal.graph_distrust,signal.holder_cohesion,
            signal.cohesion_edges,signal.cohesion_strong,signal.active_trade_months,
            signal.last_trade_time,signal.clean_realized_usd,signal.distinct_paid_buyers,
            signal.clean_active_trade_months,signal.market_venue_count,
            rating.rating rating_value,rating.rank_position rating_rank,rating.population rating_population,
            rating.active_months_score rating_active_months_score,
            rating.buyer_breadth_score rating_buyer_breadth_score,
            rating.realized_value_score rating_realized_value_score,
            rating.calculated_at rating_calculated_at,rating.model_version rating_model_version,
            outlook.score activity_outlook_score,
            outlook.rank_position activity_outlook_rank,outlook.population activity_outlook_population,
            outlook.calculated_at activity_outlook_calculated_at
       FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       LEFT JOIN assets ON assets.asset_id=signal.asset_id
       LEFT JOIN address_dictionary issuer ON issuer.address_id=signal.issuer_id
       LEFT JOIN asset_ratings rating ON rating.asset_id=signal.asset_id
       LEFT JOIN asset_activity_outlook outlook ON outlook.asset_id=signal.asset_id
       CROSS JOIN (SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1) tip
      WHERE dictionary.asset=?1`,
    asset,
  );
}

export async function coreRatingsOverview(db: D1Database) {
  const [meta, distribution, examples] = await Promise.all([
    one<{ model_version: number; calculated_at: number; population: number }>(
      db,
      `SELECT MAX(model_version) model_version,MAX(calculated_at) calculated_at,COUNT(*) population
       FROM asset_ratings`,
    ),
    q<{ rating: number; count: number }>(
      db,
      `SELECT ROUND(rating) rating,COUNT(*) count FROM asset_ratings GROUP BY ROUND(rating) ORDER BY rating`,
    ),
    q<{ asset: string; asset_longname: string | null; rating: number; rank: number }>(
      db,
      `SELECT dictionary.asset,asset.asset_longname,ROUND(rating.rating,1) rating,rating.rank_position rank
       FROM asset_ratings rating
       JOIN asset_dictionary dictionary ON dictionary.asset_id=rating.asset_id
       LEFT JOIN assets asset ON asset.asset_id=rating.asset_id
       WHERE rating.rank_position IN (
         1,ROUND(rating.population*0.1),ROUND(rating.population*0.2),ROUND(rating.population*0.3),
         ROUND(rating.population*0.4),ROUND(rating.population*0.5),ROUND(rating.population*0.6),
         ROUND(rating.population*0.7),ROUND(rating.population*0.8),ROUND(rating.population*0.9),rating.population
       ) ORDER BY rating.rank_position`,
    ),
  ]);
  return { meta, distribution, examples };
}

export function coreAssetQualitySignals(
  db: D1Database,
  asset: string,
): Promise<Pick<
  AssetSignalsRow,
  | "holders"
  | "top1_pct"
  | "trades"
  | "self_trade_pct"
  | "low_quality"
  | "holder_breadth"
  | "pct_creator_holders"
  | "burned_pct"
> | null> {
  return one(
    db,
    `SELECT signal.holders,signal.top1_pct,signal.trades,signal.self_trade_pct,signal.low_quality,
      signal.holder_breadth,signal.pct_creator_holders,signal.burned_pct
      FROM asset_dictionary dictionary JOIN asset_signals signal ON signal.asset_id=dictionary.asset_id
      WHERE dictionary.asset=?1`,
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
          last AS (
            SELECT usd_value,quantity,block_time FROM trades
            WHERE asset_id=(SELECT asset_id FROM identity) AND usd_value IS NOT NULL AND quantity>0
              AND (buyer_id IS NULL OR seller_id IS NULL OR buyer_id<>seller_id)
            ORDER BY block_time DESC LIMIT 1)
     SELECT (SELECT SUM(usd_value) FROM trades WHERE asset_id=(SELECT asset_id FROM identity)
              AND (buyer_id IS NULL OR seller_id IS NULL OR buyer_id<>seller_id)) realized_usd,
            (SELECT usd_value/quantity FROM last) last_price_usd,
            (SELECT block_time FROM last) last_sale_time`,
    asset,
  );
}

export interface AssetReferencePrice {
  price_usd: number;
  price_as_of: number;
  method: "external_aggregate" | "median_daily_trades_90d";
  trade_count: number | null;
  trade_days: number | null;
  buyer_count: number | null;
  volume_usd: number | null;
}

/**
 * A current mark suitable for capitalization, which is intentionally stricter than Last price.
 * XCP uses the current external aggregate. Other assets require 3 independent buyers on 3 days and
 * $100 of clean executions inside 90 days; the mark is the median of daily volume-weighted prices.
 */
export function coreAssetReferencePrice(db: D1Database, asset: string): Promise<AssetReferencePrice | null> {
  return one<AssetReferencePrice>(
    db,
    `WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
      clean AS (
        SELECT date(t.block_time,'unixepoch') day,t.buyer_id,t.usd_value,t.quantity,t.block_time
        FROM trades t JOIN asset_signals signal ON signal.asset_id=t.asset_id
        WHERE t.asset_id=(SELECT asset_id FROM identity) AND signal.low_quality=0
          AND t.block_time>=unixepoch('now','-90 days') AND t.usd_value>0 AND t.quantity>0 AND t.total>0
          AND t.buyer_id IS NOT NULL AND t.seller_id IS NOT NULL AND t.buyer_id<>t.seller_id
          AND (t.venue='dex' OR (t.venue='dispense' AND t.sale_class='single')
            OR (t.venue='otc' AND t.sale_class IN ('likely','corroborated'))
            OR (t.venue='emblem' AND t.sale_class='real'))
      ), evidence AS (
        SELECT COUNT(*) trade_count,COUNT(DISTINCT day) trade_days,COUNT(DISTINCT buyer_id) buyer_count,
          SUM(usd_value) volume_usd,MAX(block_time) price_as_of FROM clean
      ), daily AS (
        SELECT day,SUM(usd_value)/SUM(quantity) daily_price FROM clean GROUP BY day
      ), ranked AS (
        SELECT daily_price,ROW_NUMBER() OVER(ORDER BY daily_price) rn,COUNT(*) OVER() n FROM daily
      ), trade_mark AS (
        SELECT AVG(daily_price) price_usd FROM ranked WHERE rn IN ((n+1)/2,(n+2)/2)
      ), external_mark AS (
        SELECT usd price_usd,CAST(strftime('%s',day) AS INTEGER) price_as_of
        FROM prices WHERE currency=?1 AND day>=date('now','-3 days') ORDER BY day DESC LIMIT 1
      )
      SELECT price_usd,price_as_of,'external_aggregate' method,
        NULL trade_count,NULL trade_days,NULL buyer_count,NULL volume_usd FROM external_mark WHERE ?1='XCP'
      UNION ALL
      SELECT mark.price_usd,e.price_as_of,'median_daily_trades_90d' method,
        e.trade_count,e.trade_days,e.buyer_count,e.volume_usd
      FROM trade_mark mark CROSS JOIN evidence e
      WHERE ?1<>'XCP' AND e.trade_days>=3 AND e.buyer_count>=3 AND e.volume_usd>=100
      LIMIT 1`,
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
            COALESCE(
              (SELECT signal.assets_controlled FROM issuer
                JOIN address_signals signal ON signal.address_id=issuer.address_id),
              (SELECT COUNT(*) FROM assets
                WHERE issuer_id=(SELECT address_id FROM issuer) OR owner_id=(SELECT address_id FROM issuer))
            ) from_issuer
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
    `ORDER BY ${collectionMembershipPrioritySql("tags.source")}`,
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
                 WHEN signal.is_emblem_vault=1 THEN 'vault'
                 WHEN balance.address_id=state.issuer_id THEN 'issuer'
                 WHEN balance.address_id=state.owner_id THEN 'owner' END role
       FROM balances balance
       LEFT JOIN address_dictionary address ON address.address_id=balance.address_id
       LEFT JOIN address_signals signal ON signal.address_id=balance.address_id
       LEFT JOIN assets state ON state.asset_id=balance.asset_id
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

/** Longname + divisibility for a small set of asset symbols — what the mempool flattener needs to
 *  render rows without verbose enrichment. Symbols the mirror has never seen (e.g. an asset whose
 *  own issuance is still unconfirmed) are simply absent. Capped to one D1 statement's bind budget;
 *  a live mempool never approaches that many distinct assets. */
export interface AssetDisplayFacts {
  asset: string;
  asset_longname: string | null;
  divisible: number;
}
export function coreAssetDisplayFacts(db: D1Database, assets: string[]): Promise<AssetDisplayFacts[]> {
  const symbols = assets.slice(0, 90);
  if (symbols.length === 0) return Promise.resolve([]);
  return q<AssetDisplayFacts>(
    db,
    `SELECT dictionary.asset, details.asset_longname, COALESCE(details.divisible,0) divisible
       FROM asset_dictionary dictionary
       LEFT JOIN assets details ON details.asset_id=dictionary.asset_id
      WHERE dictionary.asset IN (${symbols.map(() => "?").join(",")})`,
    ...symbols,
  );
}

/** Daily holder-count series reconstructed from the 1:1 credit/debit ledger: per (address, day) net
 *  deltas, running per-address balances, then the day the address enters (0→positive) or leaves
 *  (positive→0) the holder set. ~3s on the heaviest asset (1.2M ledger rows) — served from a
 *  six-hour cache. UTXO-attached balances carry no address and sit outside the series. */
export function assetHolderHistory(db: D1Database, asset: string): Promise<{ day: number; holders: number }[]> {
  return q<{ day: number; holders: number }>(
    db,
    `WITH daily AS (
       SELECT ledger.address_id, blocks.block_time/86400 day,
         SUM(CASE WHEN ledger.direction=1 THEN CAST(ledger.quantity AS INTEGER)
                  ELSE -CAST(ledger.quantity AS INTEGER) END) delta
       FROM ledger_events ledger
       JOIN blocks ON blocks.block_index=ledger.block_index
       WHERE ledger.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
         AND ledger.address_id IS NOT NULL
       GROUP BY ledger.address_id, day
     ), runs AS (
       SELECT day,
         SUM(delta) OVER (PARTITION BY address_id ORDER BY day) cum,
         SUM(delta) OVER (PARTITION BY address_id ORDER BY day) - delta prev
       FROM daily
     ), transitions AS (
       SELECT day, SUM((cum>0) - (prev>0)) net FROM runs GROUP BY day
     )
     SELECT day, SUM(net) OVER (ORDER BY day) holders FROM transitions ORDER BY day`,
    asset,
  );
}
