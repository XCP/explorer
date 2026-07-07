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

// A column definition — the label + how to render one row's cell. RecordTable renders these on the
// v20 .rt/.tr grammar (globals.css, ported verbatim from design-lab/v20-tables.html).
// `numeric` => right-aligned header (.r) and a .num cell wrapper unless `cellClass` overrides
// (qty = primary quantity, "num usd" = the dollar column); `priority` ranks responsive dropping
// (1 = always visible, 2 drops at 420px, 3+ at 760px); `w`/`w760`/`w420` are the grid tracks per
// breakpoint stage; `omitOn` drops the whole column when the page context already answers it (R4);
// `srOnly` visually hides the header (the trailing View action). Bind T for real row types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Col<T = any> = {
  label: string;
  numeric?: boolean;
  cell: (r: T, ctx: RecordContext, i: number) => ReactNode;
  priority?: 1 | 2 | 3 | 4;
  w?: string;
  w760?: string;
  w420?: string;
  cellClass?: string;
  omitOn?: "asset" | "address" | "block";
  weight?: "primary" | "muted";
  srOnly?: boolean;
  // Sortable header (framework floor / TABLES.md): the key the header reports to onSort. The page
  // decides what it means — a client-side comparator (non-paginated tables) or a server sort param
  // (paginated). Headers without a sortKey stay plain text.
  sortKey?: string;
};

export type SortState = { key: string; dir: "asc" | "desc" };

// Shared cell renderers on the v20 cell classes. Nulls render as an em-dash so a Col bound to a
// nullable row field can pass the value straight through.
export const mono = (n: ReactNode) => <span className="font-mono">{n}</span>;
/** Block link — leading pair, mono muted (.blk). */
export const blockCell = (n?: number | null) => (n != null ? <Link className="blk" href={`/block/${n}`}>{commas(n)}</Link> : <span className="blk">—</span>);
export const txCell = (h?: string | null) => (h ? <Link href={`/tx/${h}`}>{mono(short(h))}</Link> : "—");
/** Address — single-line ellipsis over the FULL string, complete address in title. Never 4+4 (R5). */
export const addrCell = (a?: string | null) => (a ? <Link className="addr" href={`/address/${a}`} title={a}>{a}</Link> : "—");
/** Row anchor: icon + linked mono name, one line (v20 .asset anatomy). `display` overrides (longnames). */
export const assetCell = (a?: string | null, display?: string | null) =>
  a ? <span className="asset"><AssetIcon asset={a} size={22} className="aicon" /><Link className="aname" href={`/asset/${a}`}>{display || a}</Link></span> : "—";
/** Secondary asset reference (16px icon) — e.g. the dividend currency next to the anchor asset. */
export const assetChip = (a?: string | null) =>
  a ? <Link href={`/asset/${a}`} className="inline-flex items-center gap-1.5"><AssetIcon asset={a} size={16} />{a}</Link> : "—";
/** Relative time with the absolute UTC in `title` (R9) — the leading cell (.time). */
export const timeCell = (t?: number | null) =>
  t ? <span className="time" title={ts(t)}>{timeAgo(t)}</span> : <span className="time">—</span>;
/** The row's trailing action — the quiet View link, sr-only header. */
export const viewCell = (h?: string | null) => (h ? <Link className="view" href={`/tx/${h}`}>View</Link> : <span className="view">—</span>);

/** Quantity from the page subject's perspective (R4/R7): "-" red when the subject sent it,
 *  "+" green when it received — the sign is the non-color channel (R8). */
export const signedQty = (v: string | number | null | undefined, ctx: RecordContext, sourceIsSubject: boolean) => {
  if (v == null || v === "") return "—";
  if (!ctx.address) return commas(v);
  return sourceIsSubject
    ? <span className="text-(--color-down)">-{commas(v)}</span>
    : <span className="text-(--color-up)">+{commas(v)}</span>;
};

/** Buy/sell words — the only green/red text in a table outside signed values (v20 .side). */
export const sideWord = (side: "buy" | "sell") => <span className={`side ${side}`}>{side}</span>;

/* ---- status pills (v20 .pill) — earned, never decorative; the label is the redundant channel.
   Variants open/filled/expired/cancelled are verbatim v20; pending is an app extension. ---- */
type PillVariant = "open" | "filled" | "expired" | "cancelled" | "pending";
export const pill = (label: string, variant: PillVariant) => (
  <span className={`pill ${variant}`}>{label}</span>
);
const statusVariant = (s: string): PillVariant => {
  if (s === "open" || s.startsWith("valid")) return "open";
  if (s === "filled" || s === "completed") return "filled";
  if (s === "expired" || s.startsWith("invalid")) return "expired";
  if (s.startsWith("cancelled") || s.startsWith("canceled")) return "cancelled";
  if (s === "pending") return "pending";
  return "cancelled";
};
export const statusPill = (s?: string | null) => (s ? pill(s.split(":")[0], statusVariant(s)) : "—");
/** Dispensers keep their 4-state read: open / empty / closing / closed. */
export const dispenserPill = (status?: number | null, remaining?: string | number | null) => {
  if (status == null) return "—";
  if (status === 0) return Number(remaining) > 0 ? pill("open", "open") : pill("empty", "pending");
  if (status === 11) return pill("closing", "pending");
  return pill("closed", "expired");
};

/** Type chips (v20 .tchip) — EXCEPTIONS ONLY; a chip repeating on ~every row is bypassing noise. */
export const tchip = (label: string) => <span className="tchip">{label}</span>;

/** send_type chip — attach/detach/MPMA/move differ from a plain send; plain sends render NOTHING. */
export const sendTypeChip = (t?: string | null) => {
  if (!t || t === "send" || t === "enhanced_send") return null;
  if (t === "mpma") return tchip("mpma");
  if (t === "attach") return tchip("attach");
  if (t === "detach") return tchip("detach");
  if (t === "move" || t === "utxo_move") return tchip("move");
  return tchip(t.replace(/_/g, " "));
};

/** Tiny padlock (closed/open) — the non-color channel of lock polarity. */
const Padlock = ({ open = false }: { open?: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    {open ? <path d="M8 11V7a4 4 0 0 1 7.7-1.5" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
  </svg>
);

/** Issuance action badge (v20 .abadge) — neutral set; only Lock takes color (lock polarity). */
const ACTION_LABEL: Record<string, string> = {
  creation: "issue",
  reissuance: "issue",
  lock_quantity: "lock",
  lock_description: "lock desc",
  transfer: "transfer",
  reset: "reset",
  change_description: "edit",
  open_fairminter: "fairminter",
  fairmint: "fairmint",
};
export const actionBadge = (events?: string | null) => {
  if (!events) return "—";
  const parts = events.split(/[\s,]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "—";
  return (
    <span className="inline-flex gap-1">
      {parts.map((e) => {
        const locked = e === "lock_quantity" || e === "lock_description";
        return (
          <span key={e} className={`abadge${locked ? " lock" : ""}`}>
            {locked && <Padlock />}
            {ACTION_LABEL[e] ?? e.replace(/_/g, " ")}
          </span>
        );
      })}
    </span>
  );
};

/** Lock polarity state (v20 .lockstate): locked = green closed padlock, unlocked = amber open. */
export const lockStateCell = (locked?: boolean | number | null) => {
  if (locked == null) return "—";
  const isLocked = !!locked;
  return (
    <span className={`lockstate ${isLocked ? "locked" : "unlocked"}`}>
      <Padlock open={!isLocked} />
      {isLocked ? "locked" : "unlocked"}
    </span>
  );
};

/** Sweep flags — the full balances+ownership sweep is the norm and renders nothing; only partial
 *  sweeps (the exceptions) earn a chip. Bitmask 1=balances, 2=ownership. */
export const sweepFlagsBadge = (flags?: number | null) => {
  if (flags == null) return null;
  const balances = !!(flags & 1), ownership = !!(flags & 2);
  if (balances && ownership) return null;
  if (balances) return tchip("balances only");
  if (ownership) return tchip("ownership only");
  return null;
};

/** Bet type — what the bet IS (0/1 = CFDs, 2/3 = binary outcomes). */
const BET_TYPES: Record<number, string> = { 0: "Bullish CFD", 1: "Bearish CFD", 2: "Equal", 3: "NotEqual" };
export const betTypeBadge = (t?: number | null) => (t != null && BET_TYPES[t] ? tchip(BET_TYPES[t]) : "—");
