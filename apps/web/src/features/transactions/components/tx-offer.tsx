"use client";
import Link from "next/link";
import { useState } from "react";
import type { DispenserRow, DispenseRow, FairminterRow, OrderRow, OrderMatchRow } from "@xcp/shared/records";
import type { DispenserTotals, TxAssetCollection, TxAssetSupply } from "@xcp/shared/chain";
import { Card } from "@/components/ui/card";
import { RecordTable } from "@/features/records/components/record-table";
import { REGISTRY } from "@/features/records/registry";
import { viewCell, type Col } from "@/features/records/cells";
import { AssetArt } from "@/features/assets/components/asset-art";
import { usePrices } from "@/lib/prices";
import { orderView } from "@/lib/trading-pair";
import { btcAmt, xcpAmt, satsUsd, blocksEta } from "@/lib/tx";
import { amount, collectionLabel, commas, fromSats, short, timeAgo } from "@/lib/format";

/**
 * JOB ① — THE OFFER. A dispenser / fairminter / open order has no page but its transaction page, so
 * when its owner shares "buy my thing," THIS page is the storefront: price-first, live stock, and a
 * how-to-accept block with honest affordances (copy the exact mechanic; deep-link the doing to
 * xcpdex — we never build the exchange). A dead offer collapses to a one-line epitaph that routes
 * demand onward, and its history table becomes the page's content. v21 lab, job ①.
 */

const addr = (a?: string | null) => (a ? <Link href={`/address/${a}`} className="font-mono">{short(a)}</Link> : <>—</>);

function ClickCopy({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="txbtn copy" onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "copied ✓" : label}
    </button>
  );
}

// The art caption + provenance line — "THINKINGPEPE / Rare Pepe · Series 4 Card 12" (tag page linked).
function ArtCaption({ asset, collection, supply }: { asset: string; collection: TxAssetCollection | null; supply?: TxAssetSupply | null }) {
  return (
    <>
      <div className="caption">{asset}</div>
      {collection && (
        <div className="caption" style={{ marginTop: 2, fontSize: 11, color: "var(--t4)" }}>
          <Link href={`/tag/${encodeURIComponent(collection.tag)}`} className="!text-zinc-400 hover:!text-(--color-accent)">{collectionLabel(collection.tag)}</Link>
          {collection.series != null && collection.card != null && <> · S{collection.series} C{collection.card}</>}
        </div>
      )}
      {supply?.supply_normalized != null && (
        <div className="caption" style={{ marginTop: 2, fontSize: 11, color: "var(--t4)" }}>
          {amount(supply.supply_normalized, supply.divisible ?? 0)} supply · {supply.locked ? "locked" : "unlocked"}
        </div>
      )}
    </>
  );
}

// dispenser liveness: status 0 with stock = open; 0 without stock = sold out; 10/11 = closed.
const dispenserAlive = (d: DispenserRow) => Number(d.status) === 0 && Number(d.give_remaining_normalized) > 0;

// A dispenser's sales table — the storefront's history + social proof. Same columns as /dispenses,
// minus Dispenser (this page IS the dispenser). Each sale is its own tx, so Time/Block/View stay.
function SalesTable({ sales, count }: { sales: DispenseRow[]; count: number }) {
  if (!sales.length) return null;
  const cols = REGISTRY.dispenses!.cols.filter((c) => c.label !== "Dispenser");
  return (
    <section className="rts">
      <div className="strip-title">Sales from this dispenser · {commas(count)}</div>
      <RecordTable cols={cols} rows={sales} label="dispenser sales" />
    </section>
  );
}

export function DispenserStorefront({ dispenser: d, sales, totals, collection, supply, refillNote = false }: {
  dispenser: DispenserRow; sales: DispenseRow[]; totals: DispenserTotals | null; collection: TxAssetCollection | null; supply: TxAssetSupply | null; refillNote?: boolean;
}) {
  const { btc } = usePrices();
  const alive = dispenserAlive(d);
  const perDispense = Number(d.give_quantity_normalized) || 1;
  const remaining = Number(d.give_remaining_normalized) || 0;
  // one sale can vend many multiples of give_quantity — stock math uses UNITS from totals, never events
  const sold = totals?.units ?? (Number(d.dispense_count) || 0) * perDispense;
  const initial = remaining + sold;
  const pct = initial > 0 ? Math.round((remaining / initial) * 100) : 0;
  const usd = satsUsd(d.satoshirate, btc);

  if (!alive) {
    const soldOut = Number(d.status) === 0 && remaining <= 0;
    const takeUsd = satsUsd(totals?.sats, btc);
    return (
      <>
        {refillNote && <div className="tx-dead"><span className="pill cancelled">restock</span><span className="msg">This transaction restocked the dispenser below (since {Number(d.status) === 0 ? "sold out" : "closed"}).</span></div>}
        <div className="tx-dead">
          <span className="pill cancelled">{soldOut ? "sold out" : "closed"}</span>
          <span className="msg">
            This dispenser {soldOut ? "sold out" : "closed"}{d.closed_block_index ? <> at block <b>{commas(d.closed_block_index)}</b></> : null}
            {totals && totals.n > 0 && <> · <b>{commas(totals.n)}</b> sale{totals.n === 1 ? "" : "s"} for <b>{btcAmt(totals.sats)}</b>{takeUsd && <span className="text-zinc-500"> ({takeUsd})</span>} total</>}.
          </span>
          {d.asset && <Link href={`/asset/${d.asset}`} className="!text-(--color-accent)">Other ways to get {d.asset} →</Link>}
        </div>
        <SalesTable sales={sales} count={totals?.n ?? sales.length} />
      </>
    );
  }

  return (
    <>
      {refillNote && <div className="tx-dead"><span className="pill open">restock</span><span className="msg">This transaction restocked the dispenser below.</span></div>}
      <div className="card txstore" style={{ padding: 0 }}>
        <div className="art">
          {d.asset && <AssetArt asset={d.asset} className="w-full aspect-[5/7] rounded-lg border border-zinc-800" />}
          {d.asset && <ArtCaption asset={d.asset} collection={collection} supply={supply} />}
        </div>
        <div className="shop">
          <div className="forsale">For sale · dispenser <span className="pill open">open</span></div>
          <div className="offerline"><b>{d.asset}</b> — {perDispense === 1 ? "sold by the unit" : `sold in lots of ${commas(perDispense)}`}</div>
          <div className="price">
            <span className="big">{btcAmt(d.satoshirate)}</span>
            <span className="usd">{usd && <>{usd} </>}per {perDispense === 1 ? "unit" : `${commas(perDispense)} units`}</span>
          </div>
          <div className="meta">
            <span>sold <b>{commas(sold)}</b> unit{sold === 1 ? "" : "s"} in <b>{commas(d.dispense_count)}</b> sale{Number(d.dispense_count) === 1 ? "" : "s"}</span>
            <span>operator <b>{addr(d.source)}</b></span>
            <span>opened <b>block {commas(d.block_index)}</b> · {timeAgo(d.block_time)}</span>
          </div>
          <div className="stockbar">
            <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
            <div className="lbl"><span>{commas(remaining)} of {commas(initial)} remaining</span><span>{pct}% in stock</span></div>
          </div>
          <div className="howto">
            <div className="h">How to buy — automatic, no account</div>
            <div className="step">Send <b>exactly {btcAmt(d.satoshirate)}</b> (or a multiple of it) to <b>{d.source}</b> — the machine vends {commas(perDispense)} {d.asset} per multiple, to the paying address, in the next block.</div>
            <div className="btns">
              {d.source && <ClickCopy label="copy address" value={d.source} />}
              <ClickCopy label="copy amount" value={String(fromSats(d.satoshirate, 1) ?? "")} />
              {d.asset && <a className="txbtn buy" href={`https://xcpdex.com/${d.asset}`} target="_blank" rel="noopener noreferrer">Buy on xcpdex ↗</a>}
              {d.asset && <Link className="txbtn ghost" href={`/asset/${d.asset}`}>View {d.asset} →</Link>}
            </div>
          </div>
        </div>
      </div>
      <SalesTable sales={sales} count={totals?.n ?? d.dispense_count} />
    </>
  );
}

export function FairminterCampaign({ fairminter: f }: { fairminter: FairminterRow }) {
  const alive = (f.status ?? "").startsWith("open");
  const name = f.asset_longname || f.asset;
  const earned = fromSats(f.earned_quantity, f.divisible) ?? 0;
  const cap = fromSats(f.hard_cap, f.divisible) ?? 0;
  const soft = fromSats(f.soft_cap, f.divisible) ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((earned / cap) * 100)) : null;
  const free = !(Number(f.price) > 0);

  if (!alive) {
    return (
      <div className="tx-dead">
        <span className="pill cancelled">{f.status ?? "closed"}</span>
        <span className="msg">This fair mint is over — <b>{amount(earned, f.divisible)}</b> {name} minted{cap > 0 && pct != null && <> ({pct}% of the {amount(cap, f.divisible)} cap)</>}{!free && <> at <b>{xcpAmt(f.price)}</b> per {commas(f.quantity_by_price)}</>}{Number(f.paid_quantity) > 0 && <> · <b>{xcpAmt(f.paid_quantity)}</b> taken in</>}.</span>
        {f.asset && <Link href={`/asset/${f.asset}`} className="!text-(--color-accent)">View {name} →</Link>}
      </div>
    );
  }
  return (
    <div className="card txstore" style={{ gridTemplateColumns: "1fr" }}>
      <div className="shop">
        <div className="forsale">Fair mint · anyone can mint <span className="pill open">open</span></div>
        <div className="offerline"><b>{name}</b>{free ? " — free to mint" : <> — {xcpAmt(f.price)} per {commas(f.quantity_by_price)}</>}</div>
        {cap > 0 && pct != null && (
          <div className="stockbar mint">
            <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
            <div className="lbl"><span>{amount(earned, f.divisible)} minted</span><span>{pct}% of {amount(cap, f.divisible)} hard cap</span></div>
          </div>
        )}
        <div className="meta" style={{ marginTop: 12 }}>
          {!free && <span>price <b>{xcpAmt(f.price)}</b> / {commas(f.quantity_by_price)}</span>}
          {cap === 0 && <span>minted so far <b>{amount(earned, f.divisible)}</b></span>}
          {soft > 0 && <span>soft cap <b>{earned >= soft ? "reached ✓" : amount(soft, f.divisible)}</b></span>}
          {Number(f.paid_quantity) > 0 && <span>taken in <b>{xcpAmt(f.paid_quantity)}</b></span>}
          <span>opened by <b>{addr(f.source)}</b></span>
        </div>
        <div className="howto mint">
          <div className="h">How to mint</div>
          <div className="step">Send a <b>fairmint</b> naming this minter from any Counterparty wallet{free ? " — units are credited free until it closes." : <> — paying <b>{xcpAmt(f.price)}</b> per {commas(f.quantity_by_price)} units.</>}</div>
          <div className="btns">
            {f.asset && <a className="txbtn buy" href={`https://xcpdex.com/${f.asset}`} target="_blank" rel="noopener noreferrer">Mint on xcpdex ↗</a>}
            {f.asset && <Link className="txbtn ghost" href={`/asset/${f.asset}`}>View {name} →</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The wallet-provider surface we can feature-detect. Only connect() is a known contract today; the
 *  compose paths are the wiring points for the XCP Wallet order flow (provisional until the provider
 *  publishes its compose API) — everything degrades to a plain message, never a dead button. */
type XcpWallet = {
  connect?: () => Promise<void>;
  composeOrder?: (p: Record<string, unknown>) => Promise<unknown>;
  request?: (a: { method: string; params?: unknown }) => Promise<unknown>;
};

function AcceptOfferButton({ order: o }: { order: OrderRow }) {
  const [msg, setMsg] = useState<string | null>(null);
  const accept = async () => {
    const w = (window as { xcpwallet?: XcpWallet }).xcpwallet;
    // the matching order: give what they want, get what they're giving (remaining, not original)
    const params = {
      give_asset: o.get_asset, give_quantity_normalized: o.get_remaining_normalized,
      get_asset: o.give_asset, get_quantity_normalized: o.give_remaining_normalized,
      match_order_tx: o.tx_hash,
    };
    if (!w) { setMsg("XCP Wallet not detected — install the extension to fill orders here."); return; }
    try {
      if (w.composeOrder) { await w.composeOrder(params); setMsg(null); }
      else if (w.request) { await w.request({ method: "xcp_composeOrder", params }); setMsg(null); }
      else { await w.connect?.(); setMsg("Wallet connected — this wallet version can't compose orders yet."); }
    } catch { setMsg(null); /* user dismissed the wallet dialog — not an error */ }
  };
  return (
    <>
      <button type="button" className="txbtn buy" onClick={accept}>Fill order</button>
      {msg && <span className="self-center text-xs text-zinc-400">{msg}</span>}
    </>
  );
}

// The keyline row (v22 C-register): fixed key column, mono, one fact per line.
const Kl = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="font-mono text-[13px] leading-[2.05]"><span className="inline-block w-[9ch] text-zinc-500">{k}</span>{children}</div>
);

// The card the offer is ABOUT: the non-currency side (a card-for-card order shows the give side).
const orderArtAsset = (o: OrderRow): string | null => {
  const cur = (a: string | null) => a === "XCP" || a === "BTC";
  if (o.give_asset && !cur(o.give_asset)) return o.give_asset;
  if (o.get_asset && !cur(o.get_asset)) return o.get_asset;
  return null;
};

export function OrderOffer({ order: o, matches, collection, supply, tip }: {
  order: OrderRow; matches: OrderMatchRow[]; collection: TxAssetCollection | null; supply: TxAssetSupply | null; tip: number | null;
}) {
  const v = orderView(o);
  const { xcp, btc } = usePrices();
  const alive = (o.status ?? "") === "open";
  const give = Number(o.give_quantity_normalized) || 0;
  const remaining = Number(o.give_remaining_normalized) || 0;
  const filled = give > 0 ? Math.round((1 - remaining / give) * 100) : 0;
  const blocksLeft = tip != null && o.expire_index != null ? o.expire_index - tip : null;
  const art = orderArtAsset(o);
  const quoteUsd = v.price != null ? (v.quote === "XCP" && xcp != null ? v.price * xcp : v.quote === "BTC" && btc != null ? v.price * btc : null) : null;
  const state = (o.status ?? "ended").split(":")[0]; // "invalid: reason" -> "invalid"
  const statePill = alive ? "open" : state === "filled" ? "filled" : state === "expired" ? "expired" : "cancelled";

  // View leads to the COUNTERPARTY order — the two sides of a match link to each other, never to
  // the page you're already on.
  const matchCols = (REGISTRY.order_matches!.cols as Col<OrderMatchRow>[]).map((c) =>
    c.label === "View" ? { ...c, cell: (r: OrderMatchRow) => viewCell(r.tx0_hash === o.tx_hash ? r.tx1_hash : r.tx0_hash) } : c);
  const matchesTable = matches.length > 0 && (
    <section className="rts">
      <div className="strip-title">Matches · {matches.length}</div>
      <RecordTable cols={matchCols} rows={matches} label="order matches" />
    </section>
  );

  // ONE frame for living and dead offers — a closed shop is still recognizably the shop (owner call:
  // the thin epitaph made ended orders unrecognizable). Dead = state pill + muted ended-strip where
  // the how-to was; everything else (art, offer line, price, final fill, keylines) stays.
  return (
    <>
      <div className="card txstore" style={art ? undefined : { gridTemplateColumns: "1fr" }}>
        {art && (
          <div className="art">
            <AssetArt asset={art} className="w-full aspect-[5/7] rounded-lg border border-zinc-800" />
            <ArtCaption asset={art} collection={collection} supply={supply} />
          </div>
        )}
        <div className="shop">
          <div className="forsale">DEX order <span className={`pill ${statePill}`}>{state}</span></div>
          <div className="offerline">
            {v.direction === "buy" ? <>Buying <b>{commas(o.get_quantity_normalized)} {o.get_asset}</b> · Paying <b>{commas(o.give_quantity_normalized)} {o.give_asset}</b></>
              : <>Selling <b>{commas(o.give_quantity_normalized)} {o.give_asset}</b> · Asking <b>{commas(o.get_quantity_normalized)} {o.get_asset}</b></>}
          </div>
          {v.price != null && (
            <div className="price">
              <span className="big">{v.price >= 1 ? commas(v.price.toFixed(2)) : v.price.toPrecision(4)} {v.quote}</span>
              {quoteUsd != null && <span className="usd">≈ ${commas(quoteUsd >= 100 ? Math.round(quoteUsd) : quoteUsd.toFixed(2))} per {v.base}</span>}
            </div>
          )}
          <div className="stockbar">
            <div className="bar"><div className="fill" style={{ width: `${filled}%` }} /></div>
            <div className="lbl">
              <span>{filled}% filled</span>
              {alive
                ? <span>{commas(o.give_remaining_normalized)} {o.give_asset} ↔ {commas(o.get_remaining_normalized)} {o.get_asset} still open</span>
                : <span>{state === "filled" ? "traded in full" : `${commas(o.give_remaining_normalized)} ${o.give_asset} went untraded`}</span>}
            </div>
          </div>
          <div className="mt-3">
            <Kl k="pair"><a href={`https://xcpdex.com/trade/${v.base}_${v.quote}`} target="_blank" rel="noopener noreferrer" className="hover:!text-(--color-accent)">{v.base}/{v.quote}</a> · {v.direction}</Kl>
            <Kl k="expires">block {commas(o.expire_index)}{alive && blocksLeft != null && blocksLeft > 0 && <span className="text-zinc-500"> · {blocksEta(blocksLeft)}</span>}</Kl>
            <Kl k="maker">{addr(o.source)}</Kl>
          </div>
          {alive ? (
            <div className="howto take">
              <div className="h">How to fill this order</div>
              <div className="step">Offer <b>{commas(o.get_remaining_normalized)} {o.get_asset}</b> for <b>{commas(o.give_remaining_normalized)} {o.give_asset}</b> — the protocol matches you to this order automatically.</div>
              <div className="btns">
                <AcceptOfferButton order={o} />
                {v.base && <Link className="txbtn ghost" href={`/asset/${v.base}`}>View {v.base} →</Link>}
              </div>
            </div>
          ) : (
            <div className={`howto ${state === "filled" ? "done" : "gone"}`}>
              <div className="h">{state === "filled" ? "Order complete" : state === "expired" ? "Order expired" : state === "cancelled" ? "Order cancelled" : "Order rejected"}</div>
              <div className="step">
                {state === "filled" ? <><b>{commas(o.give_quantity_normalized)} {o.give_asset}</b> traded for <b>{commas(o.get_quantity_normalized)} {o.get_asset}</b>{matches.length > 0 && <> — the match is recorded below</>}.</>
                  : state === "expired" ? <><b>{commas(o.give_remaining_normalized)} {o.give_asset}</b> went untraded — the order closed at block <b>{commas(o.expire_index)}</b>.</>
                  : state === "cancelled" ? <>Withdrawn by its maker before it filled.</>
                  : <>The protocol parsed and rejected this order.</>}
              </div>
              <div className="btns">
                {v.base && <Link className="txbtn ghost" href={`/asset/${v.base}`}>View {v.base} →</Link>}
              </div>
            </div>
          )}
        </div>
      </div>
      {matchesTable}
    </>
  );
}
