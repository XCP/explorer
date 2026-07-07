import Link from "next/link";
import type { ReactNode } from "react";
import { commas, short, ts, timeAgo } from "@/lib/format";
import { AssetIcon } from "@/components/ui/badges";

/** The page subject a record table renders under — drives contextual column suppression (R4:
 *  never render the column the page already answers) and perspective signing of quantities.
 *  `tip` (chain height) powers lifetime cells (order Expires); `offset` powers rank columns. */
export type RecordContext = {
  asset?: string;
  address?: string;
  block?: number;
  tip?: number;
  offset?: number;
};

// A column definition — the label + how to render one row's cell. RecordTable renders these as the
// v19 .xtable grid. `numeric` => right-aligned mono+tabular (.xt-price); `priority` ranks responsive
// dropping (1 = always visible, 4 drops first; default 2); `w` is the column's grid track;
// `omitOn` drops the whole column when the page context already answers it (R4); `srOnly` visually
// hides the header (the trailing View action). Bind T for real row types (see the registry and
// app/trades); the `any` default carries the not-yet-typed legacy call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Col<T = any> = {
  label: string;
  numeric?: boolean;
  cell: (r: T, ctx: RecordContext, i: number) => ReactNode;
  priority?: 1 | 2 | 3 | 4;
  w?: string;
  omitOn?: "asset" | "address" | "block";
  weight?: "primary" | "muted";
  srOnly?: boolean;
};

// Shared cell renderers (links carry the brand accent via globals; hashes/addresses in mono). Nulls
// render as an em-dash so a Col bound to a nullable row field can pass the value straight through.
export const mono = (n: ReactNode) => <span className="font-mono">{n}</span>;
export const blockCell = (n?: number | null) => (n != null ? <Link href={`/block/${n}`}>{commas(n)}</Link> : "—");
export const txCell = (h?: string | null) => (h ? <Link href={`/tx/${h}`}>{mono(short(h))}</Link> : "—");
export const addrCell = (a?: string | null) => (a ? <span className="xt-addr" title={a}><Link href={`/address/${a}`}>{a}</Link></span> : "—");
/** Row anchor: ≥24px icon + linked name (R2). `display` overrides the shown name (longnames). */
export const assetCell = (a?: string | null, display?: string | null) =>
  a ? <Link href={`/asset/${a}`} className="inline-flex max-w-full items-center gap-2 min-w-0"><AssetIcon asset={a} size={28} className="xt-icon" /><span className="xt-name">{display || a}</span></Link> : "—";
/** Secondary asset reference (16px icon) — e.g. the dividend currency next to the anchor asset. */
export const assetChip = (a?: string | null) =>
  a ? <Link href={`/asset/${a}`} className="inline-flex items-center gap-1.5"><AssetIcon asset={a} size={16} />{a}</Link> : "—";
/** Relative time with the absolute UTC in `title` (R9). */
export const timeCell = (t?: number | null) =>
  t ? <span className="xt-time" title={ts(t)}>{timeAgo(t)}</span> : <span className="xt-time">—</span>;
/** The row's trailing action — a right-aligned View link, sr-only header (T4). */
export const viewCell = (h?: string | null) => (h ? <span className="xt-view"><Link href={`/tx/${h}`}>View</Link></span> : "—");

/** Quantity from the page subject's perspective (R4/R7): "-" red when the subject sent it,
 *  "+" green when it received — the sign is the non-color channel (R8). */
export const signedQty = (v: string | number | null | undefined, ctx: RecordContext, sourceIsSubject: boolean) => {
  if (v == null || v === "") return "—";
  if (!ctx.address) return commas(v);
  return sourceIsSubject
    ? <span className="text-red-400">-{commas(v)}</span>
    : <span className="text-green-400">+{commas(v)}</span>;
};

/* ---- status pills (R10) — text-in-pill is the redundant channel, so green/red are allowed ---- */
const PILL = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap";
const PILL_STYLE: Record<string, string> = {
  green: "bg-green-400/10 text-green-400 ring-green-400/20",
  blue: "bg-blue-400/10 text-blue-400 ring-blue-400/20",
  red: "bg-red-400/10 text-red-400 ring-red-400/20",
  gray: "bg-zinc-400/10 text-zinc-400 ring-zinc-400/20",
  yellow: "bg-yellow-400/10 text-yellow-400 ring-yellow-400/20",
  orange: "bg-orange-400/10 text-orange-400 ring-orange-400/20",
  indigo: "bg-indigo-400/10 text-indigo-400 ring-indigo-400/20",
};
export const pill = (label: string, color: keyof typeof PILL_STYLE) => (
  <span className={`${PILL} ${PILL_STYLE[color]}`}>{label}</span>
);
const statusColor = (s: string): keyof typeof PILL_STYLE => {
  if (s === "open" || s.startsWith("valid")) return "green";
  if (s === "filled") return "blue";
  if (s === "expired" || s.startsWith("invalid")) return "red";
  if (s.startsWith("cancelled") || s.startsWith("canceled")) return "gray";
  if (s === "pending") return "yellow";
  if (s === "completed") return "indigo";
  return "gray";
};
export const statusPill = (s?: string | null) => (s ? pill(s.split(":")[0], statusColor(s)) : "—");
/** Dispensers keep their own 4-state palette: open / open-empty / closing / closed. */
export const dispenserPill = (status?: number | null, remaining?: string | number | null) => {
  if (status == null) return "—";
  if (status === 0) return Number(remaining) > 0 ? pill("open", "green") : pill("empty", "yellow");
  if (status === 11) return pill("closing", "orange");
  return pill("closed", "red");
};

/* ---- small neutral chips — labeled, never green/red (R8: chips are not market semantics) ---- */
const CHIP = "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset whitespace-nowrap";
const CHIP_STYLE: Record<string, string> = {
  zinc: "bg-zinc-800 text-zinc-300 ring-zinc-700",
  sky: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  violet: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
  indigo: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20",
  fuchsia: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20",
};
export const chip = (label: string, color: keyof typeof CHIP_STYLE = "zinc") => (
  <span className={`${CHIP} ${CHIP_STYLE[color]}`}>{label}</span>
);

/** send_type chip — attach/detach/MPMA/move are different actions than a plain send (audit #10).
 *  Plain sends render NOTHING: a chip repeating on ~every row is bypassing noise — only the
 *  exceptions earn ink. */
export const sendTypeChip = (t?: string | null) => {
  if (!t || t === "send" || t === "enhanced_send") return null;
  if (t === "mpma") return chip("MPMA", "sky");
  if (t === "attach") return chip("attach", "violet");
  if (t === "detach") return chip("detach", "violet");
  if (t === "move" || t === "utxo_move") return chip("move", "amber");
  return chip(t);
};

/** Issuance action badge from Counterparty's stored asset_events (audit #5). */
const ACTION_CHIP: Record<string, { label: string; color: keyof typeof CHIP_STYLE }> = {
  creation: { label: "create", color: "sky" },
  reissuance: { label: "issue", color: "amber" },
  lock_quantity: { label: "lock", color: "violet" },
  lock_description: { label: "lock desc", color: "violet" },
  transfer: { label: "transfer", color: "fuchsia" },
  reset: { label: "reset", color: "indigo" },
  change_description: { label: "edit", color: "zinc" },
  open_fairminter: { label: "fairminter", color: "indigo" },
  fairmint: { label: "fairmint", color: "indigo" },
};
export const actionBadge = (events?: string | null) => {
  if (!events) return "—";
  const parts = events.split(/[\s,]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "—";
  return (
    <span className="inline-flex gap-1">
      {parts.map((e) => { const c = ACTION_CHIP[e] ?? { label: e.replace(/_/g, " "), color: "zinc" as const }; return <span key={e}>{chip(c.label, c.color)}</span>; })}
    </span>
  );
};

/** Sweep flags badge — bitmask 1=balances, 2=ownership (4=binary memo is a memo detail, not shown).
 *  The full balances+ownership sweep is the norm and renders nothing; only partial sweeps (the
 *  exceptions) earn a chip. */
export const sweepFlagsBadge = (flags?: number | null) => {
  if (flags == null) return "—";
  const balances = !!(flags & 1), ownership = !!(flags & 2);
  if (balances && ownership) return null;
  if (balances) return chip("balances only", "sky");
  if (ownership) return chip("ownership only", "violet");
  return "—";
};

/** Bet type badge — what the bet IS (0/1 = CFDs, 2/3 = binary outcomes). */
const BET_TYPES: Record<number, string> = { 0: "Bullish CFD", 1: "Bearish CFD", 2: "Equal", 3: "NotEqual" };
export const betTypeBadge = (t?: number | null) => (t != null && BET_TYPES[t] ? chip(BET_TYPES[t], "sky") : "—");
