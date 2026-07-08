/**
 * Vault queries — the SQL behind GET /v2/vaults (Emblem Vault overview). "What's inside" is always derived
 * from our OWN Counterparty ledger (balances/sends), never trusted from Emblem: `inVault` is the funded-box
 * join reused across the summary and most-vaulted-assets reads.
 */
import type { VaultsPayload } from "@xcp/shared/emblem";
import type { MetricPoint } from "@xcp/shared/stats";
import { q, one } from "../db";

type VaultSummary = NonNullable<VaultsPayload["summary"]>;
type VaultTopAsset = VaultsPayload["top_assets"][number];
type VaultTopAddr = VaultsPayload["top_funders"][number];
type SaleClassRow = VaultsPayload["sales_by_class"][number];
type TopSoldRow = VaultsPayload["top_sold_assets"][number];

// a funded vault box: an Emblem vault BTC address currently holding a positive Counterparty balance.
const inVault = `emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0`;

/** Honest vault census (Counterparty vs foreign) + the Emblem sales market (count + realized USD). */
export function vaultSummary(db: D1Database): Promise<VaultSummary | null> {
  return one<VaultSummary>(
    db,
    `SELECT (SELECT COUNT(*) FROM emblem_vaults) total_vaults,
        (SELECT COUNT(*) FROM emblem_vaults WHERE vault_kind IN ('single','multi')) counterparty_vaults,
        (SELECT COUNT(*) FROM emblem_vaults WHERE vault_kind='foreign') foreign_vaults,
        (SELECT COUNT(*) FROM emblem_vaults e WHERE EXISTS(SELECT 1 FROM balances b WHERE b.holder=e.btc_address AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0)) funded_vaults,
        (SELECT COUNT(*) FROM emblem_vaults WHERE is_scam_shell=1) scam_shells,
        (SELECT COUNT(*) FROM trades WHERE venue='emblem') sales,
        (SELECT COALESCE(ROUND(SUM(usd_value)),0) FROM trades WHERE venue='emblem' AND sale_class IN ('real','bundle')) realized_usd`
  );
}

/** Emblem sales split by verdict: real (attributed CP card) / bundle / scam_empty / non_counterparty. */
export function vaultSalesByClass(db: D1Database): Promise<SaleClassRow[]> {
  return q<SaleClassRow>(
    db,
    `SELECT COALESCE(sale_class,'unknown') sale_class, COUNT(*) sales, COALESCE(ROUND(SUM(COALESCE(usd_value,0))),0) usd
       FROM trades WHERE venue='emblem' GROUP BY sale_class ORDER BY usd DESC`
  );
}

/** Most-sold Counterparty cards on the Emblem (ETH) market — realized USD of REAL sales only. */
export function vaultTopSoldAssets(db: D1Database): Promise<TopSoldRow[]> {
  return q<TopSoldRow>(
    db,
    `SELECT t.asset, a.asset_longname, COALESCE(ROUND(SUM(t.usd_value)),0) usd, COUNT(*) sales
       FROM trades t LEFT JOIN assets a ON a.asset=t.asset
      WHERE t.venue='emblem' AND t.sale_class='real' AND t.asset IS NOT NULL AND t.usd_value>0
      GROUP BY t.asset ORDER BY usd DESC LIMIT 15`
  );
}

/** Most-vaulted assets: held in the most distinct vault boxes. */
export function vaultTopAssets(db: D1Database): Promise<VaultTopAsset[]> {
  return q<VaultTopAsset>(
    db,
    `SELECT b.asset, a.asset_longname, COUNT(DISTINCT b.holder) vaults FROM ${inVault} LEFT JOIN assets a ON a.asset=b.asset GROUP BY b.asset ORDER BY vaults DESC LIMIT 15`
  );
}

/** Top funders: addresses that sent assets INTO vaults, by distinct vaults touched. */
export function vaultTopFunders(db: D1Database): Promise<VaultTopAddr[]> {
  return q<VaultTopAddr>(
    db,
    `SELECT s.source addr, COUNT(DISTINCT s.destination) vaults FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination WHERE s.source IS NOT NULL GROUP BY s.source ORDER BY vaults DESC LIMIT 12`
  );
}

/** Top crackers: addresses that pulled assets OUT of vaults, by distinct vaults touched. */
export function vaultTopCrackers(db: D1Database): Promise<VaultTopAddr[]> {
  return q<VaultTopAddr>(
    db,
    `SELECT s.destination addr, COUNT(DISTINCT s.source) vaults FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source WHERE s.destination IS NOT NULL GROUP BY s.destination ORDER BY vaults DESC LIMIT 12`
  );
}

/** Emblem sales market over time: realized USD of Counterparty-card sales per MONTH (the market spans
 *  2020→now, so monthly not daily), oldest-first for charting. */
export function vaultSalesActivity(db: D1Database): Promise<MetricPoint[]> {
  return q<{ t: number; v: number }>(
    db,
    `SELECT CAST(strftime('%s', block_time, 'unixepoch', 'start of month') AS INTEGER) t, COALESCE(ROUND(SUM(COALESCE(usd_value,0))),0) v
       FROM trades WHERE venue='emblem' AND sale_class IN ('real','bundle') AND block_time>0
      GROUP BY t ORDER BY t`
  ).then((rows) => rows.map((r) => ({ t: Number(r.t) || 0, v: Number(r.v) || 0 })));
}
