/** Chain surfaces — blocks and transactions (GET /v2/blocks, /v2/transactions/:hash). */
import type {
  SendRow,
  DispenseRow,
  DispenserRow,
  OrderRow,
  IssuanceRow,
  FairminterRow,
  FairmintRow,
  BroadcastRow,
  SweepRow,
  DividendRow,
  BtcpayRow,
  BurnRow,
  DestructionRow,
  BetRow,
  RpsRow,
  PoolMatchRow,
  OrderMatchRow,
  CancelRow,
  DispenserRefillRow,
  PoolLiquidityRow,
} from "./records";
import type { MempoolActionRow } from "./mempool";

/** GET /v2/blocks (list row). Mirror: blocks (subset). */
export interface BlockRow {
  block_index: number;
  block_hash: string | null;
  block_time: number | null;
  transaction_count: number | null;
  bitcoin_transaction_count: number | null;
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
  bitcoin_transaction_count: number | null;
  previous_block_hash: string | null;
  difficulty: string | null;
  transactions: BlockTxSummary[];
}

/** The Bitcoin-level transaction row (mirror: transactions). The base every tx shares. */
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

/** The offered asset's collection identity (when tagged) — the storefront's provenance line:
 *  "THINKINGPEPE · Rare Pepe · Series 4 Card 12". */
export interface TxAssetCollection {
  tag: string;
  site: string | null;
  series: number | null;
  card: number | null;
}

/** The offered asset's issuance brief — total supply + locked state, shown on the storefront. */
export interface TxAssetSupply {
  supply_normalized: string | null;
  divisible: 0 | 1 | null;
  locked: 0 | 1 | null;
}

/** A dispenser's lifetime sales totals — sale count, BTC taken (sats), and UNITS vended (one sale
 *  can vend many multiples of give_quantity, so the stock math needs units, not events). */
export interface DispenserTotals {
  n: number;
  sats: number;
  units: number;
}

/** What a transaction MEANS in Counterparty terms — the classified action with its full record row(s).
 *  One tx = one message type; `send` carries an array because an MPMA send is several sends rows (one per
 *  destination; UTXO attach/detach/move are sends rows too, typed by send_type). Actions that reference a
 *  parent carry it for context — a dispense/refill its dispenser, a fairmint its fairminter, a cancel the
 *  order it cancelled — because the price/terms live there, not on the triggering tx.
 *  Known gap: an OPEN_POOL tx can't be classified (the pools mirror is keyed by lp_asset, no tx_hash). */
export type TxAction =
  | { kind: "send"; sends: SendRow[] }
  | { kind: "dispense"; dispenses: DispenseRow[]; dispenser: DispenserRow | null }
  | {
      kind: "dispenser";
      dispenser: DispenserRow;
      sales: DispenseRow[];
      totals: DispenserTotals | null;
      collection: TxAssetCollection | null;
      supply: TxAssetSupply | null;
    }
  | {
      kind: "refill";
      refill: DispenserRefillRow;
      dispenser: DispenserRow | null;
      sales: DispenseRow[];
      totals: DispenserTotals | null;
      collection: TxAssetCollection | null;
      supply: TxAssetSupply | null;
    }
  | {
      kind: "order";
      order: OrderRow;
      matches: OrderMatchRow[];
      collection: TxAssetCollection | null;
      supply: TxAssetSupply | null;
    }
  | { kind: "cancel"; cancel: CancelRow; order: OrderRow | null }
  | { kind: "btcpay"; btcpay: BtcpayRow }
  | { kind: "issuance"; issuance: IssuanceRow }
  | { kind: "fairminter"; fairminter: FairminterRow }
  | { kind: "fairmint"; fairmint: FairmintRow; fairminter: FairminterRow | null }
  | { kind: "broadcast"; broadcast: BroadcastRow }
  | { kind: "sweep"; sweep: SweepRow }
  | { kind: "dividend"; dividend: DividendRow }
  | { kind: "burn"; burn: BurnRow }
  | { kind: "destruction"; destruction: DestructionRow }
  | { kind: "bet"; bet: BetRow }
  | { kind: "rps"; rps: RpsRow }
  | { kind: "pool_liquidity"; liquidity: PoolLiquidityRow }
  | { kind: "pool_swap"; swap: PoolMatchRow };

/** GET /v2/transactions/:hash/events — one raw Counterparty event of a confirmed tx (proxied from the
 *  node, best-effort). params is the node's open bag of protocol fields, displayed as-is. */
export interface TxEvent {
  event: string;
  event_index: number | null;
  params: Record<string, unknown> | null;
}

/** One side of a Bitcoin tx (input or output), normalized to sats. Fields are null when the source
 *  can't provide them (bitcoind at low verbosity omits input prevout values). */
export interface BitcoinTxIo {
  address: string | null;
  sats: number | null;
  type: string | null; // scriptpubkey type (op_return, p2pkh, …); "coinbase" for coinbase inputs
  prev: string | null; // the input's funding outpoint "txid:vout" when the address is unknown
}

/** GET /v2/transactions/:hash/bitcoin — the Bitcoin-level tx via the Counterparty node's bitcoind
 *  proxy, normalized. The web tries mempool.space first and falls back to this (rate-limit hedge). */
export interface BitcoinTxSummary {
  fee_sats: number | null;
  size: number | null;
  vsize: number | null;
  weight: number | null;
  vin: BitcoinTxIo[];
  vout: BitcoinTxIo[];
}

/** GET /v2/transactions/:hash — the mempool-aware transaction view. Extends the base row ADDITIVELY
 *  (Partial: the mirror fields are absent while the tx is still in the mempool) with the confirmation
 *  state and the classified Counterparty action. 404 only when the tx is in neither the mirror nor the
 *  node's mempool. `pending` carries the node's mempool action rows while unconfirmed. */
export interface TxView extends Partial<TxDetail> {
  tx_hash: string;
  status: "mempool" | "confirmed";
  confirmations: number; // 0 while in mempool
  tip: number | null; // chain tip at read time (what confirmations was computed against)
  action: TxAction | null; // null while pending, or when the message type has no record row (rare kinds)
  pending: MempoolActionRow[]; // [] once confirmed
  /** Counterparty-protocol validity — the third state beyond Bitcoin confirmation. A tx can be
   *  CONFIRMED on Bitcoin yet INVALID in the protocol (the node parsed and rejected it); `status`
   *  carries the node's reason ("invalid: btc order below minimum"). null when the kind carries no
   *  validity status (e.g. a dispense) or the tx is unclassified/pending. */
  protocol: { valid: boolean; status: string | null } | null;
}

/** One era row of the block census (GET /v2/blocks/census `years[]`). */
export interface BlockCensusYear {
  year: string;
  counterparty_txs: number;
  bitcoin_txs: number;
  share_pct: number | null; // Counterparty share of ALL Bitcoin transactions that year
  fees_btc: number; // miner fees paid by Counterparty transactions that year
}

/** GET /v2/blocks/census — the population-level view of twelve years of blocks: how much of
 *  Bitcoin is Counterparty, by era, plus the freshest blocks as a small live strip. */
export interface BlockCensus {
  as_of_block: number;
  blocks_indexed: number;
  blocks_with_counterparty: number;
  counterparty_transactions: number;
  bitcoin_transactions: number;
  fees_btc: number;
  years: BlockCensusYear[];
  recent: BlockRow[];
}
