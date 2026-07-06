import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Clock } from "lucide-react";
import type { TxDetail } from "@xcp/shared/chain";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { Card, KV } from "@/components/ui/card";
import { type Col, addrCell, assetCell } from "@/lib/cells";
import { eventChip } from "@/lib/mempool";
import { RecordTable } from "@/components/record-table";
import { commas, short, ts } from "@/lib/format";

// Returns null on 404; only the page calls notFound() (notFound() in generateMetadata renders the
// error boundary instead of the 404 route under OpenNext).
async function loadTx(hash: string): Promise<TxDetail | null> {
  try {
    const env = await getJson<Envelope<TxDetail>>(`/v2/transactions/${encodeURIComponent(hash)}`, { revalidate: 30 });
    return env.result ?? null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

// A confirmed tx is the common case; when it isn't in the mirror we check the node's mempool. Returns []
// when the node has no events for it (a real 404 there) so the page can 404 only when BOTH miss.
async function loadPendingTx(hash: string): Promise<MempoolActionRow[]> {
  try {
    const env = await getJson<Envelope<MempoolActionRow[]>>(`/v2/mempool/transactions/${encodeURIComponent(hash)}`, { revalidate: 5 });
    return env.result ?? [];
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
}

const PENDING_COLS: Col<MempoolActionRow>[] = [
  { label: "Event", cell: (r) => eventChip(r.event) },
  { label: "Asset", weight: "primary", cell: (r) => assetCell(r.asset ?? undefined) },
  { label: "Quantity", numeric: true, cell: (r) => (r.quantity_normalized != null ? commas(r.quantity_normalized) : "—") },
  { label: "From", cell: (r) => addrCell(r.source ?? undefined) },
  { label: "To", cell: (r) => addrCell(r.destination ?? undefined) },
];

// Unconfirmed-tx view: the tx is not yet in the mirror but the node's mempool has action(s) for it.
function PendingTx({ hash, actions }: { hash: string; actions: MempoolActionRow[] }) {
  return (
    <Card title="Transaction">
      <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-4 py-2.5 text-sm">
        <Clock className="size-4 shrink-0 text-amber-400" />
        <span className="font-medium text-zinc-200">Unconfirmed</span>
        <span className="text-amber-400/80">· in mempool</span>
      </div>
      <KV k="Hash" v={<span className="font-mono break-all">{hash}</span>} />
      <div className="mt-4"><RecordTable cols={PENDING_COLS} rows={actions} /></div>
    </Card>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ hash: string }> }): Promise<Metadata> {
  const { hash } = await params;
  const title = `Transaction ${short(hash)}`;
  const description = `Counterparty transaction ${hash}.`;
  return { title, description, openGraph: { title: `${title} | XCP.io`, description } };
}

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const item = await loadTx(hash);
  if (!item) {
    const pending = await loadPendingTx(hash);
    if (pending.length === 0) notFound();
    return <PendingTx hash={hash} actions={pending} />;
  }

  return (
    <Card title="Transaction">
      <KV k="Hash" v={<span className="font-mono break-all">{item.tx_hash}</span>} />
      <KV k="Block" v={<Link href={`/block/${item.block_index}`}>{commas(item.block_index)}</Link>} />
      <KV k="Time" v={ts(item.block_time)} />
      <KV k="Source" v={item.source ? <Link href={`/address/${item.source}`} className="font-mono break-all">{item.source}</Link> : "—"} />
      <KV k="Destination" v={item.destination ? <Link href={`/address/${item.destination}`} className="font-mono break-all">{item.destination}</Link> : "—"} />
      <KV k="BTC amount" v={item.btc_amount ? <span className="font-mono">{item.btc_amount}</span> : "—"} />
      <KV k="Fee" v={item.fee ? <span className="font-mono">{item.fee}</span> : "—"} />
      <KV k="Supported" v={item.supported ? "yes" : "no"} />
      <div className="mt-3 text-xs">
        <a href={`https://www.xcp.io/tx/${item.tx_hash}`} target="_blank" rel="noopener noreferrer" className="!text-zinc-400 hover:!text-[--color-accent] !no-underline">Raw decode ↗</a>
      </div>
    </Card>
  );
}
