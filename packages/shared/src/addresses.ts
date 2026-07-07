/** Address surfaces — summary, reputation, relationships (GET /v2/addresses/:addr/*, /v2/exchanges). */

export type AddressTier =
  | "OG" | "Established" | "Active" | "Casual" // ranked real users
  | "Exchange" | "Exchange deposit" | "Vault" | "Burn" | "Service" // infrastructure states
  | "Dormant" | "No history"; // non-ranked

/** GET /v2/addresses/:addr/balances — one held asset (raw + normalized are text; stamp flag from tags). */
export interface AddressBalanceRow {
  asset: string;
  quantity: string;
  quantity_normalized: string;
  divisible: 0 | 1 | null;
  asset_longname: string | null;
  stamp: 0 | 1;
}

/** GET /v2/addresses/:addr/sends — a send where the address is source or destination. */
export interface AddressSendRow {
  tx_hash: string;
  block_index: number;
  block_time: number;
  source: string | null;
  destination: string | null;
  asset: string | null;
  quantity_normalized: string;
  send_type: string | null;
  status: string;
}

/** GET /v2/addresses/:addr/issuances — an issuance the address made or received (transfer). */
export interface AddressIssuanceRow {
  tx_hash: string;
  block_index: number;
  block_time: number;
  asset: string;
  asset_longname: string | null;
  quantity_normalized: string;
  transfer: number;
  issuer: string | null;
  description: string | null;
  /** Counterparty's own action string(s) (creation, reissuance, lock_quantity, …). */
  asset_events: string | null;
  status: string;
}

/** GET /v2/addresses/:addr/dispensers — a dispenser opened by the address (raw sat rates are text; status is int). */
export interface AddressDispenserRow {
  tx_hash: string;
  block_index: number;
  block_time: number;
  source: string;
  asset: string | null;
  give_quantity_normalized: string;
  give_remaining_normalized: string;
  satoshirate: string;
  satoshirate_normalized: string | null;
  dispense_count: number;
  status: number;
}

/** GET /v2/addresses/:addr/dispenses — a dispense the address triggered or received. */
export interface AddressDispenseRow {
  tx_hash: string;
  block_index: number;
  block_time: number;
  source: string | null;
  destination: string | null;
  asset: string | null;
  dispense_quantity_normalized: string;
  dispenser_tx_hash: string | null;
  /** BTC the buyer paid, raw satoshis as text. */
  btc_amount: string | null;
  /** USD value at sale time, from the trades ledger where known. */
  usd_value: number | null;
}

/** GET /v2/addresses/:addr/issued — an asset the address issued or owns. */
export interface AddressIssuedAssetRow {
  asset: string;
  asset_longname: string | null;
  divisible: 0 | 1 | null;
  locked: 0 | 1 | null;
  issuer: string | null;
  first_issuance_block_index: number;
}

/** GET /v2/addresses/:addr/summary — identity header counts. */
export interface AddressSummary {
  xcp: string | null; // XCP balance (normalized text)
  assets: number; // distinct held assets
  issued: number;
  dispensers: number;
  open_dispensers: number;
  open_orders: number;
  first_block: number | null;
  last_block: number | null;
  dispenser_trust: number | null;
}

/** Evidence block behind a reputation score. */
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

/** GET /v2/addresses/:addr/reputation — composed, explainable address score. New/quiet addresses
 *  read neutral (score/evidence null). */
export interface AddressReputation {
  score: number | null; // 0-100 percentile; null for infra/dormant/no-history
  tier: AddressTier | string;
  band: AddressTier | string; // alias of tier
  tier_meaning: string | null;
  tags: string[]; // archetype labels (Creator/Collector/Whale/OG/…)
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

/** GET /v2/reputation/review — population raw-score band counts (calibration view). */
export interface ReputationDistribution {
  n: number;
  mean: number;
  max: number;
  og: number;
  established: number;
  active: number;
  casual: number;
}

/** GET /v2/reputation/review — one high-scoring address (face-validity spot check). */
export interface ReputationTopRow {
  addr: string;
  raw: number;
  survived_assets: number;
  assets_held: number;
  dex_trades: number;
  stamps_created: number;
  dividends: number;
  btc_fees: number;
}

/** GET /v2/exchanges — a known CEX wallet. */
export interface ExchangeRow {
  addr: string;
  assets_received: number;
  in_peers: number;
  first_blk: number | null;
  last_blk: number | null;
  name: string; // operator label (Bittrex/Poloniex/…) or "Exchange"
}

/** GET /v2/exchanges — the full payload. */
export interface ExchangesPayload {
  summary: { exchanges: number; deposit_addresses: number } | null;
  exchanges: ExchangeRow[];
  top_assets: Array<{ asset: string; asset_longname: string | null; depositors: number }>;
}
