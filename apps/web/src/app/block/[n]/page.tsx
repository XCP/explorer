"use client";
import { use } from "react";
import Link from "next/link";
import { useBlock } from "@/lib/hooks";
import { Card, KV, Empty, Loading, ErrorBox } from "@/components/ui";
import { RecordTable } from "@/components/record-table";
import { txCell, addrCell } from "@/lib/columns";
import { commas, short, ts } from "@/lib/format";

export default function BlockPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = use(params);
  const { item, error, isLoading } = useBlock(n);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!item) return <Empty what="block" />;

  const txs = item.transactions ?? [];
  const cols = [
    { label: "Tx", cell: (r: any) => txCell(r.tx_hash) },
    { label: "Source", cell: (r: any) => addrCell(r.source) },
    { label: "Destination", cell: (r: any) => addrCell(r.destination) },
    { label: "Fee", numeric: true, cell: (r: any) => (r.fee ? <span className="font-mono">{r.fee}</span> : "—") },
  ];

  return (
    <>
      <Card title={`Block ${commas(item.block_index)}`}>
        <div className="absolute right-4 top-4 flex gap-2">
          <Link href={`/block/${Number(item.block_index) - 1}`} className="rounded border border-zinc-700 px-2 py-1 text-xs !text-zinc-300 !no-underline hover:bg-zinc-900">‹ Prev</Link>
          <Link href={`/block/${Number(item.block_index) + 1}`} className="rounded border border-zinc-700 px-2 py-1 text-xs !text-zinc-300 !no-underline hover:bg-zinc-900">Next ›</Link>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6">
          <KV k="Hash" v={<span className="font-mono break-all">{short(item.block_hash, 16, 12)}</span>} />
          <KV k="Time" v={ts(item.block_time)} />
          <KV k="Previous" v={item.previous_block_hash
            ? <Link href={`/block/${Number(item.block_index) - 1}`} className="font-mono">{short(item.previous_block_hash)}</Link> : "—"} />
          <KV k="Difficulty" v={item.difficulty ? <span className="font-mono">{item.difficulty}</span> : "—"} />
          <KV k="Transactions" v={commas(item.transaction_count ?? txs.length)} />
        </div>
      </Card>
      <Card title="Transactions">
        {txs.length === 0 ? <Empty what="transactions" /> : <RecordTable cols={cols} rows={txs} />}
      </Card>
    </>
  );
}
