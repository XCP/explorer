/** CREDIT / DEBIT — the ONLY source of balance truth. Every balance change in Counterparty (sends,
 *  dispenses, escrows, fees, settlements, ...) is emitted as a discrete credit/debit, so balances are
 *  computed purely from these as netted BigInt deltas. holder = utxo (utxo-attached) or address.
 *  We ALSO capture each event 1:1 into credits/debits (migration 0038) — the raw ledger that powers the
 *  per-address provenance view and a definitive first-appearance signal (MIN block over credits). */
import { type Handler, addDelta, bi, str } from "./context";

const creditDebit: Handler = ({ ev, p, b, div }, ctx) => {
  const holder = (p.utxo as string) || (p.address as string);
  if (!holder || !p.asset) return;
  const htype = p.utxo ? "utxo" : "address";
  const q = bi(p.quantity);
  addDelta(ctx, holder, p.asset, htype, ev.event === "CREDIT" ? q : -q, div, b, ev.event_index, p.utxo ? (p.utxo_address ?? null) : null);
  // raw ledger capture — 1:1 mirror rows, idempotent on the globally-unique event_index (replay-safe).
  const table = ev.event === "CREDIT" ? "credits" : "debits";
  ctx.stmts.push((db) => db.prepare(
    `INSERT OR IGNORE INTO ${table} (event_index,block_index,tx_hash,address,asset,quantity,calling_function,utxo_address) VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(ev.event_index, b, ev.tx_hash, holder, p.asset, str(p.quantity) ?? "0", str(p.calling_function ?? p.category ?? null), p.utxo ? str(p.utxo_address ?? null) : null));
};

export const balance: Record<string, Handler> = { CREDIT: creditDebit, DEBIT: creditDebit };
