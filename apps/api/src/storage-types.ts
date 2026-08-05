/**
 * Storage row types — TypeScript mirrors of the D1 tables the API reads back frequently enough to
 * deserve a shape. These are API-INTERNAL: the wire contract lives in @xcp/shared; nothing here is
 * sent to a client as-is. Source: the canonical database migrations.
 */

/** Mirror of the `assets` table (migration 0001). The asset-detail handler spreads the whole row, so the
 *  shape lives here with the other storage rows (never sent to a client as-is — the handler derives the
 *  wire AssetDetail from it). */
export interface AssetRow {
  asset: string;
  asset_longname: string | null;
  asset_id: string | null;
  type: string;
  issuer: string | null;
  owner: string | null;
  divisible: 0 | 1;
  locked: 0 | 1;
  description_locked: 0 | 1;
  supply: string | null;
  supply_normalized: string | null;
  description: string | null;
  mime_type: string | null;
  first_issuance_block_index: number | null;
  last_issuance_block_index: number | null;
  first_issuance_block_time: number | null;
  last_issuance_block_time: number | null;
  updated_at: number;
}

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
  age_blocks: number; // migration 0015 — written at insert only; reads derive tip − first issuance live
  avg_holder_dex: number; // migration 0015
  recent_events: number; // migration 0016
  recency_blocks: number; // migration 0016 — written at insert only; reads derive tip − last trade live
  max_dispense_btc: number; // migration 0017 (realized value; permanent)
  max_trade_xcp: number; // migration 0017
  supply: number; // migration 0019 (normalized supply for circulating-scarcity)
  max_realized_usd: number; // largest non-self trade's USD value, all venues (not lifetime realized volume)
  distinct_dispense_buyers: number; // migration 0023 (distinct non-self dispense destinations)
  max_dispense_btc_clean: number; // migration 0023 (largest non-self dispense BTC — clean max_dispense_btc)
  emblem_trades: number; // migration 0023 (count of Emblem-vault sales attributed to the asset)
  graph_trust: number; // migration 0024 (personalized-PageRank trust mass from the seeded collector/creator network)
  graph_distrust: number; // migration 0024 (PPR mass from the distrust seeds)
  holder_cohesion: number | null; // migration 0040 (interaction edges among top holders ÷ holder count; NULL until built)
  cohesion_edges: number | null; // migration 0040 (raw edge count among top holders)
  cohesion_strong: number | null; // migration 0040 (edges with w≥1.6 ⇔ ~4+ repeated interactions)
  active_trade_months: number; // migration 0060 (distinct UTC months in the unified trade ledger)
  last_trade_time: number | null; // migration 0060 (exact unix time of latest unified-ledger trade)
  clean_realized_usd: number; // migration 0063
  distinct_paid_buyers: number; // migration 0063
  clean_active_trade_months: number; // migration 0063
  market_venue_count: number; // migration 0063
  rating_value: number | null;
  rating_rank: number | null;
  rating_population: number | null;
  rating_active_months_score: number | null;
  rating_buyer_breadth_score: number | null;
  rating_realized_value_score: number | null;
  rating_calculated_at: number | null;
  rating_model_version: number | null;
  activity_outlook_score: number | null;
  activity_outlook_rank: number | null;
  activity_outlook_population: number | null;
  activity_outlook_calculated_at: number | null;
}

/** Mirror of the `address_signals` table (ADDR_DDL in signals.ts). */
export interface AddressSignalsRow {
  address: string;
  first_block: number | null;
  last_block: number;
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
  vault_scams: number; // bad-actor: distinct Emblem vaults this address cracked then sold empty (migration 0031)
  shell_scams: number; // bad-actor: genuine empty-shell Emblem vaults attributed to this BTC identity (migration 0033)
  dump_scams: number; // bad-actor: high-supply single-unit Emblem "collectible" dumps funded by this address (migration 0035)
}

/** Mirror of the polymorphic `tags` table (migration 0012 + 0037 meta). */
export interface TagRow {
  entity_type: "address" | "asset";
  entity_id: string;
  tag: string; // exchange|vault|trader|og|creator|grail|stamp|src20|has_media|…
  source: "computed" | "curated" | "manual" | "collection" | "tokenscan" | string;
  value: number | null;
  meta: string | null; // optional JSON sidecar (migration 0037) — e.g. {"collection","site"} for a collection tag
}
