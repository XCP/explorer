/** CREDIT / DEBIT — the ONLY source of balance truth. Every balance change in Counterparty (sends,
 *  dispenses, escrows, fees, settlements, ...) is emitted as a discrete credit/debit, so balances are
 *  computed purely from these as netted BigInt deltas. holder = utxo (utxo-attached) or address. */
import { type Handler, addDelta, bi } from "./context";

const creditDebit: Handler = ({ ev, p, b, div }, ctx) => {
  const holder = (p.utxo as string) || (p.address as string);
  if (!holder || !p.asset) return;
  const htype = p.utxo ? "utxo" : "address";
  const q = bi(p.quantity);
  addDelta(ctx, holder, p.asset, htype, ev.event === "CREDIT" ? q : -q, div, b, ev.event_index, p.utxo ? (p.utxo_address ?? null) : null);
};

export const balance: Record<string, Handler> = { CREDIT: creditDebit, DEBIT: creditDebit };
