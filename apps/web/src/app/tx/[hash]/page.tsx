import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { TxDetail } from "@xcp/shared/chain";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { Card, KV } from "@/components/ui/card";
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

export async function generateMetadata({ params }: { params: Promise<{ hash: string }> }): Promise<Metadata> {
  const { hash } = await params;
  const title = `Transaction ${short(hash)}`;
  const description = `Counterparty transaction ${hash}.`;
  return { title, description, openGraph: { title: `${title} | XCP.io`, description } };
}

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const item = await loadTx(hash);
  if (!item) notFound();

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
        <a href={`https://www.xcp.io/tx/${item.tx_hash}`} target="_blank" rel="noopener noreferrer" className="!text-zinc-500 hover:!text-zinc-300 !no-underline">Raw decode ↗</a>
      </div>
    </Card>
  );
}
