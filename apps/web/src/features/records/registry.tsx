import Link from "next/link";
import type {
  PoolRow,
  RecordKind,
  RecordRowMap,
  OrderRow,
  OrderMatchRow,
  DispenserRow,
  FairmintRow,
  DividendRow,
  DestructionRow,
} from "@xcp/shared/records";
import type { AssetListRow } from "@xcp/shared/assets";
import { commas, compact, short, fromSats } from "@/lib/format";
import { orderView, matchView } from "@/lib/trading-pair";
import {
  lockStateCell,
  type Col,
  type RecordContext,
  blockCell,
  txCell,
  addrCell,
  addrEndsCell,
  assetCell,
  assetChip,
  timeCell,
  viewCell,
  signedQty,
  statusPill,
  dispenserPill,
  sendTypeChip,
  actionBadge,
  sweepFlagsBadge,
  betTypeBadge,
  tchip,
} from "@/features/records/cells";
import { AssetIcon } from "@/components/ui/badges";

// The record catalog — for each RecordKind the explorer serves as a list feed, its URL slug, page
// title, and column layout. Keyed by RecordKind so the API's list routes and the web's index pages
// share one source of truth; column cells are typed to the feed's row (Col<RecordRowMap[K]>).
//
// Column grammar (TABLES.md): payload first, then the fixed trailing run Status? · Block · Time ·
// View (Status only where the record has state worth showing; state tables — orders, dispensers,
// fairminters, bets — drop Time from the run per their spec stanzas). Contextual suppression via
// omitOn; quantities sign from the page subject's perspective on address tabs.
export const POOL_COLS: Col<PoolRow>[] = [
  {
    label: "Pair",
    priority: 1,
    cell: (r) => <span className="font-mono text-zinc-100">{r.pair ?? `${r.asset_a ?? "?"}/${r.asset_b ?? "?"}`}</span>,
  },
  {
    label: "Reserves",
    numeric: true,
    priority: 1,
    w: "170px",
    cell: (r) => (
      <span className="font-mono tabular-nums">
        {compact(r.reserve_a)} / {compact(r.reserve_b)}
      </span>
    ),
  },
  { label: "LP token", priority: 2, cell: (r) => assetChip(r.lp_asset) },
  { label: "Block", priority: 3, w: "62px", cell: (r) => blockCell(r.block_index), omitOn: "block" },
];

// The trailing locator run (T1/T4). Block links + comma-groups, suppressed on block pages; Time is
// relative with the absolute UTC in title; View is the row's single action with an sr-only header.
const cBlock: Col = { label: "Block", priority: 3, w: "62px", omitOn: "block", cell: (r) => blockCell(r.block_index) };
const cTime: Col = {
  label: "Time",
  priority: 1,
  w: "72px",
  w760: "64px",
  w420: "52px",
  cell: (r) => timeCell(r.block_time),
};
const cView: Col = {
  label: "View",
  srOnly: true,
  priority: 1,
  w: "44px",
  w760: "40px",
  w420: "34px",
  cell: (r) => viewCell(r.tx_hash),
};
const cStatus: Col = { label: "Status", priority: 2, w: "90px", cell: (r) => statusPill(r.status) };
const cSource: Col = {
  label: "Source",
  priority: 3,
  w: "minmax(120px,1fr)",
  omitOn: "address",
  cell: (r) => addrCell(r.source),
};
const cDest: Col = {
  label: "Destination",
  priority: 2,
  w: "minmax(120px,1fr)",
  w760: "minmax(110px,1fr)",
  cell: (r) => addrCell(r.destination),
};

// order display via base/quote: pair (base linked + quote), side, price (in quote), amount (base).
// Price precision follows the exchange recipe; the unit is answered by the Pair column (R6).
// Prices are quoted in a divisible asset (XCP/BTC), so a sub-1 price carries up to 8 satoshi decimals —
// show them in full rather than sig-fig-rounding to ~3 places (which silently dropped precision).
const fmtPrice = (n: number) =>
  n === 0
    ? "—"
    : n >= 1
      ? commas(n.toFixed(4))
      : parseFloat(n.toFixed(8)).toLocaleString(undefined, { maximumFractionDigits: 8 });
const side = (d: "buy" | "sell") => <span className={`side ${d}`}>{d}</span>;
const pairCell = (base: string, quote: string) => (
  <span className="inline-flex max-w-full items-center gap-2 font-mono">
    <AssetIcon asset={base} size={22} className="aicon" />
    <Link href={`/asset/${base}`} className="text-zinc-100 truncate">
      {base}
    </Link>
    <span className="text-zinc-600 shrink-0">/{quote}</span>
  </span>
);
// Filled % from give-side fill progress; Expires as blocks-left against the context's chain tip.
const filledPct = (r: OrderRow) => {
  if (!r.give_quantity_normalized || !Number.isFinite(r.give_remaining_normalized)) return "—";
  const pct = Math.min(100, Math.max(0, (1 - r.give_remaining_normalized / r.give_quantity_normalized) * 100));
  return `${pct.toFixed(1)}%`;
};
const expiresCell = (r: OrderRow, ctx: RecordContext) => {
  if (r.status !== "open" || r.expire_index == null) return "—";
  if (!ctx.tip) return commas(r.expire_index);
  const blocks = r.expire_index - ctx.tip;
  if (blocks <= 0) return "due";
  const label =
    blocks < 6 ? `~${blocks * 10}m` : blocks < 144 ? `~${Math.round(blocks / 6)}h` : `~${Math.round(blocks / 144)}d`;
  return <span title={`block ${commas(r.expire_index)}`}>{label}</span>;
};
// v20 reference layout: Time · Block · Pair · Side · Price · Quantity · Filled · Expires · Status · View.
// Price's unit is answered by the Pair column (mixed quote assets); Maker lives on the tx detail.
export const ORDER_COLS: Col<OrderRow>[] = [
  cTime,
  cBlock,
  {
    label: "Pair",
    priority: 1,
    w: "minmax(140px,1fr)",
    w760: "minmax(110px,1fr)",
    w420: "minmax(0,1fr)",
    cell: (r) => {
      const v = orderView(r);
      return pairCell(v.base, v.quote);
    },
  },
  { label: "Side", priority: 2, w: "42px", cell: (r) => side(orderView(r).direction) },
  {
    label: "Price",
    numeric: true,
    cellClass: "qty",
    priority: 1,
    w: "100px",
    w760: "92px",
    w420: "88px",
    cell: (r) => {
      const v = orderView(r);
      return v.price ? fmtPrice(v.price) : "—";
    },
  },
  { label: "Quantity", numeric: true, priority: 3, w: "92px", cell: (r) => commas(orderView(r).baseQty) },
  { label: "Filled", numeric: true, priority: 2, w: "56px", w760: "52px", cell: filledPct },
  { label: "Expires", numeric: true, priority: 3, w: "104px", cell: expiresCell },
  { ...cStatus, w760: "86px" },
  cView,
];

// asset-list rows (subassets, assets-by-issuer, an address's issued assets)
export const ASSET_LIST_COLS: Col<AssetListRow>[] = [
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.4fr)",
    cell: (r) => assetCell(r.asset, r.asset_longname),
  },
  { label: "Supply", priority: 2, w: "86px", cell: (r) => lockStateCell(r.locked) },
  { label: "Created", numeric: true, priority: 1, w: "90px", cell: (r) => blockCell(r.first_issuance_block_index) },
];

// One denomination per column, matching the header exactly (owner rule): BTC columns hold fixed
// 8dp; sats columns hold comma-grouped integers.
const btc8 = (n?: string | number | null) => {
  const v = Number(n);
  return n != null && n !== "" && Number.isFinite(v) ? v.toFixed(8) : "—";
};
// Effective price for ONE unit of the card: a dispenser's satoshirate is charged per dispense, which can hand
// out give_quantity>1 units, so divide by the give amount to get the per-unit BTC price (not the bundle price).
const btcPerUnit = (rate?: string | number | null, give?: string | number | null) => {
  const r = Number(rate),
    g = Number(give);
  return rate != null && rate !== "" && Number.isFinite(r) && Number.isFinite(g) && g > 0 ? (r / g).toFixed(8) : "—";
};
const sats = (n?: number | null) => (n != null && Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");
export const DISPENSER_COLS: Col<DispenserRow>[] = [
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.4fr)",
    omitOn: "asset",
    cell: (r) => assetCell(r.asset),
  },
  {
    label: "Price (BTC)",
    numeric: true,
    priority: 1,
    cell: (r) => btcPerUnit(r.satoshirate_normalized, r.give_quantity_normalized),
  },
  { label: "Available", numeric: true, priority: 2, cell: (r) => commas(r.give_remaining_normalized) },
  { label: "Sales", numeric: true, priority: 3, w: "70px", cell: (r) => compact(r.dispense_count) },
  {
    label: "Source",
    priority: 4,
    omitOn: "address",
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        {addrCell(r.source)}
        {r.operator_trust != null && r.operator_trust > 0 ? (
          <span className="text-[10px] text-zinc-500 shrink-0" title="operator track record">
            trust {r.operator_trust}
          </span>
        ) : null}
      </span>
    ),
  },
  { label: "Status", priority: 1, w: "76px", cell: (r) => dispenserPill(r.status, r.give_remaining_normalized) },
  cBlock,
  cView,
];

// fairmint / dividend / destruction rows — also reused by the per-asset feed tabs (asset-tabs.tsx)
export const FAIRMINT_COLS: Col<FairmintRow>[] = [
  cTime,
  cBlock,
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.4fr)",
    omitOn: "asset",
    cell: (r) => assetCell(r.asset),
  },
  { label: "Earned", numeric: true, priority: 1, cell: (r) => commas(fromSats(r.earn_quantity, r.divisible)) },
  { label: "Paid (XCP)", numeric: true, priority: 2, cell: (r) => commas(fromSats(r.paid_quantity)) },
  { label: "Minter", priority: 2, omitOn: "address", cell: (r) => addrCell(r.source) },
  cView,
];
export const DIVIDEND_COLS: Col<DividendRow>[] = [
  cTime,
  cBlock,
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.4fr)",
    omitOn: "asset",
    cell: (r) => assetCell(r.asset),
  },
  { label: "Dividend", priority: 2, w: "minmax(0,0.8fr)", cell: (r) => assetChip(r.dividend_asset) },
  { label: "Per Unit", numeric: true, priority: 1, cell: (r) => commas(r.quantity_per_unit_normalized) },
  { label: "Source", priority: 3, omitOn: "address", cell: (r) => addrCell(r.source) },
  cView,
];
export const DESTRUCTION_COLS: Col<DestructionRow>[] = [
  cTime,
  cBlock,
  {
    label: "Asset",
    weight: "primary",
    priority: 1,
    w: "minmax(0,1.4fr)",
    omitOn: "asset",
    cell: (r) => assetCell(r.asset),
  },
  { label: "Quantity", numeric: true, priority: 1, cell: (r, ctx) => signedQty(r.quantity_normalized, ctx, true) },
  {
    label: "Tag",
    priority: 3,
    cell: (r) => <span className="block truncate text-zinc-400">{short(r.tag, 16, 0) || "—"}</span>,
  },
  { label: "Source", priority: 2, omitOn: "address", cell: (r) => addrCell(r.source) },
  cView,
];

// order matches rendered as trades (xcpdex OrderMatches grammar): pair, side, price, quantity,
// total, both parties. Side/price are from tx0's perspective via the shared base/quote pairing.
const ORDER_MATCH_COLS: Col<OrderMatchRow>[] = [
  cTime,
  cBlock,
  {
    label: "Pair",
    priority: 1,
    w: "minmax(150px,1fr)",
    cell: (r) => {
      const v = matchView(r);
      return pairCell(v.base, v.quote);
    },
  },
  { label: "Side", priority: 1, w: "44px", cell: (r) => side(matchView(r).direction) },
  {
    label: "Price",
    numeric: true,
    priority: 2,
    cell: (r) => {
      const v = matchView(r);
      return v.price ? fmtPrice(v.price) : "—";
    },
  },
  { label: "Quantity", numeric: true, priority: 2, cell: (r) => commas(matchView(r).baseQty) },
  { label: "Total", numeric: true, priority: 4, cell: (r) => commas(matchView(r).quoteQty) },
  {
    label: "Buyer",
    priority: 3,
    w: "minmax(0,1.2fr)",
    cell: (r) => {
      const v = matchView(r);
      return addrEndsCell(v.direction === "buy" ? r.tx0_address : r.tx1_address);
    },
  },
  {
    label: "Seller",
    priority: 4,
    w: "minmax(0,1.2fr)",
    cell: (r) => {
      const v = matchView(r);
      return addrEndsCell(v.direction === "buy" ? r.tx1_address : r.tx0_address);
    },
  },
  cStatus,
  { label: "View", srOnly: true, priority: 1, w: "44px", cell: (r) => viewCell(r.tx1_hash ?? r.tx0_hash) },
];

type RegistryEntry<K extends RecordKind> = { slug: string; title: string; cols: Col<RecordRowMap[K]>[] };
type Registry = { [K in RecordKind]?: RegistryEntry<K> };

export const REGISTRY: Registry = {
  // Destination is null on ~all modern rows (enhanced sends encode it in data) — a dead column;
  // the always-present miner fee is the useful third fact (spec §1's sanctioned optional).
  transactions: {
    slug: "transactions",
    title: "Transactions",
    cols: [
      cTime,
      cBlock,
      { label: "Tx", weight: "primary", priority: 1, w: "minmax(130px,1fr)", cell: (r) => txCell(r.tx_hash) },
      { label: "Source", priority: 2, w: "minmax(0,1.3fr)", omitOn: "address", cell: (r) => addrCell(r.source) },
      { label: "Fee (sats)", numeric: true, priority: 3, cell: (r) => sats(r.fee != null ? Number(r.fee) : null) },
      cView,
    ],
  },
  sends: {
    slug: "sends",
    title: "Sends",
    cols: [
      cTime,
      cBlock,
      {
        label: "Asset",
        priority: 1,
        w: "minmax(150px,1.2fr)",
        w760: "minmax(120px,1.1fr)",
        w420: "minmax(0,1fr)",
        omitOn: "asset",
        cell: (r) => assetCell(r.asset),
      },
      {
        label: "Quantity",
        numeric: true,
        cellClass: "qty",
        priority: 1,
        w: "110px",
        w760: "92px",
        w420: "84px",
        cell: (r, ctx) => signedQty(r.quantity_normalized, ctx, r.source === ctx.address),
      },
      { label: "Type", priority: 2, w: "70px", w760: "64px", cell: (r) => sendTypeChip(r.send_type) },
      cSource,
      cDest,
      cView,
    ],
  },
  issuances: {
    slug: "issuances",
    title: "Issuances",
    cols: [
      cTime,
      cBlock,
      {
        label: "Asset",
        priority: 1,
        w: "minmax(140px,1.1fr)",
        w760: "minmax(120px,1.1fr)",
        w420: "minmax(0,1fr)",
        omitOn: "asset",
        cell: (r) => assetCell(r.asset, r.asset_longname),
      },
      {
        label: "Action",
        priority: 1,
        w: "100px",
        w760: "96px",
        w420: "92px",
        cell: (r) => actionBadge(r.asset_events),
      },
      {
        label: "Quantity",
        numeric: true,
        cellClass: "qty",
        priority: 2,
        w: "96px",
        w760: "90px",
        cell: (r) => commas(r.quantity_normalized),
      },
      { label: "Issuer", priority: 3, w: "minmax(110px,.9fr)", omitOn: "address", cell: (r) => addrCell(r.issuer) },
      {
        label: "Description",
        priority: 3,
        w: "minmax(130px,1.2fr)",
        cell: (r) => <span className="desc">{short(r.description, 50, 0) || "—"}</span>,
      },
      { label: "Supply", priority: 2, w: "86px", w760: "84px", cell: (r) => lockStateCell(r.locked) },
      cView,
    ],
  },
  orders: { slug: "orders", title: "Orders", cols: ORDER_COLS },
  order_matches: { slug: "matches", title: "Order Matches", cols: ORDER_MATCH_COLS },
  dispensers: { slug: "dispensers", title: "Dispensers", cols: DISPENSER_COLS },
  dispenses: {
    slug: "dispenses",
    title: "Dispenses",
    cols: [
      cTime,
      cBlock,
      {
        label: "Asset",
        priority: 1,
        w: "minmax(130px,1fr)",
        w760: "minmax(115px,1fr)",
        w420: "minmax(0,1fr)",
        omitOn: "asset",
        cell: (r) => assetCell(r.asset),
      },
      {
        label: "Quantity",
        numeric: true,
        cellClass: "qty",
        priority: 2,
        w: "88px",
        w760: "84px",
        cell: (r, ctx) => signedQty(r.dispense_quantity_normalized, ctx, r.source === ctx.address),
      },
      // per-unit price in sats (mined convention — integers, one denomination), linked to the machine
      // that sold (dispenser_tx_hash).
      {
        label: "Price (sats)",
        numeric: true,
        priority: 3,
        w: "92px",
        cell: (r) => {
          const paid = Number(r.btc_amount);
          const qty = Number(r.dispense_quantity_normalized);
          if (!Number.isFinite(paid) || !paid || !qty) return "—";
          const unit = sats(paid / qty);
          return r.dispenser_tx_hash ? (
            <Link href={`/tx/${r.dispenser_tx_hash}`} title="the dispenser that sold">
              {unit}
            </Link>
          ) : (
            unit
          );
        },
      },
      {
        label: "Total (BTC)",
        numeric: true,
        cellClass: "qty",
        priority: 1,
        w: "100px",
        w760: "100px",
        w420: "92px",
        cell: (r) => btc8(fromSats(r.btc_amount)),
      },
      {
        label: "USD",
        numeric: true,
        cellClass: "num usd",
        priority: 2,
        w: "80px",
        w760: "78px",
        cell: (r) => (r.usd_value != null ? `$${commas(r.usd_value.toFixed(r.usd_value >= 100 ? 0 : 2))}` : "—"),
      },
      { label: "Dispenser", priority: 3, w: "minmax(115px,1fr)", omitOn: "address", cell: (r) => addrCell(r.source) },
      {
        label: "Buyer",
        priority: 2,
        w: "minmax(115px,1fr)",
        w760: "minmax(100px,.9fr)",
        cell: (r) => addrCell(r.destination),
      },
      cView,
    ],
  },
  sweeps: {
    slug: "sweeps",
    title: "Sweeps",
    cols: [
      cTime,
      cBlock,
      cSource,
      // partial sweeps (balances-only / ownership-only) are the exception — the chip rides the
      // destination cell instead of occupying a mostly-empty column of its own
      {
        label: "Destination",
        priority: 1,
        w: "minmax(0,1.3fr)",
        cell: (r) => (
          <span className="inline-flex max-w-full items-center gap-1.5 min-w-0">
            {addrCell(r.destination)}
            {sweepFlagsBadge(r.flags)}
          </span>
        ),
      },
      { label: "Fee Paid (XCP)", numeric: true, priority: 3, cell: (r) => commas(fromSats(r.fee_paid)) },
      {
        label: "Memo",
        priority: 4,
        cell: (r) => <span className="block truncate text-zinc-400">{short(r.memo, 18, 0) || "—"}</span>,
      },
      cView,
    ],
  },
  broadcasts: {
    slug: "broadcasts",
    title: "Broadcasts",
    cols: [
      cTime,
      cBlock,
      {
        label: "Source",
        priority: 1,
        omitOn: "address",
        cell: (r) => (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            {addrCell(r.source)}
            {r.locked ? tchip("feed locked") : null}
          </span>
        ),
      },
      {
        label: "Text",
        priority: 1,
        w: "minmax(0,1.4fr)",
        cell: (r) => <span className="block truncate text-zinc-300">{short(r.text, 50, 0) || "—"}</span>,
      },
      {
        label: "Value",
        numeric: true,
        priority: 4,
        cell: (r) => (r.value != null && Number(r.value) !== -1 ? commas(r.value) : "—"),
      },
      cView,
    ],
  },
  burns: {
    slug: "burns",
    title: "Burns",
    cols: [
      cTime,
      cBlock,
      { label: "Source", priority: 1, omitOn: "address", cell: (r) => addrCell(r.source) },
      { label: "Burned (BTC)", numeric: true, priority: 1, cell: (r) => btc8(r.burned_normalized) },
      { label: "Earned (XCP)", numeric: true, priority: 2, cell: (r) => commas(r.earned_normalized) },
      cView,
    ],
  },
  dividends: { slug: "dividends", title: "Dividends", cols: DIVIDEND_COLS },
  bets: {
    slug: "bets",
    title: "Bets",
    cols: [
      { label: "Source", priority: 1, omitOn: "address", cell: (r) => addrCell(r.source) },
      { label: "Type", priority: 1, w: "96px", cell: (r) => betTypeBadge(r.bet_type) },
      { label: "Wager (XCP)", numeric: true, priority: 1, cell: (r) => commas(fromSats(r.wager_quantity)) },
      {
        label: "Counterwager (XCP)",
        numeric: true,
        priority: 2,
        w: "140px",
        cell: (r) => commas(fromSats(r.counterwager_quantity)),
      },
      {
        label: "Target",
        numeric: true,
        priority: 3,
        w: "80px",
        cell: (r) => (r.target_value != null ? commas(r.target_value) : "—"),
      },
      // some historical feeds stored non-timestamp deadlines; only render plausible unix seconds
      {
        label: "Deadline",
        numeric: true,
        priority: 4,
        w: "80px",
        cell: (r) => (r.deadline && r.deadline > 1e9 ? timeCell(r.deadline) : <span className="time">—</span>),
      },
      { label: "Feed", priority: 4, cell: (r) => addrCell(r.feed_address) },
      cStatus,
      cBlock,
      cView,
    ],
  },
  fairminters: {
    slug: "fairminters",
    title: "Fairminters",
    cols: [
      {
        label: "Asset",
        weight: "primary",
        priority: 1,
        w: "minmax(0,1.4fr)",
        omitOn: "asset",
        cell: (r) => assetCell(r.asset, r.asset_longname),
      },
      {
        label: "Price (XCP)",
        numeric: true,
        priority: 1,
        cell: (r) => {
          // Effective price for ONE unit: `price` buys `quantity_by_price` asset units (raw; ÷1e8 when divisible),
          // so divide the XCP paid by the units minted rather than showing the per-batch price.
          const xcp = fromSats(r.price);
          if (xcp == null) return "—";
          const units = fromSats(r.quantity_by_price, r.divisible);
          return commas(units && units > 0 ? xcp / units : xcp);
        },
      },
      {
        label: "Minted",
        numeric: true,
        priority: 2,
        w: "70px",
        cell: (r) => {
          const cap = Number(r.hard_cap),
            earned = Number(r.earned_quantity);
          if (!cap || !Number.isFinite(earned)) return "—";
          const pct = Math.min(100, (earned / cap) * 100);
          return pct > 0 && pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`;
        },
      },
      {
        label: "Hard Cap",
        numeric: true,
        priority: 3,
        cell: (r) => (Number(r.hard_cap) ? compact(fromSats(r.hard_cap, r.divisible)) : "—"),
      },
      { label: "Source", priority: 4, omitOn: "address", cell: (r) => addrCell(r.source) },
      cStatus,
      cBlock,
      cView,
    ],
  },
  fairmints: { slug: "fairmints", title: "Fairmints", cols: FAIRMINT_COLS },
  destructions: { slug: "destructions", title: "Destructions", cols: DESTRUCTION_COLS },
  btcpays: {
    slug: "btcpays",
    title: "BTCPays",
    cols: [
      cTime,
      cBlock,
      cSource,
      { label: "Destination", priority: 2, cell: (r) => addrCell(r.destination) },
      { label: "BTC", numeric: true, priority: 1, cell: (r) => btc8(r.btc_amount_normalized) },
      {
        label: "Order Match",
        priority: 3,
        w: "130px",
        cell: (r) =>
          r.order_match_id ? (
            <Link href={`/tx/${r.order_match_id.split("_")[0]}`} className="font-mono">
              {short(r.order_match_id, 8, 6)}
            </Link>
          ) : (
            "—"
          ),
      },
      cView,
    ],
  },
};
