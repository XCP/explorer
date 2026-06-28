import Link from "next/link";
import type { ReactNode } from "react";
import type { IndexName } from "@/lib/hooks";
import { commas, short, ts } from "@/lib/format";
import { AssetIcon } from "@/components/ui";
import { orderView } from "@/lib/trading-pair";

// Per-index display config — the single place that knows each model's columns + how to render a row.
// IndexPage maps these to <Table>/<Row>/<Cell>. `numeric: true` => right-aligned mono cell.
export type Col = { label: string; numeric?: boolean; cell: (r: any) => ReactNode };
export type IndexDef = { title: string; cols: Col[] };

// shared cell renderers (links carry the brand accent via globals; hashes/addresses in mono)
export const mono = (n: ReactNode) => <span className="font-mono">{n}</span>;
export const bl = (n: number) => (n != null ? <Link href={`/block/${n}`}>{commas(n)}</Link> : "—");
export const tx = (h?: string) => (h ? <Link href={`/tx/${h}`}>{mono(short(h))}</Link> : "—");
export const ad = (a?: string) => (a ? <Link href={`/address/${a}`}>{mono(short(a))}</Link> : "—");
export const as = (a?: string) =>
  a ? <Link href={`/asset/${a}`} className="inline-flex items-center gap-1.5"><AssetIcon asset={a} size={16} />{a}</Link> : "—";
export const time = (t?: number) => <span className="text-zinc-500">{ts(t)}</span>;

const cBlock: Col = { label: "Block", numeric: true, cell: (r) => bl(r.block_index) };
const cTime: Col = { label: "Time", cell: (r) => time(r.block_time) };
const cTx: Col = { label: "Tx", cell: (r) => tx(r.tx_hash) };
const cSource: Col = { label: "Source", cell: (r) => ad(r.source) };

// order display via base/quote: pair (base linked + quote), side, price (in quote), amount (base)
const fmtPrice = (n: number) => (n === 0 ? "—" : n >= 1 ? commas(n.toFixed(4)) : n.toPrecision(3));
const side = (d: "buy" | "sell") => <span className={d === "buy" ? "text-green-400" : "text-red-400"}>{d}</span>;
const pairCell = (r: any) => {
  const v = orderView(r);
  return <span className="inline-flex items-center gap-1"><Link href={`/asset/${v.base}`}>{v.base}</Link><span className="text-zinc-600">/{v.quote}</span></span>;
};
export const ORDER_COLS: Col[] = [
  cBlock,
  { label: "Pair", cell: pairCell },
  { label: "Side", cell: (r) => side(orderView(r).direction) },
  { label: "Price", numeric: true, cell: (r) => { const v = orderView(r); return v.price ? `${fmtPrice(v.price)} ${v.quote}` : "—"; } },
  { label: "Amount", numeric: true, cell: (r) => commas(orderView(r).baseQty) },
  { label: "Status", cell: (r) => r.status },
  cTx,
];

// asset-list rows (subassets, assets-by-issuer)
export const ASSET_LIST_COLS: Col[] = [
  { label: "Asset", cell: (r) => <Link href={`/asset/${r.asset}`} className="inline-flex items-center gap-2"><AssetIcon asset={r.asset} size={16} />{r.asset_longname || r.asset}</Link> },
  { label: "Locked", cell: (r) => (r.locked ? "locked" : "open") },
  { label: "Created", numeric: true, cell: (r) => bl(r.first_issuance_block_index) },
];

// dispenser price is the BTC paid per unit (satoshirate). Show BTC, or sats when it's tiny.
const btcPrice = (n: any) => { const v = Number(n); if (!v) return "—"; return v < 0.0001 ? `${Math.round(v * 1e8).toLocaleString()} sats` : `${v} BTC`; };
export const DISPENSER_COLS: Col[] = [
  cBlock,
  { label: "Asset", cell: (r) => as(r.asset) },
  { label: "Price", numeric: true, cell: (r) => btcPrice(r.satoshirate_normalized) },
  { label: "Remaining", numeric: true, cell: (r) => commas(r.give_remaining_normalized) },
  { label: "Sales", numeric: true, cell: (r) => commas(r.dispense_count) },
  cSource, cTx,
];

export const INDEXES: Partial<Record<IndexName, IndexDef>> = {
  transactions: { title: "Transactions", cols: [
    cBlock, cTime,
    { label: "Tx", cell: (r) => tx(r.tx_hash) },
    cSource,
    { label: "Destination", cell: (r) => ad(r.destination) },
  ] },
  sends: { title: "Sends", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    cSource, { label: "Destination", cell: (r) => ad(r.destination) }, cTx,
  ] },
  issuances: { title: "Issuances", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset_longname || r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    { label: "Issuer", cell: (r) => ad(r.issuer) }, { label: "Status", cell: (r) => r.status }, cTx,
  ] },
  orders: { title: "Orders", cols: ORDER_COLS },
  order_matches: { title: "Order Matches", cols: [
    cBlock, { label: "Forward", cell: (r) => as(r.forward_asset) }, { label: "Backward", cell: (r) => as(r.backward_asset) },
    { label: "Status", cell: (r) => r.status }, { label: "Party A", cell: (r) => ad(r.tx0_address) },
  ] },
  dispensers: { title: "Dispensers", cols: DISPENSER_COLS },
  dispenses: { title: "Dispenses", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
    cSource, { label: "Destination", cell: (r) => ad(r.destination) }, cTx,
  ] },
  sweeps: { title: "Sweeps", cols: [
    cBlock, cSource, { label: "Destination", cell: (r) => ad(r.destination) },
    { label: "Memo", cell: (r) => <span className="text-zinc-400">{short(r.memo, 18, 0)}</span> }, cTx,
  ] },
  broadcasts: { title: "Broadcasts", cols: [
    cBlock, cSource, { label: "Value", numeric: true, cell: (r) => r.value },
    { label: "Text", cell: (r) => <span className="text-zinc-400">{short(r.text, 28, 0)}</span> }, cTx,
  ] },
  burns: { title: "Burns", cols: [
    cBlock, cSource,
    { label: "Burned (BTC)", numeric: true, cell: (r) => commas(r.burned_normalized) },
    { label: "Earned (XCP)", numeric: true, cell: (r) => commas(r.earned_normalized) }, cTx,
  ] },
  dividends: { title: "Dividends", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset) }, { label: "Dividend", cell: (r) => as(r.dividend_asset) },
    { label: "Per Unit", numeric: true, cell: (r) => commas(r.quantity_per_unit_normalized) }, cSource, cTx,
  ] },
  bets: { title: "Bets", cols: [
    cBlock, cSource, { label: "Feed", cell: (r) => ad(r.feed_address) },
    { label: "Wager", numeric: true, cell: (r) => commas(r.wager_quantity) },
    { label: "Status", cell: (r) => r.status }, cTx,
  ] },
  fairminters: { title: "Fairminters", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset_longname || r.asset) },
    { label: "Price", numeric: true, cell: (r) => commas(r.price) },
    { label: "Hard Cap", numeric: true, cell: (r) => commas(r.hard_cap) },
    { label: "Status", cell: (r) => r.status }, cSource,
  ] },
  fairmints: { title: "Fairmints", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset) },
    { label: "Earned", numeric: true, cell: (r) => commas(r.earn_quantity) }, cSource, cTx,
  ] },
  destructions: { title: "Destructions", cols: [
    cBlock, { label: "Asset", cell: (r) => as(r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    { label: "Tag", cell: (r) => <span className="text-zinc-400">{short(r.tag, 16, 0)}</span> }, cSource, cTx,
  ] },
  btcpays: { title: "BTCPays", cols: [
    cBlock, cSource, { label: "Destination", cell: (r) => ad(r.destination) },
    { label: "BTC", numeric: true, cell: (r) => commas(r.btc_amount_normalized) }, cTx,
  ] },
};

// URL slug -> endpoint/IndexName (slugs match the legacy explorer where they differ from the table name).
export const SLUG_TO_INDEX: Record<string, IndexName> = {
  transactions: "transactions", sends: "sends", issuances: "issuances", orders: "orders",
  matches: "order_matches", dispensers: "dispensers", dispenses: "dispenses", sweeps: "sweeps",
  broadcasts: "broadcasts", burns: "burns", dividends: "dividends", bets: "bets",
  fairminters: "fairminters", fairmints: "fairmints", destructions: "destructions", btcpays: "btcpays",
};
