import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { TxView } from "@xcp/shared/chain";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { TxLive } from "@/components/tx-view";
import { KIND_TITLE } from "@/lib/tx";
import { artUrl } from "@/lib/art";
import { short } from "@/lib/format";

/**
 * The transaction page — a thin server shell around the live client view (components/tx-view.tsx). The
 * server render carries the first TxView (mempool-aware: the API falls through to the node's mempool for
 * a just-broadcast tx), then the island polls it to settlement. This page's primary user is two parties
 * watching a payment confirm, so freshness beats cache: revalidate 5.
 */
async function loadTx(hash: string): Promise<TxView | null> {
  try {
    const env = await getJson<Envelope<TxView>>(`/v2/transactions/${encodeURIComponent(hash)}`, { revalidate: 5 });
    return env.result ?? null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

// The share unfurl SELLS when the page is a storefront — a dispenser link pasted into a chat must
// read as "here's the thing, here's the price, it's open" (the owner's advertisement concept). The
// og:image is the asset's art for offer/receipt/birth pages so the card itself travels with the link.
function shareCopy(v: TxView, hash: string): { title: string; description: string; image?: string } {
  const a = v.action;
  const state = v.status === "mempool" ? "unconfirmed" : `${v.confirmations} confirmation${v.confirmations === 1 ? "" : "s"}`;
  const art = (asset?: string | null) => (asset ? artUrl(asset, 800) : undefined);
  const btc = (sats?: string | number | null) => { const n = Number(sats); return Number.isFinite(n) && n > 0 ? `${(n / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} BTC` : null; };
  if (a?.kind === "dispenser" || a?.kind === "refill") {
    const d = a.dispenser;
    if (d) {
      const open = Number(d.status) === 0 && Number(d.give_remaining_normalized) > 0;
      const price = btc(d.satoshirate);
      return open
        ? { title: `Buy ${d.asset} — ${price ?? "dispenser"} · OPEN`, description: `Automatic dispenser: ${Number(d.give_remaining_normalized).toLocaleString()} in stock · send the exact amount, it vends in the next block. On xcp.io.`, image: art(d.asset) }
        : { title: `${d.asset} dispenser — closed`, description: `This dispenser has ended · ${d.dispense_count} sales. See other ways to get ${d.asset} on xcp.io.`, image: art(d.asset) };
    }
  }
  if (a?.kind === "fairminter") {
    const f = a.fairminter;
    const open = (f.status ?? "").startsWith("open");
    return { title: `${open ? "Mint" : "Fair mint over:"} ${f.asset_longname || f.asset}${open ? " — open now" : ""}`, description: open ? `Anyone can mint. Terms + progress on xcp.io.` : `Minting has closed — see the asset on xcp.io.`, image: art(f.asset) };
  }
  if (a?.kind === "order") {
    const o = a.order;
    return { title: `${o.status === "open" ? "Open order" : `Order (${(o.status ?? "ended").split(":")[0]})`}: ${Number(o.give_quantity_normalized).toLocaleString()} ${o.give_asset} for ${Number(o.get_quantity_normalized).toLocaleString()} ${o.get_asset}`, description: `Counterparty DEX order · ${state}. Take it on xcpdex.` };
  }
  if (a?.kind === "dispense") {
    const d = a.dispenses[0];
    return { title: `${Number(d.dispense_quantity_normalized).toLocaleString()} ${d.asset} bought for ${btc(d.btc_amount) ?? "BTC"}`, description: `Dispense receipt · ${state} · on xcp.io.`, image: art(d.asset) };
  }
  if (a?.kind === "issuance") {
    const i = a.issuance;
    return { title: `${i.asset_longname || i.asset} — issuance`, description: `Birth record on xcp.io · ${state}.`, image: art(i.asset) };
  }
  const kind = a ? KIND_TITLE[a.kind] : null;
  return { title: `${kind ? `${kind} — ` : ""}Transaction ${short(hash)}`, description: `Counterparty transaction ${hash} (${state}).` };
}

export async function generateMetadata({ params }: { params: Promise<{ hash: string }> }): Promise<Metadata> {
  const { hash } = await params;
  const v = await loadTx(hash).catch(() => null);
  if (!v) return { title: `Transaction ${short(hash)}`, description: `Counterparty transaction ${hash}.` };
  const s = shareCopy(v, hash);
  return {
    title: s.title,
    description: s.description,
    openGraph: { title: `${s.title} | XCP.io`, description: s.description, ...(s.image ? { images: [{ url: s.image }] } : {}) },
    twitter: { card: s.image ? "summary_large_image" : "summary", title: `${s.title} | XCP.io`, description: s.description, ...(s.image ? { images: [s.image] } : {}) },
  };
}

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const item = await loadTx(hash);
  if (!item) notFound();
  return <TxLive hash={hash} initial={item} />;
}
