/** Address surfaces — summary, reputation, relationships (GET /v2/addresses/:addr/*, /v2/exchanges). */

export type AddressTier =
  | "OG" | "Established" | "Active" | "Casual" // ranked real users
  | "Exchange" | "Exchange deposit" | "Vault" | "Burn" | "Service" // infrastructure states
  | "Dormant" | "No history"; // non-ranked

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
