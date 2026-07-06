import type { ReactNode } from "react";

// Mempool presentation shared by the protocol-wide feed, the per-entity "Pending" island, and the tx
// pending view. `kind` collapses the ~25 raw Counterparty event names into a handful of buckets so the
// feed can offer filter chips (like the trades venue filter) and colour each event chip by family.
export type MempoolKind = "send" | "issuance" | "order" | "dispenser" | "other";

const KIND_OF: Record<string, MempoolKind> = {
  ENHANCED_SEND: "send", MPMA_SEND: "send", SEND: "send", SWEEP: "send",
  ATTACH_TO_UTXO: "send", DETACH_FROM_UTXO: "send", UTXO_MOVE: "send", ATTACH: "send", DETACH: "send",
  ASSET_ISSUANCE: "issuance", NEW_ISSUANCE: "issuance", RESET_ISSUANCE: "issuance",
  NEW_FAIRMINTER: "issuance", NEW_FAIRMINT: "issuance", ASSET_DIVIDEND: "issuance", DIVIDEND: "issuance",
  OPEN_ORDER: "order", ORDER_MATCH: "order", CANCEL_ORDER: "order", BTC_PAY: "order",
  OPEN_BET: "order", BET_MATCH: "order",
  OPEN_DISPENSER: "dispenser", REFILL_DISPENSER: "dispenser", DISPENSE: "dispenser",
  ASSET_DESTRUCTION: "other", DESTRUCTION: "other", BROADCAST: "other", BURN: "other",
};
export const kindOf = (event: string): MempoolKind => KIND_OF[event] ?? "other";

// Filter chips for the feed. `undefined` = All; the rest select one kind.
export const MEMPOOL_KINDS: { key: MempoolKind | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "send", label: "Sends" },
  { key: "issuance", label: "Issuance" },
  { key: "order", label: "Orders" },
  { key: "dispenser", label: "Dispensers" },
  { key: "other", label: "Other" },
];

const KIND_STYLE: Record<MempoolKind, string> = {
  send: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  issuance: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  order: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
  dispenser: "bg-orange-500/10 text-orange-300 ring-orange-500/20",
  other: "bg-zinc-800 text-zinc-300 ring-zinc-700",
};

export const eventLabel = (event: string) => event.toLowerCase().replace(/_/g, " ");
export const eventChip = (event: string): ReactNode => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${KIND_STYLE[kindOf(event)]}`}>{eventLabel(event)}</span>
);
