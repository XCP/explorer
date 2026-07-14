/**
 * Vault queries — the SQL behind GET /v2/vaults (Emblem Vault overview). "What's inside" is always derived
 * from our OWN Counterparty ledger (balances/sends), never trusted from Emblem: `inVault` is the funded-box
 * join reused across the summary and most-vaulted-assets reads.
 */
import type { VaultsPayload } from "@xcp/shared/emblem";
import type { MetricPoint } from "@xcp/shared/stats";
import { q, one } from "#api/db";

type VaultSummary = NonNullable<VaultsPayload["summary"]>;
type VaultTopAsset = VaultsPayload["top_assets"][number];
type VaultTopAddr = VaultsPayload["top_funders"][number];
type SaleClassRow = VaultsPayload["sales_by_class"][number];
type TopSoldRow = VaultsPayload["top_sold_assets"][number];

// a funded vault box: an Emblem vault BTC address currently holding a positive Counterparty balance.
const inVault = `emblem_vaults e JOIN balances b ON b.address_id=e.btc_address_id AND CAST(b.quantity AS INTEGER)>0`;

/** Honest vault census (Counterparty vs foreign) + the Emblem sales market (count + realized USD). */
export function vaultSummary(db: D1Database): Promise<VaultSummary | null> {
  return one<VaultSummary>(
    db,
    `WITH census AS (
       SELECT COUNT(*) total_vaults,
              SUM(vault_kind IN ('single','multi')) counterparty_vaults,
              SUM(vault_kind='foreign') foreign_vaults,
              SUM(is_scam_shell=1) scam_shells
         FROM emblem_vaults
     ), funded AS (
       SELECT COUNT(DISTINCT vault.token_id) funded_vaults
         FROM emblem_vaults vault JOIN balances balance
           ON balance.address_id=vault.btc_address_id AND CAST(balance.quantity AS INTEGER)>0
     ), market AS (
       SELECT COUNT(*) sales,
              COALESCE(ROUND(SUM(CASE WHEN sale_class IN ('real','bundle') THEN usd_value ELSE 0 END)),0) realized_usd
         FROM trades WHERE venue='emblem'
     )
     SELECT census.*,funded.funded_vaults,market.sales,market.realized_usd FROM census,funded,market`,
  );
}

/** Emblem sales split by verdict: real (attributed CP card) / bundle / scam_empty / non_counterparty. */
export function vaultSalesByClass(db: D1Database): Promise<SaleClassRow[]> {
  return q<SaleClassRow>(
    db,
    `SELECT COALESCE(sale_class,'unknown') sale_class, COUNT(*) sales, COALESCE(ROUND(SUM(COALESCE(usd_value,0))),0) usd
       FROM trades WHERE venue='emblem' GROUP BY sale_class ORDER BY usd DESC`,
  );
}

/** Most-sold Counterparty cards on the Emblem (ETH) market — realized USD of REAL sales only. */
export function vaultTopSoldAssets(db: D1Database): Promise<TopSoldRow[]> {
  return q<TopSoldRow>(
    db,
    `SELECT dictionary.asset, asset.asset_longname, COALESCE(ROUND(SUM(trade.usd_value)),0) usd, COUNT(*) sales
       FROM trades trade
       JOIN asset_dictionary dictionary ON dictionary.asset_id=trade.asset_id
       LEFT JOIN assets asset ON asset.asset_id=trade.asset_id
      WHERE trade.venue='emblem' AND trade.sale_class='real' AND trade.usd_value>0
      GROUP BY trade.asset_id ORDER BY usd DESC LIMIT 15`,
  );
}

/** Most-vaulted assets: held in the most distinct vault boxes. */
export function vaultTopAssets(db: D1Database): Promise<VaultTopAsset[]> {
  return q<VaultTopAsset>(
    db,
    `SELECT dictionary.asset, asset.asset_longname, COUNT(DISTINCT b.address_id) vaults
       FROM ${inVault}
       JOIN asset_dictionary dictionary ON dictionary.asset_id=b.asset_id
       LEFT JOIN assets asset ON asset.asset_id=b.asset_id
      GROUP BY b.asset_id ORDER BY vaults DESC LIMIT 15`,
  );
}

/** Top funders: addresses that sent assets INTO vaults, by distinct vaults touched. */
export function vaultTopFunders(db: D1Database): Promise<VaultTopAddr[]> {
  return q<VaultTopAddr>(
    db,
    `SELECT address.address, COUNT(DISTINCT send.destination_id) vaults
       FROM sends send JOIN emblem_vaults vault ON vault.btc_address_id=send.destination_id
       JOIN address_dictionary address ON address.address_id=send.source_id
      GROUP BY send.source_id ORDER BY vaults DESC LIMIT 12`,
  );
}

/** Top crackers: addresses that pulled assets OUT of vaults, by distinct vaults touched. */
export function vaultTopCrackers(db: D1Database): Promise<VaultTopAddr[]> {
  return q<VaultTopAddr>(
    db,
    `SELECT address.address, COUNT(DISTINCT send.source_id) vaults
       FROM sends send JOIN emblem_vaults vault ON vault.btc_address_id=send.source_id
       JOIN address_dictionary address ON address.address_id=send.destination_id
      GROUP BY send.destination_id ORDER BY vaults DESC LIMIT 12`,
  );
}

/** Emblem sales market over time: realized USD of Counterparty-card sales per MONTH (the market spans
 *  2020→now, so monthly not daily), oldest-first for charting. */
export function vaultSalesActivity(db: D1Database): Promise<MetricPoint[]> {
  return q<{ t: number; v: number }>(
    db,
    `SELECT CAST(strftime('%s', block_time, 'unixepoch', 'start of month') AS INTEGER) t, COALESCE(ROUND(SUM(COALESCE(usd_value,0))),0) v
       FROM trades WHERE venue='emblem' AND sale_class IN ('real','bundle') AND block_time>0
      GROUP BY t ORDER BY t`,
  ).then((rows) => rows.map((r) => ({ t: Number(r.t) || 0, v: Number(r.v) || 0 })));
}
