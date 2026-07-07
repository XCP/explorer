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
  AssetIndexRow, FeaturedAsset, AssetCohortRow, BalanceRow, AssetListRow,
  HolderTierRow, HolderArchetypes, AssetReviewDistribution, AssetReviewTopRow,
} from "@xcp/shared/assets";
import type { SendRow, IssuanceRow, DispenserRow, DispenseRow, OrderRow } from "@xcp/shared/records";
import type { AssetSignalsRow, AssetRow } from "../schema";
import { q, one } from "../db";
import { ORDER_SELECT } from "./records";

/* ---------- index + search ---------- */

export interface AssetListFilter {
  query?: string;
  limit: number;
  offset: number;
}

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
    return q<AssetIndexRow>(
      db, `${ASSET_LIST_SELECT} ORDER BY a.last_issuance_block_index DESC LIMIT ? OFFSET ?`, f.limit, f.offset);
  }
  // Three indexed range probes UNIONed: asset (stored uppercase), longname as-typed, longname
  // lowercased — preserving the old LIKE's case-insensitivity for the common all-lower longnames.
  const up = query.toUpperCase(), low = query.toLowerCase();
  return q<AssetIndexRow>(
    db,
    `${ASSET_LIST_SELECT} WHERE a.asset >= ?1 AND a.asset < ?2
     UNION ${ASSET_LIST_SELECT} WHERE a.asset_longname >= ?3 AND a.asset_longname < ?4
     UNION ${ASSET_LIST_SELECT} WHERE a.asset_longname >= ?5 AND a.asset_longname < ?6
     ORDER BY last_issuance_block_index DESC LIMIT ?7 OFFSET ?8`,
    up, nextPrefix(up), query, nextPrefix(query), low, nextPrefix(low), f.limit, f.offset
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
    limit
  );
}

/* ---------- detail (business logic lives in the handler; each statement is a function here) ---------- */

/** Full assets row by asset name or longname. */
export function getAsset(db: D1Database, asset: string): Promise<AssetRow | null> {
  return one<AssetRow>(db, `SELECT * FROM assets WHERE asset=? OR asset_longname=?`, asset.toUpperCase(), asset);
}

/** Distinct address holders with a positive balance of an asset. */
export async function holderCount(db: D1Database, asset: string): Promise<number> {
  const r = await one<{ c: number }>(db, `SELECT COUNT(*) c FROM balances WHERE asset=? AND CAST(quantity AS INTEGER)>0`, asset);
  return r?.c ?? 0;
}

/** Native XCP supply = proof-of-burn minus everything destroyed (destructions + issuance/sweep/dividend fees).
 *  Returned as an exact int64 from SQLite; the handler normalizes. */
export function xcpNativeSupply(db: D1Database): Promise<{ supply: number | null } | null> {
  return one<{ supply: number | null }>(
    db,
    `SELECT (SELECT COALESCE(SUM(CAST(earned AS INTEGER)),0) FROM burns)
          - (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM destructions WHERE asset='XCP' AND status LIKE 'valid%')
          - (SELECT COALESCE(SUM(CAST(amt AS INTEGER)),0) FROM (
              SELECT fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
              UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
              UNION ALL SELECT fee_paid FROM dividends WHERE fee_paid IS NOT NULL)) supply`
  );
}

/** Total minted (valid issuances) minus destructions, CAST TEXT so >2^53 supplies keep precision. */
export function assetSupplyText(db: D1Database, asset: string): Promise<{ supply: string | null } | null> {
  return one<{ supply: string | null }>(
    db,
    `SELECT CAST((SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM issuances WHERE asset=? AND status LIKE 'valid%')
              - (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM destructions WHERE asset=? AND status LIKE 'valid%') AS TEXT) supply`,
    asset, asset
  );
}

/** Supply sitting in known burn addresses, CAST TEXT for the same precision reason. */
export function assetBurnedText(db: D1Database, asset: string): Promise<{ burned: string | null } | null> {
  return one<{ burned: string | null }>(
    db,
    `SELECT CAST(COALESCE(SUM(CAST(b.quantity AS INTEGER)),0) AS TEXT) burned
     FROM balances b JOIN address_signals s ON s.addr=b.holder WHERE b.asset=? AND s.is_burn=1`,
    asset
  );
}

/** Precomputed asset-quality signal row (feeds the composed score). */
export function assetSignalsRow(db: D1Database, asset: string): Promise<AssetSignalsRow | null> {
  return one<AssetSignalsRow>(db, `SELECT * FROM asset_signals WHERE asset=?`, asset);
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
  db: D1Database, asset: string, expr: string, og: number, est: number, act: number
): Promise<HolderTierRow[]> {
  return q<HolderTierRow>(
    db,
    `WITH h AS (
       SELECT CAST(b.quantity AS REAL) q,
         (sg.is_exchange=1 OR sg.is_deposit=1 OR sg.is_burn=1 OR sg.is_emblem_vault=1 OR sg.likely_service=1) infra,
         (${expr}) raw, sg.survived_assets surv, sg.assets_held held
       FROM balances b JOIN address_signals sg ON sg.addr=b.holder
       WHERE b.asset=? AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0),
     tot AS (SELECT SUM(q) s FROM h)
     SELECT CASE WHEN infra THEN 'Infra' WHEN raw>=${og} THEN 'OG' WHEN raw>=${est} THEN 'Established'
                 WHEN raw>=${act} THEN 'Active' ELSE 'Casual' END tier,
       COUNT(*) holders, ROUND(100.0*SUM(q)/(SELECT s FROM tot),1) pct_supply
     FROM h GROUP BY tier`,
    asset
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
     FROM balances b JOIN address_signals sg ON sg.addr=b.holder
     WHERE b.asset=? AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0`,
    asset
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
       SUM(CASE WHEN raw>=16 THEN 1 ELSE 0 END) top1pct, SUM(CASE WHEN raw>=9 THEN 1 ELSE 0 END) top10pct FROM r`
  );
}

/** Top-20 assets by raw quality — face-validity check after a weight change. */
export function assetReviewTop(db: D1Database, expr: string): Promise<AssetReviewTopRow[]> {
  return q<AssetReviewTopRow>(
    db,
    `SELECT asset, asset_longname, holders, trades, ROUND((${expr}),2) raw FROM asset_signals ORDER BY (${expr}) DESC LIMIT 20`
  );
}

/** One convergent-validity group (v=1 vaulted-tagged, v=0 not) — count/mean/median of the raw quality expr. */
export interface AssetValidationGroup { v: 0 | 1; n: number; mean: number; median: number; }

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
     FROM r GROUP BY v`
  );
}

/* ---------- per-asset record tabs ---------- */

/** Holders of an asset, largest first. */
export function listAssetBalances(db: D1Database, asset: string, limit: number, offset: number): Promise<BalanceRow[]> {
  return q<BalanceRow>(
    db,
    `SELECT b.holder, b.holder_type, b.quantity, b.quantity_normalized,
            COALESCE(s.is_burn,0) is_burn, COALESCE(s.is_exchange,0) is_exchange
     FROM balances b LEFT JOIN address_signals s ON s.addr=b.holder
     WHERE b.asset=? AND CAST(b.quantity AS INTEGER)>0 ORDER BY CAST(b.quantity AS INTEGER) DESC LIMIT ? OFFSET ?`,
    asset, limit, offset
  );
}

/** An asset's issuance history (subset of IssuanceRow columns). */
export function listAssetIssuances(db: D1Database, asset: string, limit: number, offset: number): Promise<IssuanceRow[]> {
  return q<IssuanceRow>(
    db,
    `SELECT tx_hash, block_index, block_time, source, issuer, transfer, quantity_normalized, status
     FROM issuances WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset, limit, offset
  );
}

/** An asset's sends. */
export function listAssetSends(db: D1Database, asset: string, limit: number, offset: number): Promise<SendRow[]> {
  return q<SendRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,destination,asset,quantity_normalized,send_type,status FROM sends WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset, limit, offset
  );
}

/** An asset's dispensers, with the source operator's precomputed track-record score for comparability. */
export function listAssetDispensers(db: D1Database, asset: string, limit: number, offset: number): Promise<DispenserRow[]> {
  return q<DispenserRow>(
    db,
    `SELECT d.tx_hash,d.block_index,d.block_time,d.source,d.asset,d.give_quantity_normalized,d.give_remaining_normalized,
            d.satoshirate,d.satoshirate_normalized,d.dispense_count,d.status, ROUND(COALESCE(sg.disp_trust,0),1) operator_trust
     FROM dispensers d LEFT JOIN address_signals sg ON sg.addr=d.source
     WHERE d.asset=? ORDER BY d.block_index DESC LIMIT ? OFFSET ?`,
    asset, limit, offset
  );
}

/** An asset's dispenses. */
export function listAssetDispenses(db: D1Database, asset: string, limit: number, offset: number): Promise<DispenseRow[]> {
  return q<DispenseRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,destination,asset,dispense_quantity_normalized FROM dispenses WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    asset, limit, offset
  );
}

/** Orders touching an asset on either side — the records-owned ORDER_SELECT projection (normalized give/get). */
export function listAssetOrders(db: D1Database, asset: string, limit: number, offset: number): Promise<OrderRow[]> {
  return q<OrderRow>(
    db,
    `${ORDER_SELECT} WHERE o.give_asset=? OR o.get_asset=? ORDER BY o.block_index DESC LIMIT ? OFFSET ?`,
    asset, asset, limit, offset
  );
}

/** Subassets of an asset (longname prefix match). */
export function listSubassets(db: D1Database, asset: string, limit: number, offset: number): Promise<AssetListRow[]> {
  return q<AssetListRow>(
    db,
    `SELECT asset, asset_longname, divisible, locked, issuer, first_issuance_block_index FROM assets
     WHERE asset_longname LIKE ? ORDER BY first_issuance_block_index DESC LIMIT ? OFFSET ?`,
    asset + ".%", limit, offset
  );
}

/** Collector cohort: assets most co-held with this one. Excludes XCP (currency everyone holds); the b1
 *  side is filtered to real, non-dust address holders. */
export function assetCohort(db: D1Database, asset: string, limit: number): Promise<AssetCohortRow[]> {
  return q<AssetCohortRow>(
    db,
    `SELECT b2.asset, a.asset_longname, COUNT(*) shared
     FROM balances b1 JOIN balances b2 ON b1.holder=b2.holder
     LEFT JOIN assets a ON a.asset=b2.asset
     WHERE b1.asset=? AND b1.holder_type='address' AND CAST(b1.quantity AS INTEGER)>0
       AND b2.asset<>? AND b2.asset<>'XCP' AND CAST(b2.quantity AS INTEGER)>0
     GROUP BY b2.asset ORDER BY shared DESC LIMIT ?`,
    asset, asset, limit
  );
}

/** The "is this cap table real?" signal subset. */
export type AssetQualitySignals = Pick<AssetSignalsRow,
  "holders" | "top1_pct" | "trades" | "self_trade_pct" | "low_quality" | "holder_breadth" | "pct_creator_holders" | "burned_pct">;

export function assetQualitySignals(db: D1Database, asset: string): Promise<AssetQualitySignals | null> {
  return one<AssetQualitySignals>(
    db,
    `SELECT holders, top1_pct, trades, self_trade_pct, low_quality, holder_breadth, pct_creator_holders, burned_pct FROM asset_signals WHERE asset=?`,
    asset
  );
}
