/**
 * UTXO holder queries — the SQL behind GET /v2/utxos/:utxo. A UTXO holder lives in two places:
 * `balances` rows keyed by (utxo_tx_hash, utxo_vout) while assets are attached to that exact output,
 * and `sends` rows (send_type attach/move/detach) where the "txid:vout" string is a dictionary
 * entity on either side. History reads the sends; liveness reads the balances.
 */
import type { UtxoBalance, UtxoEvent } from "@xcp/shared/utxos";
import { one, q } from "#api/db";

export function utxoBalances(db: D1Database, txHash: Uint8Array, vout: number): Promise<UtxoBalance[]> {
  return q<UtxoBalance>(
    db,
    `SELECT dictionary.asset, state.asset_longname, balance.quantity_normalized
     FROM balances balance
     JOIN asset_dictionary dictionary ON dictionary.asset_id=balance.asset_id
     LEFT JOIN assets state ON state.asset_id=balance.asset_id
     WHERE balance.utxo_tx_hash=?1 AND balance.utxo_vout=?2 AND CAST(balance.quantity AS INTEGER)>0
     ORDER BY dictionary.asset`,
    txHash,
    vout,
  );
}

/** The live controlling address while attached (balances.utxo_address_id). */
export function utxoController(db: D1Database, txHash: Uint8Array, vout: number): Promise<{ address: string } | null> {
  return one<{ address: string }>(
    db,
    `SELECT controller.address FROM balances balance
     JOIN address_dictionary controller ON controller.address_id=balance.utxo_address_id
     WHERE balance.utxo_tx_hash=?1 AND balance.utxo_vout=?2 AND balance.utxo_address_id IS NOT NULL
     LIMIT 1`,
    txHash,
    vout,
  );
}

/** Every attach / move / detach with this "txid:vout" entity on either side, oldest first. */
export function utxoHistory(db: D1Database, utxo: string): Promise<UtxoEvent[]> {
  return q<UtxoEvent>(
    db,
    `WITH holder AS (SELECT address_id FROM address_dictionary WHERE address=?1)
     SELECT send.send_type type, send.block_time,
       CASE WHEN send.tx_hash IS NOT NULL THEN lower(hex(send.tx_hash)) END tx_hash,
       asset.asset, send.quantity_normalized,
       source.address source, destination.address destination,
       source_address.address source_address, destination_address.address destination_address
     FROM sends send
     LEFT JOIN asset_dictionary asset ON asset.asset_id=send.asset_id
     LEFT JOIN address_dictionary source ON source.address_id=send.source_id
     LEFT JOIN address_dictionary destination ON destination.address_id=send.destination_id
     LEFT JOIN address_dictionary source_address ON source_address.address_id=send.source_address_id
     LEFT JOIN address_dictionary destination_address ON destination_address.address_id=send.destination_address_id
     WHERE send.send_type IN ('attach','move','detach')
       AND (send.source_id=(SELECT address_id FROM holder) OR send.destination_id=(SELECT address_id FROM holder))
     ORDER BY send.block_index, send.msg_index`,
    utxo,
  );
}
