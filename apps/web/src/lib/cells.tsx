import Link from "next/link";
import type { ReactNode } from "react";
import { commas, short, ts } from "@/lib/format";
import { AssetIcon } from "@/components/ui/badges";

// A column definition — the label + how to render one row's cell. RecordTable maps these to
// <Table>/<Row>/<Cell>. `numeric` => right-aligned mono+tabular cell; `hideBelow` drops the column
// below a breakpoint (mobile priority); `weight` sets the zinc hierarchy. Bind T for real row types
// (see the registry and app/trades); the `any` default carries the not-yet-typed legacy call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Col<T = any> = {
  label: string;
  numeric?: boolean;
  cell: (r: T) => ReactNode;
  hideBelow?: "sm" | "md" | "lg";
  weight?: "primary" | "muted";
};
export const HIDE: Record<NonNullable<Col["hideBelow"]>, string> = {
  sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden",
};

// Shared cell renderers (links carry the brand accent via globals; hashes/addresses in mono). Nulls
// render as an em-dash so a Col bound to a nullable row field can pass the value straight through.
export const mono = (n: ReactNode) => <span className="font-mono">{n}</span>;
export const blockCell = (n?: number | null) => (n != null ? <Link href={`/block/${n}`}>{commas(n)}</Link> : "—");
export const txCell = (h?: string | null) => (h ? <Link href={`/tx/${h}`}>{mono(short(h))}</Link> : "—");
export const addrCell = (a?: string | null) => (a ? <Link href={`/address/${a}`}>{mono(a)}</Link> : "—");
export const assetCell = (a?: string | null) =>
  a ? <Link href={`/asset/${a}`} className="inline-flex items-center gap-1.5"><AssetIcon asset={a} size={16} />{a}</Link> : "—";
export const timeCell = (t?: number | null) => <span className="text-zinc-400">{ts(t)}</span>;
