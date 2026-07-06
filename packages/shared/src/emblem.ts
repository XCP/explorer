/** Emblem Vault surfaces — vault overview and per-vault reads (GET /v2/vaults, /v2/emblem/*). */
import type { MetricPoint } from "./stats";

/** GET /v2/vaults — Emblem Vault overview. */
export interface VaultsPayload {
  summary: {
    vault_records: number;
    funded_vaults: number;
    assets_vaulted: number;
    funders: number;
    crackers: number;
  } | null;
  top_assets: Array<{ asset: string; asset_longname: string | null; vaults: number }>;
  top_funders: Array<{ addr: string; vaults: number }>;
  top_crackers: Array<{ addr: string; vaults: number }>;
  activity: MetricPoint[];
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

/** GET /v2/emblem/vaults (list row). */
export interface EmblemVaultRow {
  token_id: string;
  contract: string | null;
  btc_address: string | null;
  held_assets: number;
}
