/**
 * Counterparty wire-format codec — the two pure functions for safely decoding Counterparty's JSON.
 *
 * Kept separate from the engine and the message handlers because read surfaces (verify, stats/mempool)
 * also need parseCounterpartyJson, and the supply recompute needs normalize.
 */

// Counterparty serializes integer quantity fields (quantity, *_quantity, earned, fee_paid, ...) as BARE JSON
// numbers. Any value > 2^53 (9007199254740992) — large-supply assets, big DEX orders — loses precision
// in JS JSON.parse BEFORE our BigInt conversion runs, yielding off-by-a-few-units sums and thus tiny
// negative balances. Quote every 16+ digit integer (a JSON value) so it survives as a string for exact
// BigInt math. Safe: block/tx/event indexes and unix timestamps are all < 16 digits; tx hashes are
// already quoted strings; quantity_normalized has a decimal point so it won't match \d{16,}.
export function parseCounterpartyJson(text: string): unknown {
  return JSON.parse(text.replace(/:\s*(-?\d{16,})(?=\s*[,}\]])/g, ':"$1"'));
}

// raw -> human string. Divisible assets store satoshis (×1e8); insert the decimal point with pure string
// math (no float) so values > 2^53 stay exact. Non-divisible passes through unchanged.
export function normalize(raw: string | number | bigint | null | undefined, divisible: boolean): string | null {
  if (raw == null) return null;
  let s = typeof raw === "string" ? raw : String(raw);
  if (!divisible) return s;
  const neg = s.startsWith("-"); if (neg) s = s.slice(1);
  s = s.replace(/\D/g, "") || "0";
  const padded = s.padStart(9, "0");
  const out = padded.slice(0, -8) + "." + padded.slice(-8);
  return (neg ? "-" : "") + out;
}
