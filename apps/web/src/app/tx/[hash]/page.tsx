"use client";
import { use } from "react";
import Link from "next/link";
import { useTx } from "@/lib/hooks";
import { Card, KV, Loading, ErrorBox, Empty } from "@/components/ui";
import { commas, ts } from "@/lib/format";

export default function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const { item, error, isLoading } = useTx(hash);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!item) return <Empty what="transaction" />;

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
