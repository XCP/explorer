/** CREDIT / DEBIT — the ONLY source of balance truth. Every balance change in Counterparty (sends,
 *  dispenses, escrows, fees, settlements, ...) is emitted as a discrete credit/debit, so balances are
 *  computed purely from these as netted BigInt deltas. holder = utxo (utxo-attached) or address.
 *  We ALSO capture each event 1:1 into credits/debits (migration 0038) — the raw ledger that powers the
 *  per-address provenance view and a definitive first-appearance signal (MIN block over credits). */
import { type Handler, addDelta, str } from "#api/indexer/events/context";
import { balanceQuantity } from "#api/indexer/codec";
import { hashToBytes } from "#api/indexer/identities";
const creditDebit: Handler = ({ ev, p, b, div }, ctx) => {
  const holder = (p.utxo as string) || (p.address as string);
  if (!holder || !p.asset) return;
  const htype = p.utxo ? "utxo" : "address";
  const q = balanceQuantity(p.quantity);
  addDelta(
    ctx,
    holder,
    p.asset,
    htype,
    ev.event === "CREDIT" ? q : -q,
    div,
    b,
    ev.event_index,
    p.utxo ? (p.utxo_address ?? null) : null,
  );
  // raw ledger capture — 1:1 mirror rows, idempotent on the globally-unique event_index (replay-safe).
  const utxoAddress = p.utxo ? str(p.utxo_address ?? null) : null;
  ctx.identities.addresses.add(holder);
  ctx.identities.assets.add(p.asset);
  if (utxoAddress) ctx.identities.addresses.add(utxoAddress);
  ctx.stmts.push((db) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger_events
       (event_index,direction,block_index,tx_hash,address_id,asset_id,quantity,calling_function,utxo_address_id)
     SELECT ?,?,?,?,ad.address_id,ast.asset_id,?,?,ua.address_id
       FROM address_dictionary ad JOIN asset_dictionary ast
       LEFT JOIN address_dictionary ua ON ua.address=?
      WHERE ad.address=? AND ast.asset=?`,
      )
      .bind(
        ev.event_index,
        ev.event === "CREDIT" ? 1 : 0,
        b,
        hashToBytes(ev.tx_hash),
        str(p.quantity) ?? "0",
        str(p.calling_function ?? p.category ?? null),
        utxoAddress,
        holder,
        p.asset,
      ),
  );
};
export const balance: Record<string, Handler> = { CREDIT: creditDebit, DEBIT: creditDebit };
