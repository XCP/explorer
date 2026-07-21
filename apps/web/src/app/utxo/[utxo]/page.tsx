import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { Link2, Unlink, ArrowRight } from "lucide-react";
import type { UtxoDetail, UtxoEvent } from "@xcp/shared/utxos";
import type { Envelope } from "@/lib/api/server";
import { getJson, NotFoundError } from "@/lib/api/server";
import {
  SectionHeader,
  SectionIdentity,
  SectionStats,
  SectionChip,
  type SectionStat,
} from "@/components/section-header";
import { AssetArt } from "@/features/assets/components/asset-art";
import { ART_WIDTH } from "@/lib/art";
import { commas, short, timeAgo } from "@/lib/format";

// A UTXO page is the address view's counterpart for utxo-attached balances: what rides on this
// exact output now, who controls it, and the attach → move → detach chain it sits inside.
async function loadUtxo(utxo: string): Promise<UtxoDetail | null> {
  try {
    const env = await getJson<Envelope<UtxoDetail>>(`/v2/utxos/${encodeURIComponent(utxo)}`, { revalidate: 60 });
    return env.result ?? null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ utxo: string }> }): Promise<Metadata> {
  const { utxo } = await params;
  const decoded = decodeURIComponent(utxo);
  return { title: `UTXO ${short(decoded)}` };
}

/** The other side of an event, linked by its shape: "txid:vout" → /utxo, else /address. */
function party(value: string | null) {
  if (!value) return <span className="text-zinc-500">—</span>;
  const isUtxo = /^[0-9a-f]{64}:\d+$/i.test(value);
  return (
    <Link className="font-mono text-xs" href={(isUtxo ? `/utxo/${value}` : `/address/${value}`) as Route} title={value}>
      {isUtxo ? short(value) : value.length > 20 ? short(value, 8, 6) : value}
    </Link>
  );
}

const EVENT_LABEL: Record<UtxoEvent["type"], string> = {
  attach: "Attached",
  move: "Moved",
  detach: "Detached",
};

export default async function UtxoPage({ params }: { params: Promise<{ utxo: string }> }) {
  const { utxo } = await params;
  const decoded = decodeURIComponent(utxo);
  const item = await loadUtxo(decoded);
  if (!item) notFound();

  const [txid] = item.utxo.split(":");
  const firstEvent = item.history[0] ?? null;
  const lastEvent = item.history[item.history.length - 1] ?? null;
  // Where did it go? Only meaningful once no balances remain on this output.
  const outcome = !item.attached && lastEvent ? lastEvent : null;

  const stats: SectionStat[] = [
    { label: "Assets aboard", value: String(item.balances.length) },
    ...(firstEvent?.block_time ? [{ label: "First event", value: timeAgo(firstEvent.block_time) }] : []),
    ...(lastEvent?.block_time ? [{ label: "Last event", value: timeAgo(lastEvent.block_time) }] : []),
  ];

  return (
    <>
      <SectionHeader flush>
        <SectionIdentity
          name={<span className="font-mono">{short(item.utxo, 10, 8)}</span>}
          chips={
            <>
              {item.attached ? (
                <SectionChip variant="open">
                  <Link2 className="size-3" aria-hidden /> ATTACHED
                </SectionChip>
              ) : (
                <SectionChip variant="neutral">
                  <Unlink className="size-3" aria-hidden /> {outcome?.type === "detach" ? "DETACHED" : "MOVED ON"}
                </SectionChip>
              )}
              {item.address && (
                <SectionChip variant="neutral" href={`/address/${item.address}` as Route}>
                  {short(item.address, 8, 6)}
                </SectionChip>
              )}
              <SectionChip variant="neutral" href={`/tx/${txid}` as Route}>
                view tx
              </SectionChip>
            </>
          }
        />
        <SectionStats stats={stats} />
      </SectionHeader>

      {item.balances.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">On this output</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {item.balances.map((balance) => (
              <Link
                key={balance.asset}
                className="g-card"
                href={`/asset/${encodeURIComponent(balance.asset)}` as Route}
              >
                <div className="g-art">
                  <AssetArt asset={balance.asset} w={ART_WIDTH.card} className="size-full" />
                </div>
                <div className="g-meta">
                  <div className="g-name">{balance.asset_longname || balance.asset}</div>
                  <div className="g-why">{commas(balance.quantity_normalized)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">Provenance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-1.5 pr-4">Event</th>
                <th className="py-1.5 pr-4">When</th>
                <th className="py-1.5 pr-4">Asset</th>
                <th className="py-1.5 pr-4 text-right">Quantity</th>
                <th className="py-1.5 pr-4">From</th>
                <th className="py-1.5 pr-4" aria-hidden />
                <th className="py-1.5 pr-4">To</th>
                <th className="py-1.5">Tx</th>
              </tr>
            </thead>
            <tbody>
              {item.history.map((event, index) => (
                <tr key={index} className="border-t border-zinc-800">
                  <td className="py-2 pr-4">{EVENT_LABEL[event.type]}</td>
                  <td className="py-2 pr-4 text-zinc-400">{event.block_time ? timeAgo(event.block_time) : "—"}</td>
                  <td className="py-2 pr-4">
                    {event.asset ? (
                      <Link className="font-mono text-xs" href={`/asset/${encodeURIComponent(event.asset)}` as Route}>
                        {event.asset}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">{commas(event.quantity_normalized)}</td>
                  <td className="py-2 pr-4">{party(event.source ?? event.source_address)}</td>
                  <td className="py-2 pr-4 text-zinc-600">
                    <ArrowRight className="size-3" aria-hidden />
                  </td>
                  <td className="py-2 pr-4">{party(event.destination ?? event.destination_address)}</td>
                  <td className="py-2">
                    {event.tx_hash ? (
                      <Link className="font-mono text-xs" href={`/tx/${event.tx_hash}` as Route} title={event.tx_hash}>
                        {short(event.tx_hash, 6, 4)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
