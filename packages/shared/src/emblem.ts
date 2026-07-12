/** Emblem Vault surfaces — vault overview and per-vault reads (GET /v2/vaults, /v2/emblem/*). */
import type { MetricPoint } from "./stats";

/** GET /v2/vaults — Emblem Vault overview. Emblem is multi-chain; this surface is honest about the split
 *  (Counterparty vaults vs. foreign ones whose value is on another chain) and adds the ETH-side sales market. */
export interface VaultsPayload {
  summary: {
    total_vaults: number; // all Emblem vault records we've enumerated (all chains)
    counterparty_vaults: number; // vaults that wrap a Counterparty asset (single + multi/bundle)
    foreign_vaults: number; // vaults whose contents are on another chain (Namecoin/Ordinals/BTC) — NOT ours
    funded_vaults: number; // Counterparty vaults currently holding a live balance
    scam_shells: number; // vaults that NAME a real Counterparty card but hold nothing (empty-shell scams)
    sales: number; // total Emblem NFT sales we've attributed
    realized_usd: number; // realized USD of REAL Counterparty-card sales (real + bundle)
  } | null;
  sales_by_class: Array<{ sale_class: string; sales: number; usd: number }>;
  top_sold_assets: Array<{ asset: string; asset_longname: string | null; usd: number; sales: number }>;
  top_assets: Array<{ asset: string; asset_longname: string | null; vaults: number }>;
  top_funders: Array<{ address: string; vaults: number }>;
  top_crackers: Array<{ address: string; vaults: number }>;
  sales_activity: MetricPoint[]; // realized USD of Counterparty-card Emblem sales per month
}

/** GET /v2/emblem/stats. */
export interface EmblemStats {
  vaults: number;
  funded: number;
  cracked_to_user: number;
  revaulted: number;
  depositors: number;
  all_holders: number;
  real_users: number;
  empty: number;
}

/** GET /v2/emblem/assets (list row) — an asset locked inside vault boxes, by vault count. */
export interface EmblemAssetRow {
  asset: string;
  vaults: number;
}

/** GET /v2/emblem/vaults (list row). */
export interface EmblemVaultRow {
  token_id: string;
  contract: string | null;
  btc_address: string | null;
  held_assets: number;
}
