"use client";
import Link from "next/link";
import useSWR from "swr";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { TxView } from "@xcp/shared/chain";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card, KV } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { RecordTable } from "@/components/record-table";
import { addrCell, assetCell, type Col } from "@/lib/cells";
import { eventChip } from "@/lib/mempool";
import { KIND_TAB, btcAmt, satsUsd } from "@/lib/tx";
import { usePrices } from "@/lib/prices";
import { TxActionPanel } from "@/components/tx-action-panel";
import { BitcoinTab, useBitcoinTx } from "@/components/tx-bitcoin";
import { EventsTab } from "@/components/tx-events";
import { commas, ts, timeAgo } from "@/lib/format";

/**
 * The live transaction view — the page both sides of a payment watch. Polls while it matters and
 * stops when it doesn't: every 7s in the mempool, every 30s until 6 confirmations, then never.
 * Structure mirrors the asset page: status hero → the COMPLETE header card (every Bitcoin-level fact
 * we hold — nothing discarded; glanceable first, exhaustive below) → tabs: Overview (what it means),
 * Bitcoin (inputs/outputs via mempool.space), Events (the node's raw protocol events).
 */
const SETTLED = 6; // Bitcoin's customary finality depth

function refreshFor(v: TxView | undefined): number {
  if (!v) return 10_000;
  if (v.status === "mempool") return 7_000;
  return v.confirmations < SETTLED ? 30_000 : 0;
}

// The finality meter: six ticks filling toward settled. Purely visual restatement of the count.
function ConfTicks({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: SETTLED }, (_, i) => (
        <span key={i} className={`inline-block size-2 rounded-[2px] ${i < n ? "bg-(--color-up)" : "bg-zinc-800"}`} />
      ))}
    </span>
  );
}

function StatusHero({ v }: { v: TxView }) {
  // Counterparty-INVALID outranks Bitcoin-confirmed: the tx is real on Bitcoin but the protocol
  // rejected it — a green "Confirmed" here would mislead the person who was sent this link.
  if (v.protocol && !v.protocol.valid) {
    // One line, same register as the other heroes: red verdict · white scope · truncated reason
    // (full text in title) · the Bitcoin truth kept short on the right.
    return (
      <div className="flex items-center gap-x-3 rounded-lg border border-red-500/25 bg-red-500/[0.05] px-4 py-3">
        <XCircle className="size-4 shrink-0 text-(--color-down)" />
        <span className="shrink-0 font-semibold text-red-300">Invalid</span>
        {v.protocol.status && <span className="min-w-0 flex-1 truncate text-sm text-zinc-300" title={v.protocol.status}>{v.protocol.status.replace(/^invalid:\s*/i, "")}</span>}
        <span className="ml-auto shrink-0 text-xs text-zinc-400">confirmed on Bitcoin</span>
      </div>
    );
  }
  if (v.status === "mempool") {
    const seen = v.pending[0]?.timestamp ?? null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-4 py-3">
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
        </span>
        <span className="font-semibold text-amber-300">Unconfirmed</span>
        <span className="text-sm text-zinc-300">in mempool, waiting for the next block</span>
        {seen != null && <span className="text-xs text-zinc-400">· first seen {timeAgo(seen)}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-400"><ConfTicks n={0} /> 0/{SETTLED}</span>
      </div>
    );
  }
  const n = v.confirmations;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] px-4 py-3">
      <CheckCircle2 className="size-4 shrink-0 text-(--color-up)" />
      <span className="font-semibold text-emerald-300">Confirmed</span>
      <span className="text-sm text-zinc-300">{commas(n)} confirmation{n === 1 ? "" : "s"}</span>
      {n < SETTLED && <span className="text-xs text-zinc-400">· settles at {SETTLED}</span>}
      <span className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
        <ConfTicks n={Math.min(n, SETTLED)} /> {Math.min(n, SETTLED)}/{SETTLED}
      </span>
    </div>
  );
}

/** Localized timestamp: the viewer's own timezone, named — with the UTC instant in `title` and shown
 *  muted alongside. Renders UTC until mounted (SSR and first paint match; locale applies on hydrate). */
function LocalTime({ t }: { t: number | null | undefined }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (t == null) return;
    const d = new Date(t * 1000);
    setLocal(d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }));
  }, [t]);
  if (t == null) return <>—</>;
  return (
    <span title={`${ts(t)} UTC`}>
      {local ?? `${ts(t)} UTC`} <span className="text-zinc-500">· {timeAgo(t)}</span>
    </span>
  );
}

// The pending-actions table on the v20 grammar — event chip, asset anchor, quantity, full-ellipsis addresses.
const PENDING_COLS: Col<MempoolActionRow>[] = [
  { label: "Event", w: "110px", priority: 1, cell: (r) => eventChip(r.event) },
  { label: "Asset", w: "minmax(130px,1fr)", priority: 1, cell: (r) => assetCell(r.asset, r.asset_longname) },
  { label: "Quantity", numeric: true, w: "100px", priority: 2, cellClass: "qty", cell: (r) => (r.quantity_normalized != null ? commas(r.quantity_normalized) : "—") },
  { label: "From", w: "minmax(120px,1fr)", priority: 3, cell: (r) => addrCell(r.source) },
  { label: "To", w: "minmax(120px,1fr)", priority: 2, cell: (r) => addrCell(r.destination) },
];

type Tab = "overview" | "bitcoin" | "events";

export function TxLive({ hash, initial }: { hash: string; initial: TxView }) {
  const { data } = useSWR<Envelope<TxView>>(apiUrl(`/v2/transactions/${encodeURIComponent(hash)}`), {
    fallbackData: { result: initial },
    refreshInterval: (latest) => refreshFor(latest?.result),
    revalidateOnFocus: true,
  });
  const v = data?.result ?? initial;
  const pending = v.status === "mempool";
  const { btc: btcUsd } = usePrices();
  const { feeRate, btcTx } = useBitcoinTx(hash); // shared fetch with the Bitcoin tab (SWR dedupes)
  const [tab, setTab] = useState<Tab>("overview");
  const kindTab = v.action ? KIND_TAB[v.action.kind] ?? "Overview" : "Overview";
  const feeUsd = satsUsd(v.fee, btcUsd);

  return (
    <div className="space-y-4">
      <StatusHero v={v} />

      {/* The standard transaction header — the BITCOIN of it all, so it's titled plainly
          "Transaction"; the Counterparty meaning lives in the kind-named first tab. COMPLETE:
          glanceable order (what/when/who/cost), the exhaustive tail (index, payload) below. */}
      <Card title="Transaction">
        <KV k="Hash" v={<span className="inline-flex items-center gap-2 font-mono break-all">{v.tx_hash}<CopyButton value={v.tx_hash} /></span>} />
        <KV k="Block" v={pending
          ? <span className="text-zinc-400">— not yet mined</span>
          : <span className="font-mono"><Link href={`/block/${v.block_index}`}>{commas(v.block_index)}</Link>{v.tip != null && <span className="text-zinc-500"> / tip {commas(v.tip)}</span>}</span>} />
        <KV k="Time" v={pending ? <span className="text-zinc-400">pending</span> : <LocalTime t={v.block_time} />} />
        <KV k="From" v={v.source ? <Link href={`/address/${v.source}`} className="font-mono break-all">{v.source}</Link> : "—"} />
        {v.destination && <KV k="To" v={<Link href={`/address/${v.destination}`} className="font-mono break-all">{v.destination}</Link>} />}
        {v.btc_amount != null && Number(v.btc_amount) > 0 && <KV k="BTC moved" v={<span className="font-mono">{btcAmt(v.btc_amount)}</span>} />}
        {!pending && v.fee != null && Number(v.fee) > 0 && (
          <KV k="TX fee" v={<span className="font-mono">
            {commas(v.fee)} sats <span className="text-zinc-500">({btcAmt(v.fee)}{feeUsd ? ` · ${feeUsd}` : ""})</span>
            {feeRate != null && <span className="text-zinc-400"> · {feeRate >= 10 ? Math.round(feeRate) : feeRate.toFixed(1)} sat/vB</span>}
          </span>} />
        )}
        {btcTx?.vsize != null && <KV k="Size" v={<span className="font-mono">{commas(btcTx.vsize)} vB{btcTx.size != null && <span className="text-zinc-500"> ({commas(btcTx.size)} raw bytes{btcTx.weight != null && <> · {commas(btcTx.weight)} WU</>})</span>}</span>} />}
        {v.tx_index != null && <KV k="Ledger index" v={<span className="font-mono">{commas(v.tx_index)}</span>} />}
        {v.supported === 0 && <KV k="Supported" v={<span className="text-amber-400">no — the node recognized but does not process this message</span>} />}
        {v.data && <KV k="Payload" v={<span className="font-mono break-all text-[11px] leading-relaxed text-zinc-500" title="the raw Counterparty message data carried by this tx">{v.data}</span>} />}
      </Card>

      {/* the asset-page tab grammar: Overview (what it means) · Bitcoin (inputs/outputs) · Events (raw) */}
      <nav className="tabs" style={{ borderBottom: "1px solid var(--border)", marginTop: 0 }} aria-label="Transaction views">
        {([["overview", kindTab], ["bitcoin", "Bitcoin"], ["events", "Events"]] as [Tab, string][]).map(([key, label]) => (
          <a key={key} href="#" className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); setTab(key); }}>{label}</a>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          {v.action && <TxActionPanel action={v.action} tip={v.tip ?? null} />}
          {pending && v.pending.length > 0 && (
            <Card title="Pending actions" icon={<Clock className="size-3.5" />}>
              <RecordTable cols={PENDING_COLS} rows={v.pending} label="pending actions" />
              <p className="mt-3 text-xs text-zinc-500">Parsed from the node&apos;s mempool — final once mined into a block.</p>
            </Card>
          )}
          {!v.action && !pending && (
            <Card title="What happened">
              <p className="text-sm text-zinc-400">This transaction&apos;s message type isn&apos;t classified in the mirror (an OPEN_POOL or dispenser-close message). The Bitcoin and Events tabs carry its full detail.</p>
            </Card>
          )}
        </>
      )}
      {tab === "bitcoin" && <BitcoinTab hash={hash} />}
      {tab === "events" && <EventsTab hash={hash} />}
    </div>
  );
}
