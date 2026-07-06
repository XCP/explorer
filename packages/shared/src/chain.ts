/** Chain surfaces — blocks and transactions (GET /v2/blocks, /v2/transactions/:hash). */

/** GET /v2/blocks (list row). Mirror: blocks (subset). */
export interface BlockRow {
  block_index: number;
  block_hash: string | null;
  block_time: number | null;
  transaction_count: number | null;
}

/** A block's transaction summary inside BlockDetail. */
export interface BlockTxSummary {
  tx_hash: string;
  tx_index: number;
  source: string | null;
  destination: string | null;
  fee: string | null;
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
