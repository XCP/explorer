import Link from "next/link";
import type { PoolRow,
  RecordKind, RecordRowMap, OrderRow, DispenserRow, FairmintRow, DividendRow, DestructionRow,
} from "@xcp/shared/records";
import type { AssetListRow } from "@xcp/shared/assets";
import { commas, compact, short } from "@/lib/format";
import { orderView } from "@/lib/trading-pair";
import { AssetIcon } from "@/components/ui/badges";
import { type Col, blockCell, txCell, addrCell, assetCell, timeCell } from "@/lib/cells";

// The record catalog — for each RecordKind the explorer serves as a list feed, its URL slug, page
// title, and column layout. Keyed by RecordKind so the API's list routes and the web's index pages
// share one source of truth; column cells are typed to the feed's row (Col<RecordRowMap[K]>). The
// five kinds with no page (bet_matches, rps, rps_matches, pool_matches) simply have no entry.
// Pools have no index page yet, but the asset page's Pools tab renders them (payload first: the
// pair and its reserves; the LP token is the pool's identity on Counterparty).
export const POOL_COLS: Col<PoolRow>[] = [
  { label: "Pair", cell: (r) => <span className="font-mono text-zinc-100">{r.pair ?? `${r.asset_a ?? "?"}/${r.asset_b ?? "?"}`}</span> },
  { label: "Reserves", numeric: true, cell: (r) => <span className="font-mono tabular-nums">{compact(r.reserve_a)} / {compact(r.reserve_b)}</span> },
  { label: "LP token", cell: (r) => assetCell(r.lp_asset) },
  { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
]


// Shared columns. Low-priority ones carry hideBelow so they drop first on narrow screens, leaving the
// identity + key metric. Block stays (primary locator); Time/Status/Destination/Tx yield on mobile.
const cBlock: Col = { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) };
const cTime: Col = { label: "Time", cell: (r) => timeCell(r.block_time), hideBelow: "md" };
const cTx: Col = { label: "Tx", cell: (r) => txCell(r.tx_hash), hideBelow: "sm" };
const cSource: Col = { label: "Source", cell: (r) => addrCell(r.source) };
const cDest: Col = { label: "Destination", cell: (r) => addrCell(r.destination), hideBelow: "md" };
const cStatus: Col = { label: "Status", cell: (r) => r.status, hideBelow: "sm" };

// order display via base/quote: pair (base linked + quote), side, price (in quote), amount (base)
const fmtPrice = (n: number) => (n === 0 ? "—" : n >= 1 ? commas(n.toFixed(4)) : n.toPrecision(3));
const side = (d: "buy" | "sell") => <span className={d === "buy" ? "text-green-400" : "text-red-400"}>{d}</span>;
const pairCell = (r: OrderRow) => {
  const v = orderView(r);
  return <span className="inline-flex items-center gap-1"><Link href={`/asset/${v.base}`}>{v.base}</Link><span className="text-zinc-600">/{v.quote}</span></span>;
};
export const ORDER_COLS: Col<OrderRow>[] = [
  cBlock,
  { label: "Pair", cell: pairCell },
  { label: "Side", cell: (r) => side(orderView(r).direction) },
  { label: "Price", numeric: true, cell: (r) => { const v = orderView(r); return v.price ? `${fmtPrice(v.price)} ${v.quote}` : "—"; } },
  { label: "Amount", numeric: true, cell: (r) => commas(orderView(r).baseQty) },
  cStatus,
  cTx,
];

// asset-list rows (subassets, assets-by-issuer, an address's issued assets)
export const ASSET_LIST_COLS: Col<AssetListRow>[] = [
  { label: "Asset", cell: (r) => <Link href={`/asset/${r.asset}`} className="inline-flex items-center gap-2"><AssetIcon asset={r.asset} size={16} />{r.asset_longname || r.asset}</Link> },
  { label: "Locked", cell: (r) => (r.locked ? "locked" : "open") },
  { label: "Created", numeric: true, cell: (r) => blockCell(r.first_issuance_block_index) },
];

// dispenser price is the BTC paid per unit (satoshirate). Show BTC, or sats when it's tiny.
const btcPrice = (n?: string | number | null) => { const v = Number(n); if (!v) return "—"; return v < 0.0001 ? `${Math.round(v * 1e8).toLocaleString()} sats` : `${v} BTC`; };
export const DISPENSER_COLS: Col<DispenserRow>[] = [
  cBlock,
  { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset) },
  { label: "Price", numeric: true, cell: (r) => btcPrice(r.satoshirate_normalized) },
  { label: "Remaining", numeric: true, cell: (r) => commas(r.give_remaining_normalized) },
  { label: "Sales", numeric: true, cell: (r) => compact(r.dispense_count) },
  cSource, cTx,
];

// fairmint / dividend / destruction rows — also reused by the per-asset feed tabs (asset-tabs.tsx)
export const FAIRMINT_COLS: Col<FairmintRow>[] = [
  cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset) },
  { label: "Earned", numeric: true, cell: (r) => commas(r.earn_quantity) }, cSource, cTx,
];
export const DIVIDEND_COLS: Col<DividendRow>[] = [
  cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset) }, { label: "Dividend", cell: (r) => assetCell(r.dividend_asset) },
  { label: "Per Unit", numeric: true, cell: (r) => commas(r.quantity_per_unit_normalized) }, cSource, cTx,
];
export const DESTRUCTION_COLS: Col<DestructionRow>[] = [
  cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset) },
  { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
  { label: "Tag", hideBelow: "md", cell: (r) => <span className="text-zinc-400">{short(r.tag, 16, 0)}</span> }, cSource, cTx,
];

type RegistryEntry<K extends RecordKind> = { slug: string; title: string; cols: Col<RecordRowMap[K]>[] };
type Registry = { [K in RecordKind]?: RegistryEntry<K> };

export const REGISTRY: Registry = {
  transactions: { slug: "transactions", title: "Transactions", cols: [
    cBlock, cTime, cTx, cSource, cDest,
  ] },
  sends: { slug: "sends", title: "Sends", cols: [
    cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    cSource, cDest, cTx,
  ] },
  issuances: { slug: "issuances", title: "Issuances", cols: [
    cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset_longname || r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
    { label: "Issuer", cell: (r) => addrCell(r.issuer) }, cStatus, cTx,
  ] },
  orders: { slug: "orders", title: "Orders", cols: ORDER_COLS },
  order_matches: { slug: "matches", title: "Order Matches", cols: [
    cBlock, { label: "Forward", cell: (r) => assetCell(r.forward_asset) }, { label: "Backward", cell: (r) => assetCell(r.backward_asset) },
    cStatus, { label: "Party A", cell: (r) => addrCell(r.tx0_address) },
  ] },
  dispensers: { slug: "dispensers", title: "Dispensers", cols: DISPENSER_COLS },
  dispenses: { slug: "dispenses", title: "Dispenses", cols: [
    cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset) },
    { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
    cSource, cDest, cTx,
  ] },
  sweeps: { slug: "sweeps", title: "Sweeps", cols: [
    cBlock, cSource, cDest,
    { label: "Memo", hideBelow: "md", cell: (r) => <span className="text-zinc-400">{short(r.memo, 18, 0)}</span> }, cTx,
  ] },
  broadcasts: { slug: "broadcasts", title: "Broadcasts", cols: [
    cBlock, cSource, { label: "Value", numeric: true, cell: (r) => r.value },
    { label: "Text", hideBelow: "sm", cell: (r) => <span className="text-zinc-400">{short(r.text, 28, 0)}</span> }, cTx,
  ] },
  burns: { slug: "burns", title: "Burns", cols: [
    cBlock, cSource,
    { label: "Burned (BTC)", numeric: true, cell: (r) => commas(r.burned_normalized) },
    { label: "Earned (XCP)", numeric: true, cell: (r) => commas(r.earned_normalized) }, cTx,
  ] },
  dividends: { slug: "dividends", title: "Dividends", cols: DIVIDEND_COLS },
  bets: { slug: "bets", title: "Bets", cols: [
    cBlock, cSource, { label: "Feed", cell: (r) => addrCell(r.feed_address) },
    { label: "Wager", numeric: true, cell: (r) => commas(r.wager_quantity) },
    cStatus, cTx,
  ] },
  fairminters: { slug: "fairminters", title: "Fairminters", cols: [
    cBlock, { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset_longname || r.asset) },
    { label: "Price", numeric: true, cell: (r) => commas(r.price) },
    { label: "Hard Cap", numeric: true, cell: (r) => compact(r.hard_cap) },
    cStatus, cSource,
  ] },
  fairmints: { slug: "fairmints", title: "Fairmints", cols: FAIRMINT_COLS },
  destructions: { slug: "destructions", title: "Destructions", cols: DESTRUCTION_COLS },
  btcpays: { slug: "btcpays", title: "BTCPays", cols: [
    cBlock, cSource, cDest,
    { label: "BTC", numeric: true, cell: (r) => commas(r.btc_amount_normalized) }, cTx,
  ] },
};
