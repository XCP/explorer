/** Address surfaces — summary, reputation, relationships (GET /v2/addresses/:address/*, /v2/exchanges). */

export type AddressTier =
  | "Exceptional"
  | "Strong"
  | "Established"
  | "Limited" // ranked user-like addresses
  | "Exchange"
  | "Exchange deposit"
  | "Vault"
  | "Burn"
  | "Service" // infrastructure states
  | "Integrity flag"
  | "No history"; // non-ranked

/** GET /v2/addresses/:address/balances — one held asset (raw + normalized are text; stamp flag from tags). */
export interface AddressBalanceRow {
  asset: string;
  quantity: string;
  quantity_normalized: string;
  divisible: 0 | 1 | null;
  asset_longname: string | null;
  stamp: 0 | 1;
}

/** GET /v2/addresses/:address/sends — a send where the address is source or destination. */
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

/** GET /v2/addresses/:address/issuances — an issuance the address made or received (transfer). */
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

/** GET /v2/addresses/:address/dispensers — a dispenser opened by the address (raw sat rates are text; status is int). */
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

/** GET /v2/addresses/:address/dispenses — a dispense the address triggered or received. */
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

/** GET /v2/addresses/:address/issued — an asset the address issued or owns. */
export interface AddressIssuedAssetRow {
  asset: string;
  asset_longname: string | null;
  divisible: 0 | 1 | null;
  locked: 0 | 1 | null;
  issuer: string | null;
  first_issuance_block_index: number;
}

/** GET /v2/addresses/:address/summary — identity header counts. */
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

/** Dominant address ROLE — what it does (creator/collector/merchant/trader/service), orthogonal to the
 *  reputation score (whether to trust it). `label` is the composed headline ("Creator · also collects");
 *  `primary` keys the icon/colour. null for no-history addresses. */
export interface AddressPersona {
  primary: "creator" | "collector" | "merchant" | "trader" | "service" | "dormant";
  secondary: "creator" | "collector" | "merchant" | "trader" | "service" | "dormant" | null;
  label: string;
  blurb: string;
}

/** GET /v2/addresses/:address/reputation — composed, explainable address score. New/quiet addresses
 *  read neutral (score/evidence null). */
export interface AddressTrackRecord {
  score: number | null;
  tier: AddressTier | string;
  meaning: string | null;
}

export interface AddressReputationComponents {
  duration: number;
  creation: number;
  economic: number;
  participation: number;
}

export interface AddressCurrentActivity {
  last_active_at: number;
  days_since_active: number;
}

export interface AddressReputation {
  track_record: AddressTrackRecord;
  activity: AddressCurrentActivity | null;
  tags: string[]; // factual archetype labels such as Creator, Collector, and Whale
  persona: AddressPersona | null; // the dominant role headline
  evidence: AddressReputationEvidence | null;
  components: AddressReputationComponents | null;
  rank_position: number | null;
  population: number | null;
  calculated_at: number | null;
  model_version: number | null;
}

/** GET /v2/addresses/:address/connections — top counterparties across sends + dispenses + DEX matches. */
export interface AddressConnectionRow {
  cp: string;
  interactions: number;
  is_exchange: 0 | 1;
}

/** GET /v2/addresses/:address/lineage — sweep-based identity links. */
export interface AddressLineageRow {
  direction: "in" | "out";
  counterparty: string | null;
  block_index: number;
  block_time: number | null;
}

/** GET /v2/addresses/:address/ledger — one raw credit (in) or debit (out) from the credits/debits ledger
 *  (migration 0038). The full provenance of an address: every balance change with its Counterparty reason. */
export interface AddressLedgerRow {
  direction: "in" | "out";
  block_index: number;
  tx_hash: string | null;
  asset: string;
  quantity: string; // raw bigint as text
  calling_function: string | null; // send | dispense | issuance | dividend | order match | ...
}

/** GET /v2/reputation/review — ranked-population band counts. */
export interface ReputationDistribution {
  n: number;
  mean: number;
  max: number;
  exceptional: number;
  strong: number;
  established: number;
  limited: number;
}

/** GET /v2/reputation/review + /v2/reputation/tiers/:tier — a scored address row (face-validity spot
 *  check, and the per-tier leaderboard member). */
export interface ReputationTopRow {
  address: string;
  score: number;
  rank_position: number;
  survived_assets: number;
  assets_held: number;
  dex_trades: number;
  stamps_created: number;
  dividends: number;
  btc_fees: number;
}

/** One reputation tier's public summary (definition + population) on the /reputation overview. */
export interface ReputationTierSummary {
  tier: string; // Exceptional | Strong | Established | Limited
  slug: string; // deep-link segment
  minimum: number; // inclusive Reputation cutoff
  meaning: string; // plain-language definition
  count: number; // ranked addresses currently in this band
}

/** The scoring funnel — every mirror address narrowed to the scored real-user pool. `by_kind` breaks down
 *  the infrastructure that's filtered out. Shown as the "who counts" act on /reputation. */
export interface ReputationFunnel {
  total_addresses: number; // every REAL address = infrastructure + scored (footprint-less rows excluded)
  infrastructure: number; // exchanges + deposits + vaults + burns + services
  no_history: number; // 0 by definition — a historyless row is a contradiction (see NOT_INFRA)
  scored: number; // the real-user pool that gets a tier
  by_kind: { exchanges: number; deposits: number; vaults: number; burns: number; services: number };
}

/** GET /v2/reputation/tiers — the reputation system overview: the funnel, the score distribution, and the
 *  per-tier breakdown, high→low. `histogram` is integer-binned scores (0..cap) for the distribution curve. */
export interface ReputationTiersOverview {
  total: number; // real users scored (== funnel.scored)
  mean: number;
  max: number;
  funnel: ReputationFunnel;
  histogram: { bin: number; count: number }[];
  tiers: ReputationTierSummary[];
  model_version: number;
  calculated_at: number | null;
}

/** GET /v2/reputation/tiers/:tier — one tier's definition + its ranked membership (paginated). */
export interface ReputationTierMembers {
  tier: ReputationTierSummary;
  members: ReputationTopRow[];
}

/** GET /v2/exchanges — a known CEX wallet. */
export interface ExchangeRow {
  address: string;
  assets_received: number;
  in_peers: number;
  first_block: number | null;
  last_block: number | null;
  name: string; // operator label (Bittrex/Poloniex/…) or "Exchange"
}

/** GET /v2/exchanges — the full payload. */
export interface ExchangesPayload {
  summary: { exchanges: number; deposit_addresses: number } | null;
  exchanges: ExchangeRow[];
  top_assets: Array<{ asset: string; asset_longname: string | null; depositors: number }>;
}
