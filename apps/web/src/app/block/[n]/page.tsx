import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { BlockDetail, BlockTxSummary } from "@xcp/shared/chain";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { Card, KV } from "@/components/ui/card";
import { Empty } from "@/components/ui/feedback";
import { RecordTable } from "@/components/record-table";
import { type Col, txCell, addrCell } from "@/lib/cells";
import { commas, short, ts } from "@/lib/format";

async function loadBlock(n: string): Promise<BlockDetail> {
  let env: Envelope<BlockDetail>;
  try {
    env = await getJson<Envelope<BlockDetail>>(`/v2/blocks/${encodeURIComponent(n)}`, { revalidate: 30 });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (!env.result) notFound();
  return env.result;
}

export async function generateMetadata({ params }: { params: Promise<{ n: string }> }): Promise<Metadata> {
  const { n } = await params;
  const title = `Block ${commas(n)}`;
  const description = `Counterparty transactions in Bitcoin block ${n}.`;
  return { title, description, openGraph: { title: `${title} | XCP.io`, description } };
}

export default async function BlockPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const item = await loadBlock(n);

  const txs = item.transactions ?? [];
  const cols: Col<BlockTxSummary>[] = [
    { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    { label: "Source", cell: (r) => addrCell(r.source) },
    { label: "Destination", cell: (r) => addrCell(r.destination) },
    { label: "Fee", numeric: true, cell: (r) => (r.fee ? <span className="font-mono">{r.fee}</span> : "—") },
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
