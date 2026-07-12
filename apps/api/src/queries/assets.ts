/**
 * Asset queries — the only place that knows the SQL behind the asset surfaces (index, detail,
 * featured, holder-makeup, per-asset record tabs, cohort, quality). Handlers call these and wrap the
 * result in the envelope. Wire row shapes come from @xcp/shared; internal signal rows from ../schema.
 *
 * The config-driven reputation SQL (rawSqlExpr output + tier thresholds) is passed IN as opaque string
 * fragments by the handler — this file never imports the reputation config, and never builds a score.
 * The per-asset orders tab reuses the records-owned ORDER_SELECT projection (a query→query import); the
 * active-balance predicate is written inline where it's needed.
 */
import type {
  AssetIndexRow,
  FeaturedAsset,
  AssetCohortRow,
  BalanceRow,
  AssetListRow,
  HolderTierRow,
  HolderArchetypes,
  AssetReviewDistribution,
  AssetReviewTopRow,
  AssetSales,
  AssetActiveUser,
} from "@xcp/shared/assets";
import type {
  SendRow,
  IssuanceRow,
  DispenserRow,
  DispenseRow,
  OrderRow,
  FairmintRow,
  DividendRow,
  DestructionRow,
  PoolRow,
  PoolMatchRow,
} from "@xcp/shared/records";
import type { AssetSignalsRow, AssetRow } from "#api/schema";
import { q, one } from "#api/db";
import { ORDER_SELECT, DISPENSE_SELECT, FAIRMINT_SELECT } from "#api/queries/records";

/* ---------- index + search ---------- */

export interface AssetListFilter {
  query?: string;
  limit: number;
  offset: number;
  sort?: string; // whitelist key (see ASSET_SORTS); ignored on the search path (relevance wins)
  dir?: "asc" | "desc";
}

// Sortable columns for the browse path — a fixed whitelist maps each key to a SAFE ORDER BY
// expression (never interpolate user input into SQL). Default: newest issuance first.
const ASSET_SORTS: Record<string, string> = {
  created: "a.last_issuance_block_index",
  supply: "CAST(a.supply_normalized AS REAL)",
  asset: "a.asset",
};

// The projected columns, shared by the browse query and each search probe.
const ASSET_LIST_SELECT = `SELECT a.asset, a.asset_longname, a.type, a.issuer, a.owner, a.divisible, a.locked, a.supply_normalized,
            substr(a.description,1,140) description,
            EXISTS(SELECT 1 FROM tags t WHERE t.entity_type='asset' AND t.entity_id=a.asset AND t.tag='stamp') stamp,
            a.first_issuance_block_time, a.last_issuance_block_index
     FROM assets a`;

// Upper bound for a sargable prefix range: the prefix with its last char incremented, so
// `col >= prefix AND col < bound` matches exactly the prefix while riding the column's index.
// (LIKE's default case-insensitive collation blocks the index prefix optimization, and the old
// OR-across-columns form forced a full 252k-row scan — measured 2.1s cold before this rewrite.)
const nextPrefix = (p: string) => p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);

/** Asset index / search. description is clamped to a single line (the list only shows one), mime_type omitted. */
export function listAssets(db: D1Database, f: AssetListFilter): Promise<AssetIndexRow[]> {
  const query = (f.query || "").trim();
  if (!query) {
    const col = ASSET_SORTS[f.sort ?? ""] ?? "a.last_issuance_block_index";
    const dir = f.dir === "asc" ? "ASC" : "DESC";
    return q<AssetIndexRow>(db, `${ASSET_LIST_SELECT} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`, f.limit, f.offset);
  }
  // Three indexed range probes UNIONed: asset (stored uppercase), longname as-typed, longname
  // lowercased — preserving the old LIKE's case-insensitivity for the common all-lower longnames.
  const up = query.toUpperCase(),
    low = query.toLowerCase();
  return q<AssetIndexRow>(
    db,
    `${ASSET_LIST_SELECT} WHERE a.asset >= ?1 AND a.asset < ?2
     UNION ${ASSET_LIST_SELECT} WHERE a.asset_longname >= ?3 AND a.asset_longname < ?4
     UNION ${ASSET_LIST_SELECT} WHERE a.asset_longname >= ?5 AND a.asset_longname < ?6
     ORDER BY last_issuance_block_index DESC LIMIT ?7 OFFSET ?8`,
    up,
    nextPrefix(up),
    query,
    nextPrefix(query),
    low,
    nextPrefix(low),
    f.limit,
    f.offset,
  );
}

/** Featured grid — highest-quality market assets with art. `expr` is the config-driven raw-score SQL. */
export function featuredAssets(db: D1Database, expr: string, limit: number): Promise<FeaturedAsset[]> {
  return q<FeaturedAsset>(
    db,
    `SELECT s.asset, s.asset_longname, ROUND((${expr}),1) score
     FROM asset_signals s JOIN tags t ON t.entity_type='asset' AND t.entity_id=s.asset AND t.tag='has_media'
     WHERE (s.trades>0 OR s.dispenses>0) AND COALESCE(s.low_quality,0)=0
     ORDER BY (${expr}) DESC LIMIT ?`,
    limit,
  );
}

/* ---------- detail (business logic lives in the handler; each statement is a function here) ---------- */

/** Full assets row by asset name or longname. */
export function getAsset(db: D1Database, asset: string): Promise<AssetRow | null> {
  return one<AssetRow>(db, `SELECT * FROM assets WHERE asset=? OR asset_longname=?`, asset.toUpperCase(), asset);
}

/** Distinct address holders with a positive balance of an asset. */
export async function holderCount(db: D1Database, asset: string): Promise<number> {
  const r = await one<{ c: number }>(
    db,
    `SELECT COUNT(*) c FROM balances WHERE asset=? AND CAST(quantity AS INTEGER)>0`,
    asset,
  );
  return r?.c ?? 0;
}

/** Native XCP supply = proof-of-burn minus everything destroyed (destructions + issuance/sweep/dividend fees).
 *  Returned as an exact int64 from SQLite; the handler normalizes. */
export function xcpNativeSupply(db: D1Database): Promise<{ supply: string } | null> {
  return one<{ supply: string }>(db, `SELECT xcp_supply supply FROM network_stats_snapshot WHERE singleton=1`);
}

/** The one-line issuance brief an offer storefront shows about its asset: total supply + locked. */
export function assetBrief(
  db: D1Database,
  asset: string,
): Promise<{ supply_normalized: string | null; divisible: 0 | 1 | null; locked: 0 | 1 | null } | null> {
  return one<{ supply_normalized: string | null; divisible: 0 | 1 | null; locked: 0 | 1 | null }>(
    db,
    `SELECT supply_normalized, divisible, locked FROM assets WHERE asset=?`,
    asset,
  );
}

/** Precomputed asset-quality signal row (feeds the composed score). */
export function assetSignalsRow(db: D1Database, asset: string): Promise<AssetSignalsRow | null> {
  return one<AssetSignalsRow>(db, `SELECT * FROM asset_signals WHERE asset=?`, asset);
}

/** Lifetime money stats from the unified trades ledger: realized USD across every venue plus the most
 *  recent USD-known sale. Both reads ride idx_trades_asset(asset, block_time DESC); the LIMIT 1 probe
 *  early-terminates at the newest priced row. */
export function assetSales(db: D1Database, asset: string): Promise<AssetSales | null> {
  return one<AssetSales>(
    db,
    `WITH last AS (SELECT usd_value, quantity, block_time FROM trades
                   WHERE asset=?1 AND usd_value IS NOT NULL ORDER BY block_time DESC LIMIT 1)
     SELECT (SELECT SUM(usd_value) FROM trades WHERE asset=?1) realized_usd,
            (SELECT CASE WHEN quantity > 0 THEN usd_value / quantity END FROM last) last_price_usd,
            (SELECT block_time FROM last) last_sale_time`,
    asset,
  );
}

/** Categorical tags for an asset (stamp/src20/grail/behavioral labels). */
export async function assetTags(db: D1Database, asset: string): Promise<string[]> {
  const rows = await q<{ tag: string }>(db, `SELECT tag FROM tags WHERE entity_type='asset' AND entity_id=?`, asset);
  return rows.map((t) => String(t.tag));
}

/* ---------- holder makeup ---------- */

/** Chain tip (max block) — substituted into the address-decay term of the reputation expression. */
export async function chainTip(db: D1Database): Promise<number> {
  const r = await one<{ m: number }>(db, `SELECT MAX(block_index) m FROM blocks`);
  return Number(r?.m) || 0;
}

/** Holder base bucketed by reputation tier. `expr` is the config-driven raw-score SQL over address_signals;
 *  `og`/`est`/`act` are the tier raw cutoffs — all interpolated (config-sourced, not user input). */
export function holderTiers(
  db: D1Database,
  asset: string,
  expr: string,
  og: number,
  est: number,
  act: number,
): Promise<HolderTierRow[]> {
  return q<HolderTierRow>(
    db,
    `WITH h AS (
       SELECT CAST(b.quantity AS REAL) q, sg.is_exchange xch, sg.is_deposit dep,
         sg.is_emblem_vault vlt, sg.is_burn brn, sg.likely_service svc, (${expr}) raw
       FROM balances b JOIN address_signals sg ON sg.address=b.holder
       WHERE b.asset=? AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0),
     tot AS (SELECT SUM(q) s FROM h)
     SELECT CASE WHEN xch=1 THEN 'Exchange' WHEN dep=1 THEN 'Deposit' WHEN vlt=1 THEN 'Vault'
                 WHEN brn=1 THEN 'Burn' WHEN svc=1 THEN 'Service'
                 WHEN raw>=${og} THEN 'OG' WHEN raw>=${est} THEN 'Established'
                 WHEN raw>=${act} THEN 'Active' ELSE 'Casual' END tier,
       COUNT(*) holders, ROUND(100.0*SUM(q)/(SELECT s FROM tot),1) pct_supply
     FROM h GROUP BY tier`,
    asset,
  );
}

/** Archetype counts among an asset's holders (creators / whales / collectors) + total. */
export function holderArchetypes(db: D1Database, asset: string): Promise<HolderArchetypes | null> {
  return one<HolderArchetypes>(
    db,
    `SELECT SUM(CASE WHEN sg.survived_assets>=20 THEN 1 ELSE 0 END) creators,
            SUM(CASE WHEN sg.assets_held>=500 THEN 1 ELSE 0 END) whales,
            SUM(CASE WHEN sg.assets_held>=100 THEN 1 ELSE 0 END) collectors,
            COUNT(*) holders
     FROM balances b JOIN address_signals sg ON sg.address=b.holder
     WHERE b.asset=? AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0`,
    asset,
  );
}

/** Top-holder concentration (top1_pct from the precomputed signal). */
export function assetTop1Pct(db: D1Database, asset: string): Promise<{ t: number } | null> {
  return one<{ t: number }>(db, `SELECT ROUND(top1_pct,1) t FROM asset_signals WHERE asset=?`, asset);
}

/* ---------- asset-quality calibration (parallel to /v2/reputation/review) ---------- */

/** Population quality distribution over asset_signals (`expr` = config-driven raw-score SQL). */
export function assetReviewDistribution(db: D1Database, expr: string): Promise<AssetReviewDistribution | null> {
  return one<AssetReviewDistribution>(
    db,
    `WITH r AS (SELECT (${expr}) raw FROM asset_signals)
     SELECT COUNT(*) n, ROUND(AVG(raw),2) mean, ROUND(MAX(raw),2) max, ROUND(MIN(raw),2) min,
       SUM(CASE WHEN raw>=16 THEN 1 ELSE 0 END) top1pct, SUM(CASE WHEN raw>=9 THEN 1 ELSE 0 END) top10pct FROM r`,
  );
}

/** Top-20 assets by raw quality — face-validity check after a weight change. */
export function assetReviewTop(db: D1Database, expr: string): Promise<AssetReviewTopRow[]> {
  return q<AssetReviewTopRow>(
    db,
    `SELECT asset, asset_longname, holders, trades, ROUND((${expr}),2) raw FROM asset_signals ORDER BY (${expr}) DESC LIMIT 20`,
  );
}

/** One convergent-validity group (v=1 vaulted-tagged, v=0 not) — count/mean/median of the raw quality expr. */
export interface AssetValidationGroup {
  v: 0 | 1;
  n: number;
  mean: number;
  median: number;
}

/**
 * Live convergent-validity check: over MARKET assets (ever traded or dispensed), compare the raw quality-score
 * distribution of Emblem-vaulted-tagged assets vs the rest (H4: people only wrap good assets, so vaulted should
 * score markedly higher). Median via a window rank (SQLite integer arithmetic picks the middle 1 or 2 rows).
 */
export function assetValidation(db: D1Database, expr: string): Promise<AssetValidationGroup[]> {
  return q<AssetValidationGroup>(
    db,
    `WITH m AS (
       SELECT (${expr}) raw,
         CASE WHEN EXISTS (SELECT 1 FROM tags t WHERE t.entity_type='asset' AND t.entity_id=s.asset AND t.tag='vaulted') THEN 1 ELSE 0 END v
       FROM asset_signals s WHERE s.trades>0 OR s.dispenses>0
     ),
     r AS (
       SELECT v, raw, ROW_NUMBER() OVER (PARTITION BY v ORDER BY raw) rn, COUNT(*) OVER (PARTITION BY v) cnt FROM m
     )
     SELECT v, MAX(cnt) n, ROUND(AVG(raw),3) mean,
       ROUND(AVG(CASE WHEN rn IN ((cnt+1)/2, (cnt/2)+1) THEN raw END),3) median
     FROM r GROUP BY v`,
  );
}

/* ---------- per-asset record tabs ---------- */

/** Holders of an asset, largest first. */
export function listAssetBalances(db: D1Database, asset: string, limit: number, offset: number): Promise<BalanceRow[]> {
  return q<BalanceRow>(
    db,
    `SELECT b.holder, b.holder_type, b.quantity, b.quantity_normalized,
            CASE WHEN s.is_burn=1 THEN 'burn' WHEN s.is_exchange=1 THEN 'exchange'
                 WHEN s.is_emblem_vault=1 THEN 'vault' WHEN s.is_deposit=1 THEN 'deposit'
                 WHEN s.likely_service=1 THEN 'service' WHEN s.survived_assets>=20 THEN 'creator'
                 WHEN s.assets_held>=500 THEN 'whale' WHEN s.assets_held>=100 THEN 'collector'
                 END role
     FROM balances b LEFT JOIN address_signals s ON s.address=b.holder
     WHERE b.asset=? AND CAST(b.quantity AS INTEGER)>0 ORDER BY CAST(b.quantity AS INTEGER) DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** An asset's issuance history (subset of IssuanceRow columns). */
export function listAssetIssuances(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<IssuanceRow[]> {
  return q<IssuanceRow>(
    db,
    `SELECT tx_hash, block_index, block_time, source, issuer, transfer, quantity_normalized, description, asset_events, status
     FROM issuances WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** An asset's sends. */
export function listAssetSends(db: D1Database, asset: string, limit: number, offset: number): Promise<SendRow[]> {
  return q<SendRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,destination,asset,quantity_normalized,send_type,status FROM sends WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** An asset's dispensers, with the source operator's precomputed track-record score for comparability. */
export function listAssetDispensers(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DispenserRow[]> {
  return q<DispenserRow>(
    db,
    `SELECT d.tx_hash,d.block_index,d.block_time,d.source,d.asset,d.give_quantity_normalized,d.give_remaining_normalized,
            d.satoshirate,d.satoshirate_normalized,d.dispense_count,d.status, ROUND(COALESCE(sg.disp_trust,0),1) operator_trust
     FROM dispensers d LEFT JOIN address_signals sg ON sg.address=d.source
     WHERE d.asset=? ORDER BY d.block_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** An asset's dispenses. */
export function listAssetDispenses(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DispenseRow[]> {
  return q<DispenseRow>(
    db,
    `${DISPENSE_SELECT} WHERE d.asset=? ORDER BY d.block_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** Orders touching an asset on either side — the records-owned ORDER_SELECT projection (normalized give/get). */
export function listAssetOrders(db: D1Database, asset: string, limit: number, offset: number): Promise<OrderRow[]> {
  return q<OrderRow>(
    db,
    `${ORDER_SELECT} WHERE o.give_asset=? OR o.get_asset=? ORDER BY o.block_index DESC LIMIT ? OFFSET ?`,
    asset,
    asset,
    limit,
    offset,
  );
}

/** An asset's fairmints (the global /v2/fairmints feed projection, filtered to one asset). */
export function listAssetFairmints(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<FairmintRow[]> {
  return q<FairmintRow>(
    db,
    `${FAIRMINT_SELECT} WHERE f.asset=? ORDER BY f.block_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** Dividends touching an asset on either side — paid ON it (asset) or paid IN it (dividend_asset). */
export function listAssetDividends(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DividendRow[]> {
  return q<DividendRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,asset,dividend_asset,quantity_per_unit_normalized,status
     FROM dividends WHERE asset=? OR dividend_asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset,
    asset,
    limit,
    offset,
  );
}

/** An asset's destructions (the global /v2/destructions feed projection, filtered to one asset). */
export function listAssetDestructions(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<DestructionRow[]> {
  return q<DestructionRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,asset,quantity_normalized,tag,status
     FROM destructions WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset,
    limit,
    offset,
  );
}

/** AMM pools the asset participates in — as either reserve leg, or as the pool's LP token. */
export function listAssetPools(db: D1Database, asset: string, limit: number, offset: number): Promise<PoolRow[]> {
  return q<PoolRow>(
    db,
    `SELECT lp_asset,pair,asset_a,asset_b,reserve_a,reserve_b,lp_supply,price,status,block_index
     FROM pools WHERE asset_a=?1 OR asset_b=?1 OR lp_asset=?1 ORDER BY block_index DESC LIMIT ?2 OFFSET ?3`,
    asset,
    limit,
    offset,
  );
}

/** AMM swaps touching the asset on either leg (POOL_MATCH events carry no lp_asset, so match on the legs). */
export function listAssetPoolMatches(
  db: D1Database,
  asset: string,
  limit: number,
  offset: number,
): Promise<PoolMatchRow[]> {
  return q<PoolMatchRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,lp_asset,pair,forward_asset,forward_quantity,backward_asset,backward_quantity
     FROM pool_matches WHERE forward_asset=?1 OR backward_asset=?1 ORDER BY block_index DESC LIMIT ?2 OFFSET ?3`,
    asset,
    limit,
    offset,
  );
}

/** Subassets of an asset (longname prefix match). */
export function listSubassets(db: D1Database, asset: string, limit: number, offset: number): Promise<AssetListRow[]> {
  return q<AssetListRow>(
    db,
    `SELECT asset, asset_longname, divisible, locked, issuer, first_issuance_block_index FROM assets
     WHERE asset_longname LIKE ? ORDER BY first_issuance_block_index DESC LIMIT ? OFFSET ?`,
    asset + ".%",
    limit,
    offset,
  );
}

/** The asset's collection tag + project site. Considers both collection sources — the curated pepe.wtf
 *  feed (source='collection') and the broader tokenscan directory (source='tokenscan', whose meta carries
 *  the project site) — preferring pepe.wtf when an asset is in both. This is what lights the green
 *  "Part of …" band, so tokenscan-only projects (Rare Pigeons, Age of Chains, …) now show it too. */
export async function assetCollection(
  db: D1Database,
  asset: string,
): Promise<{ tag: string; site: string | null; series: number | null; card: number | null } | null> {
  const r = await one<{ tag: string; meta: string | null }>(
    db,
    `SELECT tag, meta FROM tags WHERE entity_type='asset' AND entity_id=? AND source IN ('manual','collection','tokenscan','digirare','issuer','discovered')
     ORDER BY CASE source WHEN 'manual' THEN 0 WHEN 'collection' THEN 1 WHEN 'tokenscan' THEN 2 WHEN 'digirare' THEN 3 WHEN 'issuer' THEN 4 ELSE 5 END LIMIT 1`,
    asset,
  );
  if (!r) return null;
  // pepe.wtf collection meta = {serie,card}; tokenscan meta = {site}. Parse whichever this row carries.
  let site: string | null = null,
    series: number | null = null,
    card: number | null = null;
  try {
    const m = r.meta ? (JSON.parse(r.meta) as { site?: string; series?: number; card?: number }) : null;
    if (m) {
      site = m.site ?? null;
      series = m.series ?? null;
      card = m.card ?? null;
    }
  } catch {
    /* non-JSON meta */
  }
  return { tag: r.tag, site, series, card };
}

/** The card's artist, from the pepe.wtf-sourced source='artist' tag (its slug powers /tags/<artist-slug>). */
export async function assetArtist(
  db: D1Database,
  asset: string,
): Promise<{ tag: string; name: string; slug: string } | null> {
  const r = await one<{ tag: string; meta: string | null }>(
    db,
    `SELECT tag, meta FROM tags WHERE entity_type='asset' AND entity_id=? AND source='artist' LIMIT 1`,
    asset,
  );
  if (!r?.meta) return null;
  try {
    const m = JSON.parse(r.meta) as { name?: string; slug?: string };
    return m.name ? { tag: r.tag, name: m.name, slug: m.slug || r.tag.replace(/^artist-/, "") } : null;
  } catch {
    return null;
  }
}

/** Collector cohort: assets most co-held with this one. Excludes XCP (currency everyone holds); the b1
 *  side is filtered to real, non-dust address holders. `pct` = shared holders as a share of the subject's
 *  own holders (the Related tab's "why it's related" line). `excludeCollection` drops same-collection
 *  siblings so the cohort strip complements (never repeats) the collection strip. */
export function assetCohort(
  db: D1Database,
  asset: string,
  limit: number,
  excludeCollection: string | null = null,
): Promise<AssetCohortRow[]> {
  const excl = excludeCollection
    ? `AND b2.asset NOT IN (SELECT entity_id FROM tags WHERE entity_type='asset' AND tag=?3)`
    : "";
  const binds = excludeCollection ? [asset, asset, excludeCollection, limit] : [asset, asset, limit];
  return q<AssetCohortRow>(
    db,
    `WITH hc AS (SELECT COUNT(*) n FROM balances WHERE asset=?1 AND holder_type='address' AND CAST(quantity AS INTEGER)>0)
     SELECT b2.asset, a.asset_longname, COUNT(*) shared,
            ROUND(100.0*COUNT(*)/NULLIF((SELECT n FROM hc),0),1) pct
     FROM balances b1 JOIN balances b2 ON b1.holder=b2.holder
     LEFT JOIN assets a ON a.asset=b2.asset
     WHERE b1.asset=?1 AND b1.holder_type='address' AND CAST(b1.quantity AS INTEGER)>0
       AND b2.asset<>?2 AND b2.asset<>'XCP' AND CAST(b2.quantity AS INTEGER)>0 ${excl}
     GROUP BY b2.asset ORDER BY shared DESC LIMIT ?${excludeCollection ? "4" : "3"}`,
    ...binds,
  );
}

/** Same-collection siblings ranked by how strongly they overlap the subject's holders — the "Same
 *  collection" strip on the Related tab. Same co-hold math as assetCohort, but b2 is constrained to the
 *  collection's members (a small tagged set), so this surfaces the *most related* siblings first. */
export function assetCollectionCohort(
  db: D1Database,
  asset: string,
  collection: string,
  limit: number,
): Promise<AssetCohortRow[]> {
  return q<AssetCohortRow>(
    db,
    `WITH hc AS (SELECT COUNT(*) n FROM balances WHERE asset=?1 AND holder_type='address' AND CAST(quantity AS INTEGER)>0)
     SELECT b2.asset, a.asset_longname, COUNT(*) shared,
            ROUND(100.0*COUNT(*)/NULLIF((SELECT n FROM hc),0),1) pct
     FROM balances b1 JOIN balances b2 ON b1.holder=b2.holder
     JOIN tags t ON t.entity_type='asset' AND t.entity_id=b2.asset AND t.tag=?3
     LEFT JOIN assets a ON a.asset=b2.asset
     WHERE b1.asset=?1 AND b1.holder_type='address' AND CAST(b1.quantity AS INTEGER)>0
       AND b2.asset<>?2 AND CAST(b2.quantity AS INTEGER)>0
     GROUP BY b2.asset ORDER BY shared DESC LIMIT ?4`,
    asset,
    asset,
    collection,
    limit,
  );
}

/** Monthly activity, DEX + BTC venues (order matches + orders opened / dispenses + dispensers opened). One of
 *  the two comprehensive-activity reads — split so each stays under D1's compound-SELECT term cap; the handler
 *  merges the pair by month. */
export function assetActivityVenues(
  db: D1Database,
  asset: string,
): Promise<{ month: string; orders: number; dispensers: number }[]> {
  return q<{ month: string; orders: number; dispensers: number }>(
    db,
    `SELECT month, SUM(CASE WHEN k IN ('om','ord') THEN n ELSE 0 END) orders, SUM(CASE WHEN k IN ('dsp','dspr') THEN n ELSE 0 END) dispensers FROM (
       SELECT strftime('%Y-%m',block_time,'unixepoch') month, 'om' k, COUNT(*) n FROM order_matches WHERE forward_asset=?1 OR backward_asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'ord', COUNT(*) FROM orders WHERE give_asset=?1 OR get_asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'dsp', COUNT(*) FROM dispenses WHERE asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'dspr', COUNT(*) FROM dispensers WHERE asset=?1 GROUP BY 1
     ) GROUP BY month`,
    asset,
  );
}

/** Monthly activity, transfers + supply events (sends / issuances + fairmints + destructions + dividends).
 *  The companion to assetActivityVenues — merged by month in the read handler. */
export function assetActivityFlows(
  db: D1Database,
  asset: string,
): Promise<{ month: string; sends: number; supply: number }[]> {
  return q<{ month: string; sends: number; supply: number }>(
    db,
    `SELECT month, SUM(CASE WHEN k='snd' THEN n ELSE 0 END) sends, SUM(CASE WHEN k IN ('iss','fm','dst','div') THEN n ELSE 0 END) supply FROM (
       SELECT strftime('%Y-%m',block_time,'unixepoch') month, 'snd' k, COUNT(*) n FROM sends WHERE asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'iss', COUNT(*) FROM issuances WHERE asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'fm', COUNT(*) FROM fairmints WHERE asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'dst', COUNT(*) FROM destructions WHERE asset=?1 GROUP BY 1
       UNION ALL SELECT strftime('%Y-%m',block_time,'unixepoch'), 'div', COUNT(*) FROM dividends WHERE asset=?1 GROUP BY 1
     ) GROUP BY month`,
    asset,
  );
}

/** Most active users: addresses ranked by lifetime credits + debits of the asset — who USED it most, not who
 *  holds most. Rides idx_credits/debits_asset_address (migration 0039); the union splits the two ledgers. */
export function assetActiveUsers(db: D1Database, asset: string, limit: number): Promise<AssetActiveUser[]> {
  return q<AssetActiveUser>(
    db,
    `SELECT address, SUM(cr) credits, SUM(db) debits, SUM(cr)+SUM(db) activity FROM (
       SELECT address, COUNT(*) cr, 0 db FROM credits WHERE asset=?1 AND address IS NOT NULL GROUP BY address
       UNION ALL SELECT address, 0, COUNT(*) FROM debits WHERE asset=?1 AND address IS NOT NULL GROUP BY address
     ) GROUP BY address ORDER BY activity DESC LIMIT ?2`,
    asset,
    limit,
  );
}

/** Latest daily USD rate for a currency (XCP/BTC/ETH) from the prices calendar — the newest priced day. */
export function latestUsdRate(db: D1Database, currency: string): Promise<{ usd: number } | null> {
  return one<{ usd: number }>(db, `SELECT usd FROM prices WHERE currency=? ORDER BY day DESC LIMIT 1`, currency);
}

/** The "is this cap table real?" signal subset. */
export type AssetQualitySignals = Pick<
  AssetSignalsRow,
  | "holders"
  | "top1_pct"
  | "trades"
  | "self_trade_pct"
  | "low_quality"
  | "holder_breadth"
  | "pct_creator_holders"
  | "burned_pct"
>;

export function assetQualitySignals(db: D1Database, asset: string): Promise<AssetQualitySignals | null> {
  return one<AssetQualitySignals>(
    db,
    `SELECT holders, top1_pct, trades, self_trade_pct, low_quality, holder_breadth, pct_creator_holders, burned_pct FROM asset_signals WHERE asset=?`,
    asset,
  );
}
