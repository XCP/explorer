/** UTXO holder detail (GET /v2/utxos/:utxo) — the address view's counterpart for utxo-attached
 *  balances. A UTXO is a transient holder: assets attach to it, ride along every Bitcoin spend
 *  (each spend is a `move` to a successor UTXO), and eventually detach back to an address. */

export interface UtxoBalance {
  asset: string;
  asset_longname: string | null;
  quantity_normalized: string | null;
}

/** One attach / move / detach touching this UTXO. Source/destination are utxo strings ("txid:vout")
 *  or bare addresses depending on the operation's direction; the *_address fields carry the
 *  controlling Bitcoin addresses when the protocol reports them. */
export interface UtxoEvent {
  type: "attach" | "move" | "detach";
  block_time: number | null;
  tx_hash: string | null;
  asset: string | null;
  quantity_normalized: string | null;
  source: string | null;
  destination: string | null;
  source_address: string | null;
  destination_address: string | null;
}

export interface UtxoDetail {
  utxo: string; // "txid:vout"
  /** Controlling Bitcoin address — live owner while attached, else the last known controller. */
  address: string | null;
  /** true while balances still live on this exact output; false once moved on or detached. */
  attached: boolean;
  balances: UtxoBalance[];
  /** Every operation that touched this UTXO, oldest first. */
  history: UtxoEvent[];
}
