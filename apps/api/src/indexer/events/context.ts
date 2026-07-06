/**
 * Shared toolkit for the message handlers (src/indexer/events/<type>.ts).
 *
 * Each handler receives a decoded Msg + the mutable Ctx and pushes prepared statements / balance deltas
 * onto it. The engine (sync.ts) flushes them. This mirrors counterparty-core's lib/messages/<type>.py:
 * one file per message type, each self-contained, routed by dispatch.ts.
 */

// A statement is a thunk so it can be bound against the live DB inside the batcher.
export type Stmt = (db: D1Database) => D1PreparedStatement;

// One Counterparty event from the verbose event stream.
export interface Ev {
  event_index: number;
  event: string;
  // Decoded Counterparty event payload — intrinsically dynamic (shape varies per event type) and consumed field-by-field
  // by the 20 message handlers; typing it would mean transcribing Counterparty's whole event schema, so it stays `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  tx_hash: string | null;
  block_index: number;
}

// Per-chunk accumulator the engine flushes: row statements, netted balance deltas, the high-water block,
// and the set of assets whose supply changed (recomputed deterministically — see asset-supply.ts).
export interface Ctx {
  stmts: Stmt[];
  balDelta: Map<string, { holder: string; asset: string; htype: string; delta: bigint; divisible: boolean; block: number; evIdx: number; utxoAddr: string | null }>;
  maxBlock: number;
  supplyDirty: Set<string>;
}

// A decoded event handed to a handler: the raw event plus the fields every handler pulls off it.
export interface Msg {
  ev: Ev;
  // ev.params — same intrinsically-dynamic Counterparty payload as Ev.params (see above); the handler seam.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any;            // ev.params
  b: number;         // block_index
  bt: number | null; // block_time
  div: boolean;      // asset_info.divisible (for normalizing this event's quantities)
}

export type Handler = (m: Msg, ctx: Ctx) => void;

// Tag for SQL template literals. Identity at runtime (composes the string for db.prepare), but lets
// prettier-plugin-sql pretty-print the embedded SQL and editors syntax-highlight it.
export const sql = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), "");

/* ---------- value helpers ---------- */

export function str(v: unknown): string | null { return v == null ? null : String(v); }

export function bi(v: unknown): bigint {
  try { return BigInt(typeof v === "string" ? v.split(".")[0] : Math.trunc(Number(v || 0))); } catch { return 0n; }
}

// Cap free-text fields to avoid D1 SQLITE_TOOBIG (asset descriptions can embed base64 image data — MBs).
// Images live in R2; the explorer doesn't need megabyte descriptions. 16KB is plenty for legit content.
export function cap(v: unknown, max = 16384): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

// Accumulate a (holder,asset) balance delta for the chunk. Netted so a credit+debit in one chunk collapses.
export function addDelta(ctx: Ctx, holder: string, asset: string, htype: string, delta: bigint, divisible: boolean, block: number, evIdx: number, utxoAddr: string | null = null) {
  const key = `${holder} ${asset}`;
  const e = ctx.balDelta.get(key);
  if (e) { e.delta += delta; if (block > e.block) e.block = block; if (evIdx > e.evIdx) e.evIdx = evIdx; if (utxoAddr) e.utxoAddr = utxoAddr; }
  else ctx.balDelta.set(key, { holder, asset, htype, delta, divisible, block, evIdx, utxoAddr });
}
