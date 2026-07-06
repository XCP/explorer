/**
 * models.ts — SINGLE SOURCE OF TRUTH for the xcp-explorer API wire types (@xcp/shared/models).
 *
 * These interfaces describe exactly what the read API (apps/api/src/read/*.ts) sends over the wire and
 * what the web app (apps/web) consumes. Derived from: the D1 mirror schema (apps/api/migrations/*.sql),
 * the precomputed signal DDL (apps/api/src/indexer/signals.ts), and every SELECT in the read routers.
 *
 * The envelope lives in ./envelope (import "@xcp/shared/envelope"); the index-list catalog lives in
 * ./index-names (import "@xcp/shared/index-names"). No barrels — import each file directly.
 *
 * Conventions:
 *   - Raw bigint quantities are stored/sent as TEXT for JS precision → typed `string`.
 *   - `*_normalized` fields are TEXT (human units) → `string`, EXCEPT the order give/get normalized values
 *     which the ORDER_SELECT computes as SQLite REAL → `number` (see OrderRow).
 *   - SQLite integer booleans are typed `0 | 1`.
 *   - block_time / block_index / *_blk are unix-seconds / block heights → `number`.
 *   - Nullable columns get `| null`. Fields only present on some code paths are optional.
 *
 * Accuracy priority: fields the web consumes are exact; obscure mirror columns may be optional.
 */

/* =============================================================================================
 * Index-list row shapes — one interface per `/v2/<name>` feed (columns = the exact SELECT list)
 * ============================================================================================= */

/** GET /v2/transactions (and block-detail tx summaries carry a subset). Mirror: transactions. */
export interface TransactionRow {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  btc_amount: string | null;   // raw satoshis as text
  fee: string | null;          // raw satoshis as text
  supported: 0 | 1;
}

/** GET /v2/sends · /v2/addresses/:a/sends · /v2/assets/:a/sends. Mirror: sends. */
export interface SendRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  asset: string | null;
  quantity_normalized: string | null;
  send_type: string | null;    // send | enhanced_send | mpma | attach | detach | move
  status: string | null;
}

/** GET /v2/issuances. Mirror: issuances. (Per-address/-asset variants SELECT a subset of these.) */
export interface IssuanceRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  asset: string | null;
  asset_longname: string | null;
  source: string | null;
  issuer: string | null;
  quantity_normalized: string | null;
  transfer: 0 | 1;
  divisible: 0 | 1;
  locked: 0 | 1;
  description: string | null;
  status: string | null;
}

/** GET /v2/orders (ORDER_SELECT in read/shared.ts). give/get normalized are computed REAL → number. */
export interface OrderRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  give_asset: string | null;
  get_asset: string | null;
  status: string | null;
  give_quantity_normalized: number;
  get_quantity_normalized: number;
}

/** GET /v2/order_matches. Mirror: order_matches. */
export interface OrderMatchRow {
  id: string;                  // "tx0_tx1"
  block_index: number;
  block_time: number | null;
  tx0_hash: string | null;
  tx1_hash: string | null;
  tx0_address: string | null;
  tx1_address: string | null;
  forward_asset: string | null;
  forward_quantity: string | null;   // raw
  backward_asset: string | null;
  backward_quantity: string | null;  // raw
  status: string | null;
}

/** GET /v2/dispensers · /v2/assets/:a/dispensers · /v2/addresses/:a/dispensers. Mirror: dispensers.
 *  Note: dispensers.status is an INTEGER in this schema (0 = open). */
export interface DispenserRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  asset: string | null;
  give_quantity_normalized: string | null;
  give_remaining_normalized: string | null;
  satoshirate: string | null;
  satoshirate_normalized: string | null;
  dispense_count: number;
  status: number | null;
  /** Only on /v2/assets/:a/dispensers — the operator's precomputed track-record score. */
  operator_trust?: number;
}

/** GET /v2/dispenses. Mirror: dispenses. (`dispenser_tx_hash` present on the index feed.) */
export interface DispenseRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  asset: string | null;
  dispense_quantity_normalized: string | null;
  dispenser_tx_hash?: string | null;
}

/** GET /v2/sweeps. Mirror: sweeps. */
export interface SweepRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  flags: number | null;
  memo: string | null;
  fee_paid: string | null;
  status: string | null;
}

/** GET /v2/broadcasts. Mirror: broadcasts. `value` is stored TEXT. */
export interface BroadcastRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  timestamp: number | null;    // broadcast feed timestamp (unix)
  value: string | null;
  text: string | null;
  locked: 0 | 1;
  mime_type: string | null;
  status: string | null;
}

/** GET /v2/burns. Mirror: burns. */
export interface BurnRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  burned_normalized: string | null;
  earned_normalized: string | null;
  status: string | null;
}

/** GET /v2/dividends. Mirror: dividends. */
export interface DividendRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  asset: string | null;
  dividend_asset: string | null;
  quantity_per_unit_normalized: string | null;
  status: string | null;
}

/** GET /v2/bets. Mirror: bets. */
export interface BetRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  feed_address: string | null;
  bet_type: number | null;
  deadline: number | null;
  wager_quantity: string | null;
  counterwager_quantity: string | null;
  target_value: string | null;
  leverage: number | null;
  status: string | null;
}

/** GET /v2/fairminters. Mirror: fairminters. */
export interface FairminterRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  asset: string | null;
  asset_longname: string | null;
  price: string | null;
  hard_cap: string | null;
  soft_cap: string | null;
  divisible: 0 | 1;
  earned_quantity: string | null;    // running total minted
  paid_quantity: string | null;      // running total paid toward soft cap
  status: string | null;
}

/** GET /v2/fairmints. Mirror: fairmints. */
export interface FairmintRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  fairminter_tx_hash: string | null;
  asset: string | null;
  earn_quantity: string | null;
  paid_quantity: string | null;
  status: string | null;
}

/** GET /v2/destructions. Mirror: destructions. */
export interface DestructionRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  asset: string | null;
  quantity_normalized: string | null;
  tag: string | null;
  status: string | null;
}

/** GET /v2/btcpays. Mirror: btcpays. */
export interface BtcpayRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  order_match_id: string | null;
  btc_amount_normalized: string | null;
  status: string | null;
}

/** GET /v2/pools. Mirror: pools. `price` is REAL → number. */
export interface PoolRow {
  lp_asset: string;
  pair: string | null;
  asset_a: string | null;
  asset_b: string | null;
  reserve_a: string | null;
  reserve_b: string | null;
  lp_supply: string | null;
  price: number | null;
  status: string | null;
  block_index: number;
}

/** GET /v2/pool_matches. Mirror: pool_matches. */
export interface PoolMatchRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  lp_asset: string | null;
  pair: string | null;
  forward_asset: string | null;
  forward_quantity: string | null;
  backward_asset: string | null;
  backward_quantity: string | null;
}

/** GET /v2/bet_matches. Mirror: bet_matches. */
export interface BetMatchRow {
  id: string;
  block_index: number;
  block_time: number | null;
  tx0_address: string | null;
  tx1_address: string | null;
  feed_address: string | null;
  forward_quantity: string | null;
  backward_quantity: string | null;
  status: string | null;
}

/** GET /v2/rps. Mirror: rps. */
export interface RpsRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  possible_moves: number | null;
  wager: string | null;
  expiration: number | null;
  status: string | null;
}

/** GET /v2/rps_matches. Mirror: rps_matches. */
export interface RpsMatchRow {
  id: string;
  block_index: number;
  block_time: number | null;
  tx0_address: string | null;
  tx1_address: string | null;
  possible_moves: number | null;
  wager: string | null;
  status: string | null;
}

/* =============================================================================================
 * Trades — the unified cross-venue sales ledger (indexer/trades.ts + read/trades.ts)
 * ============================================================================================= */

/** GET /v2/trades · /v2/assets/:asset/trades — one row per sale across every venue. */
export interface TradeRow {
  venue: "dex" | "dispense" | "emblem" | string;
  asset: string | null;              // the CP card (null if unattributable)
  block_time: number | null;
  block_index: number | null;        // CP block, or ETH block_number for Emblem
  quantity: number | null;
  currency: "XCP" | "BTC" | "ETH" | "USDC" | string | null;
  total: number | null;              // in `currency` units
  price: number | null;              // generated: total/quantity
  usd_value: number | null;          // filled where known (USDC at ingest; backfill via prices)
  buyer: string | null;
  seller: string | null;
  tx_hash: string | null;
}

/** GET /v2/trades/stats — venue counts + totals for headers/tiles. */
export interface TradesStats {
  venues: Array<{ venue: string; trades: number; usd_total: number | null }>;
  total: number;
}

/* =============================================================================================
 * Balances
 * ============================================================================================= */

/** Balance rows. Two read shapes share this:
 *   - GET /v2/addresses/:a/balances → asset/quantity/quantity_normalized + divisible/asset_longname/stamp
 *   - GET /v2/assets/:a/balances    → holder/holder_type/quantity/quantity_normalized + is_burn/is_exchange
 *  Fields not selected by a given endpoint are simply absent (hence optional). Mirror: balances. */
export interface BalanceRow {
  asset: string;
  quantity: string;            // raw bigint as text
  quantity_normalized: string | null;
  // asset-scoped (holders of an asset)
  holder?: string;
  holder_type?: "address" | "utxo";
  is_burn?: 0 | 1;
  is_exchange?: 0 | 1;
  // address-scoped (an address's holdings)
  divisible?: 0 | 1 | null;
  asset_longname?: string | null;
  stamp?: 0 | 1;
}

/* =============================================================================================
 * Chain detail payloads
 * ============================================================================================= */

/** A block's transaction summary inside BlockDetail (SELECT in read/chain.ts /v2/blocks/:n). */
export interface BlockTxSummary {
  tx_hash: string;
  tx_index: number;
  source: string | null;
  destination: string | null;
  fee: string | null;
}

/** GET /v2/blocks (list row). Mirror: blocks (subset). */
export interface BlockRow {
  block_index: number;
  block_hash: string | null;
  block_time: number | null;
  transaction_count: number | null;
}

/** GET /v2/blocks/:n — full blocks row + embedded transactions. Mirror: blocks. */
export interface BlockDetail {
  block_index: number;
  block_hash: string | null;
  block_time: number | null;
  ledger_hash: string | null;
  txlist_hash: string | null;
  messages_hash: string | null;
  transaction_count: number | null;
  previous_block_hash: string | null;
  difficulty: string | null;
  transactions: BlockTxSummary[];
}

/** GET /v2/transactions/:hash — full transactions row. Mirror: transactions. */
export interface TxDetail {
  tx_index: number;
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  btc_amount: string | null;
  fee: string | null;
  data: string | null;
  supported: 0 | 1;
  utxos_info: string | null;
}

/* =============================================================================================
 * Asset detail
 * ============================================================================================= */

export type AssetQualityTier =
  | "Bluechip" | "Established" | "Active" | "Speculative"   // ranked (has a market)
  | "Untraded" | "Dormant";                                 // non-ranked states

/** Composed quality object on AssetDetail (from scoreAsset + assetTier). For non-ranked assets this is
 *  just `{ tier: "Dormant", score: null }`; for ranked assets the full breakdown is present. */
export interface AssetQuality {
  tier: AssetQualityTier | string;
  score: number | null;               // 0-100 percentile among market assets only
  raw?: number;
  breakdown?: Record<string, number>; // per-factor contribution (label → points)
  low_quality?: boolean;
}

/** GET /v2/assets/:asset — full assets row + derived supply/burned/circulating + quality + tags.
 *  Native XCP/BTC take a reduced path (asset/type/divisible/locked/description/supply_normalized/
 *  holder_count only), so many issuance fields are optional. Mirror: assets (+ stamp columns). */
export interface AssetDetail {
  asset: string;
  asset_longname: string | null;
  asset_id?: string | null;
  type: string;                       // native | numeric | subasset | asset
  issuer: string | null;
  owner: string | null;
  divisible: 0 | 1;
  locked: 0 | 1;
  description_locked?: 0 | 1;
  description: string | null;
  mime_type?: string | null;
  first_issuance_block_index?: number | null;
  last_issuance_block_index?: number | null;
  first_issuance_block_time?: number | null;
  last_issuance_block_time?: number | null;
  updated_at?: number;
  // Bitcoin Stamps classification (migration 0010)
  stamp?: 0 | 1 | null;
  stamp_protocol?: string | null;
  stamp_tick?: string | null;
  stamp_op?: string | null;
  // derived (BigInt-exact strings; overrides the raw assets.supply columns)
  supply: string;
  supply_normalized: string | null;
  burned?: string;
  burned_normalized?: string;
  circulating?: string;
  circulating_normalized?: string;
  holder_count: number;
  quality?: AssetQuality;
  tags?: string[];
}

/** GET /v2/assets/:asset/quality — the "is this cap table real?" read. */
export interface AssetQualityReport {
  holders: number;
  top1_pct?: number;
  trades: number;
  self_trade_pct?: number;
  holder_breadth?: number;
  pct_creator_holders?: number;
  burned_pct?: number;
  low_quality: 0 | 1;
  wash_suspect?: boolean;
}

/** GET /v2/assets/:asset/holder-makeup — holder base by reputation tier + archetypes + concentration. */
export interface AssetHolderMakeup {
  asset: string;
  holders: number;
  tiers: Array<{ tier: string; holders: number; pct_supply: number }>;
  archetypes: { creators: number; collectors: number; whales: number };
  top_holder_pct: number | null;
}

/** GET /v2/assets/:asset/market — cross-app market chip from xcpdex (nullable when it doesn't trade). */
export interface AssetMarket {
  pair: string;
  last_price: number | null;
  volume_7d: number | null;
  trades_7d: number | null;
  price_change_7d: number | null;
}

/* =============================================================================================
 * Address surfaces
 * ============================================================================================= */

export type AddressTier =
  | "OG" | "Established" | "Active" | "Casual"                     // ranked real users
  | "Exchange" | "Exchange deposit" | "Vault" | "Burn" | "Service" // infrastructure states
  | "Dormant" | "No history";                                     // non-ranked

/** GET /v2/addresses/:addr/summary — identity header counts. */
export interface AddressSummary {
  xcp: string | null;                 // XCP balance (normalized text)
  assets: number;                     // distinct held assets
  issued: number;
  dispensers: number;
  open_dispensers: number;
  open_orders: number;
  first_block: number | null;
  last_block: number | null;
  dispenser_trust: number | null;
}

/** Evidence block behind a reputation score (GET /v2/addresses/:addr/reputation). */
export interface AddressReputationEvidence {
  first_block: number;
  last_block: number;
  span_years: number;
  survived_assets: number;
  assets_distributed: number;
  assets_hits: number;
  dividends: number;
  dispense_btc: number;
  btc_fees: number;
  btc_spent: number;
  inbound_peers: number;
  assets_held: number;
  xcp: number;
  assets_burned: number;
  stamps_created: number;
  stamps_collected: number;
  src20_deploys: number;
  btns_user: boolean;
}

/** GET /v2/addresses/:addr/reputation — composed, explainable address score. New/quiet addresses read
 *  neutral (score/evidence null). Mirror source: address_signals via scoreAddress(). */
export interface AddressReputation {
  score: number | null;              // 0-100 percentile; null for infra/dormant/no-history
  tier: AddressTier | string;
  band: AddressTier | string;        // alias of tier
  tier_meaning: string | null;
  tags: string[];                    // archetype labels (Creator/Collector/Whale/OG/…)
  evidence: AddressReputationEvidence | null;
  raw?: number;
  breakdown?: Record<string, number>;
}

/** GET /v2/addresses/:addr/connections — top counterparties across sends + dispenses + DEX matches. */
export interface AddressConnectionRow {
  cp: string;
  interactions: number;
  is_exchange: 0 | 1;
}

/** GET /v2/addresses/:addr/lineage — sweep-based identity links. */
export interface AddressLineageRow {
  direction: "in" | "out";
  counterparty: string | null;
  block_index: number;
  block_time: number | null;
}

/** Asset-list rows (GET /v2/addresses/:a/issued, /v2/assets/:a/subassets, from-issuer). */
export interface AssetListRow {
  asset: string;
  asset_longname: string | null;
  divisible: 0 | 1;
  locked: 0 | 1;
  issuer: string | null;
  first_issuance_block_index: number | null;
}

/* =============================================================================================
 * Network stats / home
 * ============================================================================================= */

/** GET /v2/ — the home summary payload (cached). Consumed by the landing pulse. */
export interface StatsOverview {
  tip: number | null;
  assets: number;
  transactions: number;
  balances: number;
  indexed_block: string | null;      // indexer cursor (stored as text in indexer_state)
}

/** GET /v2/stats — lifetime network counts + totals (cached). */
export interface NetworkStats {
  tip: number | null;
  assets: number;
  transactions: number;
  sends: number;
  issuances: number;
  dispensers: number;
  dispenses: number;
  orders: number;
  order_matches: number;
  sweeps: number;
  broadcasts: number;
  dividends: number;
  fairmints: number;
  destructions: number;
  holders: number;
  btc_fees: number;
  xcp_destroyed: number;
}

/** A single daily point in the metrics chart series (GET /v2/metrics). */
export interface MetricPoint { t: number; v: number; }  // t = unix seconds (day bucket)

/** GET /v2/metrics — daily time-series for the activity charts. */
export interface Metrics {
  transactions: MetricPoint[];
  issuances: MetricPoint[];
  trades: MetricPoint[];
  dispenses: MetricPoint[];
  sends: MetricPoint[];
  btc_fees: MetricPoint[];
  xcp_burned: MetricPoint[];
}

/** GET /v2/mempool — pending "what's happening now" rows (read-through to CP, not mirrored). */
export interface MempoolRow {
  tx_hash: string | null;
  event: string;
  source: string | null;
  destination: string | null;
  asset: string | null;
  quantity_normalized: string | null;
  timestamp: number | null;
}

/** GET /v2/leaderboards — derived boards across the whole dataset (cached). Each board is an array of
 *  small ad-hoc row objects (addr/asset + the board's metric column); see read/stats.ts for exact cols. */
export interface Leaderboards {
  top_creators: Array<Record<string, unknown>>;
  top_collectors: Array<Record<string, unknown>>;
  top_merchants: Array<Record<string, unknown>>;
  biggest_spenders: Array<Record<string, unknown>>;
  richest_xcp: Array<Record<string, unknown>>;
  most_held: Array<Record<string, unknown>>;
  most_traded: Array<Record<string, unknown>>;
  most_durable: Array<Record<string, unknown>>;
  top_dispensed: Array<Record<string, unknown>>;
  top_dispensers: Array<Record<string, unknown>>;
  top_hits: Array<Record<string, unknown>>;
  broadest_holders: Array<Record<string, unknown>>;
  most_creator_held: Array<Record<string, unknown>>;
  top_stamp_creators: Array<Record<string, unknown>>;
  top_stamp_collectors: Array<Record<string, unknown>>;
  top_src20_deployers: Array<Record<string, unknown>>;
  most_held_stamps: Array<Record<string, unknown>>;
  top_reputation: Array<Record<string, unknown>>;
  top_quality: Array<Record<string, unknown>>;
  include_hidden: boolean;
}

/* =============================================================================================
 * Exchanges / Vaults / Firsts
 * ============================================================================================= */

/** GET /v2/exchanges. */
export interface ExchangeRow {
  addr: string;
  assets_received: number;
  in_peers: number;
  first_blk: number | null;
  last_blk: number | null;
  name: string;                       // operator label (Bittrex/Poloniex/…) or "Exchange"
}
export interface ExchangesPayload {
  summary: { exchanges: number; deposit_addresses: number } | null;
  exchanges: ExchangeRow[];
  top_assets: Array<{ asset: string; asset_longname: string | null; depositors: number }>;
}

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

/** GET /v2/firsts — the earliest record of each kind of on-chain moment. */
export interface FirstRow {
  key: string;
  label: string;
  block: number;
  date: string;                       // ISO yyyy-mm-dd
  ref: string;                        // display + link id
  type: "block" | "tx" | "address" | "asset" | string;
}

/* =============================================================================================
 * DB row mirrors for the precomputed signal tables (source: src/indexer/signals.ts DDL + migrations
 * 0015 / 0016 / 0017 / 0019). Surfaced via reputation/scoring endpoints; also the leaderboard source.
 * ============================================================================================= */

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
  distinct_traders: number;           // migration 0015
  distinct_dispensers: number;        // migration 0015
  age_blocks: number;                 // migration 0015 (tip − first issuance)
  avg_holder_dex: number;             // migration 0015
  recent_events: number;              // migration 0016
  recency_blocks: number;             // migration 0016
  max_dispense_btc: number;           // migration 0017 (realized value; permanent)
  max_trade_xcp: number;              // migration 0017
  supply: number;                     // migration 0019 (normalized supply for circulating-scarcity)
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
  rep_score: number;                  // personalized-PageRank (currently always 1.0)
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
  tag: string;                        // exchange|vault|trader|og|creator|grail|stamp|src20|has_media|…
  source: "computed" | "curated" | "manual" | string;
  value: number | null;
}
