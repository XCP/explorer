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
  BalanceRow,
  HolderTierRow,
  HolderArchetypes,
  AssetReviewDistribution,
  AssetReviewTopRow,
} from "@xcp/shared/assets";
import type {
  SendRow,
  IssuanceRow,
  DispenserRow,
  OrderRow,
  FairmintRow,
  DividendRow,
  DestructionRow,
  PoolRow,
  PoolMatchRow,
} from "@xcp/shared/records";
import { q, one } from "#api/db";
import { ORDER_SELECT, FAIRMINT_SELECT } from "#api/queries/records";

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
    return q<AssetIndexRow>(
      db,
      `${ASSET_LIST_SELECT} ORDER BY ${col} ${dir},a.asset ASC LIMIT ? OFFSET ?`,
      f.limit,
      f.offset,
    );
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
     ORDER BY last_issuance_block_index DESC,asset ASC LIMIT ?7 OFFSET ?8`,
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
    `WITH ranked AS (
       SELECT signal.asset_id,dictionary.asset,(${expr}) score
       FROM asset_signals signal
       JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
       WHERE (signal.trades>0 OR signal.dispenses>0) AND COALESCE(signal.low_quality,0)=0
         AND EXISTS (
           SELECT 1 FROM entity_dictionary entity JOIN tags tag ON tag.entity_id=entity.entity_id
            WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset AND tag.tag='has_media'
         )
       ORDER BY score DESC,dictionary.asset ASC LIMIT ?
     )
     SELECT ranked.asset,state.asset_longname,ROUND(ranked.score,1) score
     FROM ranked LEFT JOIN assets state ON state.asset_id=ranked.asset_id
     ORDER BY ranked.score DESC,ranked.asset ASC`,
    limit,
  );
}

/* ---------- detail (business logic lives in the handler; each statement is a function here) ---------- */

/** Full assets row by asset name or longname. */
/** Distinct address holders with a positive balance of an asset. */
/** Native XCP supply = proof-of-burn minus everything destroyed (destructions + issuance/sweep/dividend fees).
 *  Returned as an exact int64 from SQLite; the handler normalizes. */
/** The one-line issuance brief an offer storefront shows about its asset: total supply + locked. */
/** Precomputed asset-quality signal row (feeds the composed score). */
/** Lifetime money stats from the unified trades ledger: realized USD across every venue plus the most
 *  recent USD-known sale. Both reads ride idx_trades_asset(asset, block_time DESC); the LIMIT 1 probe
 *  early-terminates at the newest priced row. */
/** Categorical tags for an asset (stamp/src20/grail/behavioral labels). */
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
       FROM balances b JOIN address_signals sg ON sg.address_id=b.address_id
       WHERE b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
         AND b.address_id IS NOT NULL AND CAST(b.quantity AS INTEGER)>0),
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
     FROM balances b JOIN address_signals sg ON sg.address_id=b.address_id
     WHERE b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)
       AND b.address_id IS NOT NULL AND CAST(b.quantity AS INTEGER)>0`,
    asset,
  );
}

/** Top-holder concentration (top1_pct from the precomputed signal). */
export function assetTop1Pct(db: D1Database, asset: string): Promise<{ t: number } | null> {
  return one<{ t: number }>(
    db,
    `SELECT ROUND(signal.top1_pct,1) t FROM asset_signals signal
     JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id WHERE dictionary.asset=?`,
    asset,
  );
}

/* ---------- asset-quality calibration (parallel to /v2/reputation/review) ---------- */

/** Population quality distribution over asset_signals (`expr` = config-driven raw-score SQL). */
export function assetReviewDistribution(
  db: D1Database,
  expr: string,
  bluechipCut: number,
  premiumCut: number,
  notableCut: number,
): Promise<AssetReviewDistribution | null> {
  return one<AssetReviewDistribution>(
    db,
    `WITH r AS (
       SELECT (${expr}) raw FROM asset_signals WHERE trades>0 OR dispenses>0
     )
     SELECT COUNT(*) n, ROUND(AVG(raw),2) mean, ROUND(MAX(raw),2) max, ROUND(MIN(raw),2) min,
       SUM(CASE WHEN raw>=${bluechipCut} THEN 1 ELSE 0 END) bluechip,
       SUM(CASE WHEN raw>=${premiumCut} AND raw<${bluechipCut} THEN 1 ELSE 0 END) premium,
       SUM(CASE WHEN raw>=${notableCut} AND raw<${premiumCut} THEN 1 ELSE 0 END) notable,
       SUM(CASE WHEN raw<${notableCut} THEN 1 ELSE 0 END) speculative
     FROM r`,
  );
}

/** Top-20 assets by raw quality — face-validity check after a weight change. */
export function assetReviewTop(db: D1Database, expr: string): Promise<AssetReviewTopRow[]> {
  return q<AssetReviewTopRow>(
    db,
    `WITH ranked AS (
       SELECT signal.asset_id,signal.holders,signal.trades,(${expr}) raw
       FROM asset_signals signal ORDER BY raw DESC LIMIT 20
     )
     SELECT dictionary.asset,state.asset_longname,ranked.holders,ranked.trades,ROUND(ranked.raw,2) raw
     FROM ranked JOIN asset_dictionary dictionary ON dictionary.asset_id=ranked.asset_id
     LEFT JOIN assets state ON state.asset_id=ranked.asset_id
     ORDER BY ranked.raw DESC,dictionary.asset ASC`,
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
         CASE WHEN EXISTS (
           SELECT 1 FROM asset_dictionary dictionary
           JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
           JOIN tags tag ON tag.entity_id=entity.entity_id AND tag.tag='vaulted'
           WHERE dictionary.asset_id=signal.asset_id
         ) THEN 1 ELSE 0 END v
       FROM asset_signals signal WHERE signal.trades>0 OR signal.dispenses>0
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
/** The asset's collection tag + project site. Considers both collection sources — the curated pepe.wtf
 *  feed (source='collection') and the broader tokenscan directory (source='tokenscan', whose meta carries
 *  the project site) — preferring pepe.wtf when an asset is in both. This is what lights the green
 *  "Part of …" band, so tokenscan-only projects (Rare Pigeons, Age of Chains, …) now show it too. */
/** The card's artist, from the pepe.wtf-sourced source='artist' tag (its slug powers /tags/<artist-slug>). */
/** Collector cohort: assets most co-held with this one. Excludes XCP (currency everyone holds); the b1
 *  side is filtered to real, non-dust address holders. `pct` = shared holders as a share of the subject's
 *  own holders (the Related tab's "why it's related" line). `excludeCollection` drops same-collection
 *  siblings so the cohort strip complements (never repeats) the collection strip. */
/** Same-collection siblings ranked by how strongly they overlap the subject's holders — the "Same
 *  collection" strip on the Related tab. Same co-hold math as assetCohort, but b2 is constrained to the
 *  collection's members (a small tagged set), so this surfaces the *most related* siblings first. */
/** Monthly activity, DEX + BTC venues (order matches + orders opened / dispenses + dispensers opened). One of
 *  the two comprehensive-activity reads — split so each stays under D1's compound-SELECT term cap; the handler
 *  merges the pair by month. */
/** Monthly activity, transfers + supply events (sends / issuances + fairmints + destructions + dividends).
 *  The companion to assetActivityVenues — merged by month in the read handler. */
/** Most active users: addresses ranked by lifetime credits + debits of the asset — who USED it most, not who
 *  holds most. Rides idx_credits/debits_asset_address (migration 0039); the union splits the two ledgers. */
/** Latest daily USD rate for a currency (XCP/BTC/ETH) from the prices calendar — the newest priced day. */
export function latestUsdRate(db: D1Database, currency: string): Promise<{ usd: number } | null> {
  return one<{ usd: number }>(db, `SELECT usd FROM prices WHERE currency=? ORDER BY day DESC LIMIT 1`, currency);
}
