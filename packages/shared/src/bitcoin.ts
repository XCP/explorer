/** Bitcoin index wire contract — bounded projections exported from the certified local index.
 *  Coverage is a durable watermark (height/hash), never an assumption that the index tracks tip. */

/** One durable key in the index state table (coverage_height, coverage_hash, schema/source versions). */
export interface BitcoinIndexStateEntry {
  key: string;
  value: string;
  updated_at: number;
}

/** Aggregate shape of the imported block-metric range. */
export interface BitcoinBlockCoverage {
  blocks: number;
  first_block: number | null;
  last_block: number | null;
  imported_at: number | null;
}

/** Aggregate shape of the imported Counterparty-UTXO owner balances. */
export interface BitcoinBalanceCoverage {
  addresses: number;
  balance_sats: number;
}

export interface BitcoinIndexStatus {
  state: BitcoinIndexStateEntry[];
  blocks: BitcoinBlockCoverage | null;
  balances: BitcoinBalanceCoverage | null;
}

/** One Bitcoin block's compact measurements, including the Counterparty share of the block. */
export interface BitcoinBlockMetrics {
  block_height: number;
  block_hash: string;
  block_time: number;
  block_size: number;
  transaction_count: number;
  total_fees_sats: number;
  counterparty_transaction_count: number;
  counterparty_fee_sats: number;
  source: string;
  source_version: number;
  imported_at: number;
}

/** Point-in-time Bitcoin balance for a Counterparty-UTXO owner address at the coverage watermark. */
export interface BitcoinAddressBalance {
  address: string;
  balance_sats: number;
  utxo_count: number;
  first_block: number | null;
  last_block: number | null;
  source: string;
  source_version: number;
  imported_at: number;
}
