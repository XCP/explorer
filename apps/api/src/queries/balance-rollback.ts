import { q, one } from "#api/db";
import { balanceQuantity, normalize } from "#api/indexer/codec";
import { parseUtxoHolder } from "#api/indexer/identities";

/** Build all restores before mutating anything. Reverse only ledger events
 * covered by the balance's committed high-water, including partial pages.
 * Neither missing snapshots nor a missing historical ledger means zero. */
export async function balanceRollbackStatements(
  db: D1Database,
  block: number,
  eventIndex: number,
): Promise<D1PreparedStatement[]> {
  const affected = await q<{ holder: string; asset_id: number }>(
    db,
    `SELECT DISTINCT a.address holder,e.asset_id FROM ledger_events e
     JOIN address_dictionary a ON a.address_id=e.address_id WHERE e.block_index>?1
     UNION
     SELECT CASE WHEN s.address_id IS NOT NULL THEN a.address
       ELSE lower(hex(s.utxo_tx_hash))||':'||s.utxo_vout END holder,s.asset_id
     FROM balance_snapshots s LEFT JOIN address_dictionary a ON a.address_id=s.address_id
     WHERE s.block_index>?1`,
    block,
  );
  const statements: D1PreparedStatement[] = [];
  for (const identity of affected) {
    const utxo = identity.holder.includes(":") ? parseUtxoHolder(identity.holder) : null;
    const predicate = utxo
      ? "b.utxo_tx_hash=? AND b.utxo_vout=?"
      : "b.address_id=(SELECT address_id FROM address_dictionary WHERE address=?)";
    const binds = utxo ? [utxo.txHash, utxo.vout] : [identity.holder];
    const current = await one<{
      balance_id: number;
      quantity: string;
      updated_event_index: number;
      updated_block_index: number | null;
      divisible: number;
    }>(
      db,
      `SELECT b.balance_id,b.quantity,b.updated_event_index,b.updated_block_index,
      CASE WHEN d.asset IN ('BTC','XCP') THEN 1 ELSE coalesce(a.divisible,0) END divisible
      FROM balances b JOIN asset_dictionary d ON d.asset_id=b.asset_id
      LEFT JOIN assets a ON a.asset_id=b.asset_id WHERE ${predicate} AND b.asset_id=?`,
      ...binds,
      identity.asset_id,
    );
    if (
      !current ||
      current.updated_event_index <= eventIndex ||
      (current.updated_block_index !== null && current.updated_block_index <= block)
    )
      continue;
    const events = await q<{ event_index: number; quantity: string; direction: number }>(
      db,
      `SELECT event_index,quantity,direction FROM ledger_events
       WHERE address_id=(SELECT address_id FROM address_dictionary WHERE address=?) AND asset_id=?
         AND block_index>? AND event_index<=? ORDER BY event_index DESC LIMIT 50001`,
      identity.holder,
      identity.asset_id,
      block,
      current.updated_event_index,
    );
    if (events.length > 50000 || events[0]?.event_index !== current.updated_event_index) {
      throw new Error(`Incomplete rollback ledger: ${identity.holder} asset=${identity.asset_id}`);
    }
    let quantity = balanceQuantity(current.quantity);
    for (const event of events) {
      if (event.direction !== 0 && event.direction !== 1) throw new Error("Invalid ledger direction");
      quantity -= (event.direction === 1 ? 1n : -1n) * balanceQuantity(event.quantity);
      if (quantity < 0n) throw new Error(`Rollback underflow: ${identity.holder} asset=${identity.asset_id}`);
    }
    statements.push(
      db
        .prepare(
          `UPDATE balances SET quantity=?,quantity_normalized=?,
      updated_block_index=?,updated_event_index=? WHERE balance_id=? AND updated_event_index=?`,
        )
        .bind(
          quantity.toString(),
          normalize(quantity, current.divisible === 1),
          block,
          eventIndex,
          current.balance_id,
          current.updated_event_index,
        ),
    );
  }
  return statements;
}
