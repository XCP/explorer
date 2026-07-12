"use client";
import useSWR from "swr";
import type { TxEvent } from "@xcp/shared/chain";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { eventChip } from "@/lib/mempool";

/**
 * The Events tab — the tx's raw Counterparty events as the protocol emitted them (proxied from the
 * node). This is the technical ground truth behind the Overview's interpretation: every CREDIT/DEBIT
 * and message event, with its full params. Params render as pretty JSON — this tab is for the
 * researcher, not the newcomer.
 */
export function EventsTab({ hash }: { hash: string }) {
  const { data, isLoading } = useSWR<Envelope<TxEvent[]>>(apiUrl(`/v2/transactions/${encodeURIComponent(hash)}/events`));
  const events = data?.result ?? [];
  if (isLoading) return <Card title="Events"><Skeleton rows={6} /></Card>;
  if (!events.length) {
    return <Card title="Events"><p className="text-sm text-zinc-400">No events available from the node for this transaction.</p></Card>;
  }
  return (
    <Card title={`Counterparty events · ${events.length}`}>
      <div className="space-y-3">
        {events.map((e, i) => (
          <div key={i} className="rounded-lg border border-zinc-900 bg-[#0d0f13]">
            <div className="flex items-center gap-2 border-b border-zinc-900 px-3 py-2">
              {eventChip(e.event)}
              {e.event_index != null && <span className="font-mono text-[11px] text-zinc-500">#{e.event_index}</span>}
            </div>
            <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-300">{JSON.stringify(e.params ?? {}, null, 2)}</pre>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">Raw protocol events from the Counterparty node — the ground truth the Overview interprets.</p>
    </Card>
  );
}
