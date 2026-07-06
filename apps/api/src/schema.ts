/**
 * Storage row types — TypeScript mirrors of the D1 tables the API reads back frequently enough to
 * deserve a shape. These are API-INTERNAL: the wire contract lives in @xcp/shared; nothing here is
 * sent to a client as-is. Sources: the DDL in src/indexer/signals.ts (signal tables are created
 * there, not in a migration) and migrations 0012/0015/0016/0017/0019.
 */

/** Mirror of the `asset_signals` table (ASSET_DDL + migrations 0015-0019). */
export interface AssetSignalsRow {
  asset: string;
  asset_longname: string | null;
  issuer: string | null;
  divisible: 0 | 1 | null;
  locked: 0 | 1 | null;
  holders: number;
  top1_pct: number;
  trades: number;
  self_trade_pct: number;
  first_trade_blk: number;
  last_trade_blk: number;
  dispenses: number;
  dispense_btc: number;
  low_quality: 0 | 1;
  holder_breadth: number;
  pct_creator_holders: number;
  burned_pct: number;
  distinct_traders: number; // migration 0015
  distinct_dispensers: number; // migration 0015
  age_blocks: number; // migration 0015 (tip − first issuance)
  avg_holder_dex: number; // migration 0015
  recent_events: number; // migration 0016
  recency_blocks: number; // migration 0016
  max_dispense_btc: number; // migration 0017 (realized value; permanent)
  max_trade_xcp: number; // migration 0017
  supply: number; // migration 0019 (normalized supply for circulating-scarcity)
}

/** Mirror of the `address_signals` table (ADDR_DDL in signals.ts). */
export interface AddressSignalsRow {
  addr: string;
  first_blk: number | null;
  last_blk: number;
  out_peers: number;
  in_peers: number;
  dispense_btc: number;
  dispenses: number;
  dividends: number;
  assets_issued: number;
  locked_assets: number;
  btc_spent: number;
  btc_fees: number;
  assets_held: number;
  assets_received: number;
  survived_assets: number;
  assets_distributed: number;
  assets_hits: number;
  rep_score: number; // personalized-PageRank (currently always 1.0)
  clean_dispense_btc: number;
  clean_btc_spent: number;
  is_exchange: 0 | 1;
  is_deposit: 0 | 1;
  is_burn: 0 | 1;
  assets_burned: number;
  disp_trust: number;
  is_emblem_vault: 0 | 1;
  likely_service: 0 | 1;
  dex_trades: number;
  stamps_created: number;
  stamps_collected: number;
  src20_deploys: number;
  is_btns_user: 0 | 1;
}

/** Mirror of the polymorphic `tags` table (migration 0012). */
export interface TagRow {
  entity_type: "address" | "asset";
  entity_id: string;
  tag: string; // exchange|vault|trader|og|creator|grail|stamp|src20|has_media|…
  source: "computed" | "curated" | "manual" | string;
  value: number | null;
}
