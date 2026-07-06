/** Pending (mempool) Counterparty actions — a read-through to the node's mempool, never mirrored to D1. */

/**
 * One pending on-chain action, flattened from a raw Counterparty mempool event. A single unconfirmed
 * transaction can yield several rows — an MPMA send to many destinations, or an order matching several
 * resting orders. `event` is the raw Counterparty event name (ENHANCED_SEND, ASSET_ISSUANCE, OPEN_ORDER,
 * OPEN_DISPENSER, DISPENSE, CANCEL_ORDER, SWEEP, …); the other fields are the flattened `params` common
 * to a display row (naming varies by message type, so each is best-effort and nullable).
 */
export interface MempoolActionRow {
  tx_hash: string | null;
  event: string;
  source: string | null;
  destination: string | null;
  asset: string | null;
  asset_longname: string | null;
  quantity_normalized: string | null;
  /** Present on DISPENSE rows — the tx_hash of the dispenser being bought from. */
  dispenser_tx_hash: string | null;
  /** Unix seconds (may carry a fractional part) the node first saw the transaction. */
  timestamp: number | null;
}
