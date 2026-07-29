import type { Metadata } from "next";
import Link from "next/link";
import type { BlockCensus } from "@xcp/shared/chain";
import { getJson, type Envelope } from "@/lib/api/server";
import { Stat } from "@/components/ui/card";
import { commas, compact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Blocks",
  description:
    "Counterparty's footprint inside Bitcoin, block by block: how many blocks carry Counterparty transactions, what share of all Bitcoin activity that is per era, the miner fees it paid, and the freshest blocks.",
};

const ago = (time: number | null): string => {
  if (!time) return "—";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - time);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export default async function BlocksPage() {
  const census = (await getJson<Envelope<BlockCensus>>(`/v2/blocks/census`, { revalidate: 600 })).result;
  if (!census) throw new Error("census unavailable");

  const withShare = (100 * census.blocks_with_counterparty) / census.blocks_indexed;
  const overallShare = (100 * census.counterparty_transactions) / census.bitcoin_transactions;
  const peakShare = Math.max(...census.years.map((row) => row.share_pct ?? 0));

  return (
    <>
      <div className="pagehead">
        <h1>Blocks</h1>
        <p>
          Counterparty lives inside Bitcoin — every asset, trade, and dispense is a Bitcoin transaction in a Bitcoin
          block. Across <b>{commas(census.blocks_indexed)}</b> blocks since genesis, <b>{withShare.toFixed(1)}%</b>{" "}
          carry at least one Counterparty transaction: the protocol&apos;s footprint, block by block, for twelve years.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Blocks since genesis" value={commas(census.blocks_indexed)} />
        <Stat
          label="With Counterparty"
          value={`${commas(census.blocks_with_counterparty)} · ${withShare.toFixed(1)}%`}
        />
        <Stat label="Counterparty txs" value={compact(census.counterparty_transactions)} />
        <Stat label="Of all Bitcoin txs" value={`${overallShare.toFixed(2)}%`} />
        <Stat label="Miner fees paid" value={`${compact(census.fees_btc)} BTC`} />
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="text-sm font-medium text-zinc-200">Share of Bitcoin, by era</div>
        <div className="mt-3 space-y-1">
          {census.years.map((row) => (
            <div key={row.year} className="flex items-center gap-3">
              <span className="w-10 shrink-0 font-mono text-xs text-zinc-500">{row.year}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-900">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${(100 * (row.share_pct ?? 0)) / peakShare}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-300">
                {row.share_pct != null ? `${row.share_pct.toFixed(2)}%` : "—"}
              </span>
              <span className="hidden w-40 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600 sm:block">
                {compact(row.counterparty_txs)} of {compact(row.bitcoin_txs)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-[80ch] text-xs leading-5 text-zinc-500">
          Counterparty transactions as a share of ALL Bitcoin transactions each year. At the 2015 peak, roughly one
          Bitcoin transaction in 170 was Counterparty. The 2019–20 trough and the 2021–23 revival are the same waves the
          address population shows — the protocol&apos;s whole history, measured against the chain that hosts it.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="text-sm font-medium text-zinc-200">Fees paid to miners, by era</div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-zinc-500">
          {census.years.map((row) => (
            <span key={row.year}>
              {row.year} <span className="text-zinc-300">{row.fees_btc.toFixed(1)}</span>
            </span>
          ))}
        </div>
        <p className="mt-4 max-w-[80ch] text-xs leading-5 text-zinc-500">
          BTC paid by Counterparty transactions for block space — {compact(census.fees_btc)} BTC lifetime. Counterparty
          has no token tax and no separate chain: its entire cost of existence is Bitcoin miner fees, which is also its
          security budget.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium text-zinc-200">Latest blocks</div>
          <div className="font-mono text-xs text-zinc-500">tip {commas(census.as_of_block)}</div>
        </div>
        <ol className="mt-3 text-sm">
          {census.recent.map((block) => (
            <li key={block.block_index} className="flex items-center gap-4 border-b border-zinc-900 py-2 last:border-0">
              <Link href={`/block/${block.block_index}`} className="w-24 shrink-0 font-mono text-zinc-200">
                {commas(block.block_index)}
              </Link>
              <span className="w-16 shrink-0 font-mono text-xs text-zinc-500">{ago(block.block_time)}</span>
              <span className="flex-1 font-mono text-xs text-zinc-400">
                {block.transaction_count ?? 0} Counterparty
                <span className="text-zinc-600">
                  {" "}
                  / {block.bitcoin_transaction_count != null ? commas(block.bitcoin_transaction_count) : "—"} Bitcoin
                </span>
              </span>
              <span className="hidden w-16 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-500 sm:block">
                {block.transaction_count && block.bitcoin_transaction_count
                  ? `${((100 * block.transaction_count) / block.bitcoin_transaction_count).toFixed(1)}%`
                  : "—"}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs leading-5 text-zinc-500">
          The ten freshest blocks and how much of each was Counterparty. Every block links to its full transaction list
          — the index still exists; it just isn&apos;t the point.
        </p>
      </div>
    </>
  );
}
