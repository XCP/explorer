/**
 * The record catalog — every kind of on-chain Counterparty record the explorer serves as a list
 * feed (`GET /v2/<kind>`), and the exact row shape each feed returns. This is the single source of
 * truth for "what record types exist": the web's page registry and the API's list routes both key
 * off RecordKind, and RecordRowMap lets a column definition be typed to its row.
 *
 * Conventions (apply to every wire type in this package):
 *   - Raw bigint quantities travel as TEXT for JS precision → `string`.
 *   - `*_normalized` fields are TEXT (human units) → `string`, EXCEPT OrderRow's give/get
 *     normalized values, which ORDER_SELECT computes as SQLite REAL → `number`.
 *   - SQLite integer booleans are `0 | 1`. block_time is unix seconds.
 */

export const RECORD_KINDS = [
  "transactions",
  "sends",
  "issuances",
  "dispensers",
  "dispenses",
  "orders",
  "order_matches",
  "sweeps",
  "fairminters",
  "fairmints",
  "destructions",
  "burns",
  "dividends",
  "broadcasts",
  "btcpays",
  "bets",
  "bet_matches",
  "rps",
  "rps_matches",
  "pools",
  "pool_matches",
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

/** GET /v2/transactions. Mirror: transactions. */
export interface TransactionRow {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  btc_amount: string | null; // raw satoshis as text
  fee: string | null; // raw satoshis as text
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
  send_type: string | null; // send | enhanced_send | mpma | attach | detach | move
  status: string | null;
  memo: string | null; // sender-attached note (decoded; null when none)
}

/** GET /v2/issuances. Mirror: issuances. (Per-address/-asset variants SELECT a subset.) */
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
  /** Counterparty's own action string(s) for the issuance (creation, reissuance, lock_quantity, transfer, reset, change_description, …). */
  asset_events: string | null;
  status: string | null;
}

/** GET /v2/orders (ORDER_SELECT in the API). give/get normalized are computed REAL → number. */
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
  give_remaining_normalized: number;
  get_remaining_normalized: number;
  /** Order lifetime in blocks, and the block it expires at (fill progress + blocks-left). */
  expiration: number | null;
  expire_index: number | null;
}

/** GET /v2/order_matches. Mirror: order_matches. */
export interface OrderMatchRow {
  id: string; // "tx0_tx1"
  block_index: number;
  block_time: number | null;
  tx0_hash: string | null;
  tx1_hash: string | null;
  tx0_address: string | null;
  tx1_address: string | null;
  forward_asset: string | null;
  forward_quantity: string | null; // raw
  backward_asset: string | null;
  backward_quantity: string | null; // raw
  /** Divisibility-normalized quantities (computed REAL, like OrderRow) so a match renders as a trade. */
  forward_quantity_normalized: number;
  backward_quantity_normalized: number;
  status: string | null;
}

/** GET /v2/dispensers (+ per-asset/-address variants). Mirror: dispensers.
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
  escrow_quantity: string | null; // raw units originally escrowed — the storefront stock bar's denominator
  closed_block_index: number | null; // when the machine closed/emptied — the dead-storefront epitaph
  /** Only on /v2/assets/:a/dispensers — the operator's precomputed track-record score. */
  operator_trust?: number;
}

/** GET /v2/dispenses. Mirror: dispenses. */
export interface DispenseRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  asset: string | null;
  dispense_quantity_normalized: string | null;
  dispenser_tx_hash?: string | null;
  /** BTC the buyer paid, raw satoshis as text — a dispense is a sale, not a free send. */
  btc_amount: string | null;
  /** USD value at sale time, from the trades ledger where known. */
  usd_value: number | null;
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
  timestamp: number | null; // broadcast feed timestamp (unix)
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

/** GET /v2/fairminters. Mirror: fairminters. */
export interface FairminterRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  asset: string | null;
  asset_longname: string | null;
  price: string | null; // XCP paid per quantity_by_price units (a batch, not necessarily one unit)
  quantity_by_price: string | null; // asset units minted per `price` paid — divide to get the per-unit price
  hard_cap: string | null;
  soft_cap: string | null;
  divisible: 0 | 1;
  earned_quantity: string | null; // running total minted
  paid_quantity: string | null; // running total paid toward soft cap
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
  /** Asset divisibility (joined) so earn_quantity can render in human units. */
  divisible: 0 | 1;
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
  fee_quantity: string | null; // swap fee taken by the pool (raw units)
  fee_bps: number | null; // the pool's fee tier in basis points
}

/* ---------- tx-page-only record rows (real Counterparty messages, but not index feeds) ---------- */

/** An order cancellation. Mirror: cancels. offer_hash = the canceled order's tx_hash. */
export interface CancelRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  offer_hash: string | null;
  status: string | null;
}

/** A dispenser refill (topping up an open dispenser's stock). Mirror: dispenser_refills. */
export interface DispenserRefillRow {
  tx_hash: string | null;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  asset: string | null;
  dispense_quantity: string | null;
  dispenser_tx_hash: string | null;
}

/** An AMM liquidity event — deposit into or withdrawal from a pool. Mirror: pool_liquidity. */
export interface PoolLiquidityRow {
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  kind: "deposit" | "withdrawal" | string | null;
  asset_a: string | null;
  asset_b: string | null;
  quantity_a: string | null;
  quantity_b: string | null;
  quantity_minted: string | null;
  quantity_destroyed: string | null;
  status: string | null;
}

/** RecordKind → row shape. Lets registries/tables be typed per feed: Col<RecordRowMap[K]>. */
export interface RecordRowMap {
  transactions: TransactionRow;
  sends: SendRow;
  issuances: IssuanceRow;
  dispensers: DispenserRow;
  dispenses: DispenseRow;
  orders: OrderRow;
  order_matches: OrderMatchRow;
  sweeps: SweepRow;
  fairminters: FairminterRow;
  fairmints: FairmintRow;
  destructions: DestructionRow;
  burns: BurnRow;
  dividends: DividendRow;
  broadcasts: BroadcastRow;
  btcpays: BtcpayRow;
  bets: BetRow;
  bet_matches: BetMatchRow;
  rps: RpsRow;
  rps_matches: RpsMatchRow;
  pools: PoolRow;
  pool_matches: PoolMatchRow;
}
