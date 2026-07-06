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

// a funded vault box: an Emblem vault BTC address currently holding a positive CP balance.
const inVault = `emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0`;

/** Vault records + funded/assets-vaulted counts + funder/cracker tag counts. */
export function vaultSummary(db: D1Database): Promise<VaultSummary | null> {
  return one<VaultSummary>(
    db,
    `SELECT (SELECT COUNT(*) FROM emblem_vaults) vault_records,
        (SELECT COUNT(*) FROM emblem_vaults e WHERE EXISTS(SELECT 1 FROM balances b WHERE b.holder=e.btc_address AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0)) funded_vaults,
        (SELECT COUNT(DISTINCT b.asset) FROM ${inVault}) assets_vaulted,
        (SELECT COUNT(*) FROM tags WHERE tag='vault_funder') funders,
        (SELECT COUNT(*) FROM tags WHERE tag='vault_cracker') crackers`
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

/** Vaulting activity: assets sent INTO vault boxes per day (last 90d), oldest-first for charting. */
export function vaultingActivity(db: D1Database): Promise<MetricPoint[]> {
  return q<{ d: number; v: number }>(
    db,
    `SELECT s.block_time/86400 d, COUNT(*) v FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination WHERE s.block_time>0 GROUP BY d ORDER BY d DESC LIMIT 90`
  ).then((rows) => rows.map((r) => ({ t: r.d * 86400, v: Number(r.v) || 0 })).reverse());
}
