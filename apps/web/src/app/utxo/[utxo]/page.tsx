import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { Link2, Unlink } from "lucide-react";
import type { UtxoDetail } from "@xcp/shared/utxos";
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
import { UtxoTabs } from "@/features/utxos/components/utxo-tabs";
import { commas, short, timeAgo } from "@/lib/format";

// The UTXO page — the asset page's anatomy (SectionHeader → .mag plate + factcard → DetailTabs) at
// output scale: what rides on this exact Bitcoin output, who controls it, and its attach→move→detach
// life. A UTXO is a transient holder, so the plate shows its CARGO's art — the output has no face of
// its own; the asset riding it is the identity a reader recognizes.
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
  return { title: `UTXO ${short(decodeURIComponent(utxo))}` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fullDate = (sec?: number | null) => {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

export default async function UtxoPage({ params }: { params: Promise<{ utxo: string }> }) {
  const { utxo } = await params;
  const item = await loadUtxo(decodeURIComponent(utxo));
  if (!item) notFound();

  const [txid, vout] = item.utxo.split(":");
  const firstEvent = item.history[0] ?? null;
  const lastEvent = item.history[item.history.length - 1] ?? null;
  // The cargo's face: live balances lead; a historical holder still shows what once rode it.
  const primary = item.balances[0]?.asset ?? item.history.find((event) => event.asset)?.asset ?? null;
  const status = item.attached ? "Attached" : lastEvent?.type === "detach" ? "Detached" : "Moved on";

  const stats: SectionStat[] = [
    { label: "Assets aboard", value: String(item.balances.length), detail: status.toLowerCase() },
    ...(firstEvent?.block_time
      ? [{ label: "First event", value: timeAgo(firstEvent.block_time), detail: firstEvent.type }]
      : []),
    ...(lastEvent?.block_time
      ? [{ label: "Last event", value: timeAgo(lastEvent.block_time), detail: lastEvent.type }]
      : []),
  ];

  const overview = (
    <div className="mag">
      <div className="plate">
        {primary ? (
          <AssetArt asset={primary} priority natural original />
        ) : (
          <div className="aspect-square w-full bg-zinc-900" />
        )}
        <div className="cap">
          <span>
            <b>{primary ?? short(item.utxo)}</b> · {item.attached ? "riding this output" : "formerly aboard"}
          </span>
          <span className="mono">
            {short(txid!, 8, 6)}:{vout}
          </span>
        </div>
      </div>
      <div className="magcol">
        <div className="card factcard">
          <h2>Output info</h2>
          <div className="body">
            <div className="row">
              <span className="k">Status</span>
              <span className="amt mono">
                {status}
                {!item.attached && lastEvent?.type === "move" && lastEvent.destination ? (
                  <>
                    {" "}
                    <span className="time">
                      to <Link href={`/utxo/${lastEvent.destination}` as Route}>{short(lastEvent.destination)}</Link>
                    </span>
                  </>
                ) : null}
              </span>
            </div>
            <div className="row">
              <span className="k">Controller</span>
              <span className="amt mono">
                {item.address ? <Link href={`/address/${item.address}` as Route}>{short(item.address)}</Link> : "—"}
              </span>
            </div>
            <div className="row">
              <span className="k">Output</span>
              <span className="amt mono">
                <Link href={`/tx/${txid}` as Route}>{short(txid!, 8, 6)}</Link>{" "}
                <span className="time">vout {vout}</span>
              </span>
            </div>
            {firstEvent?.block_time && (
              <div className="row">
                <span className="k">{firstEvent.type === "attach" ? "Attached" : "Arrived"}</span>
                <span className="amt mono">{fullDate(firstEvent.block_time)}</span>
              </div>
            )}
          </div>
        </div>
        {item.balances.length > 0 && (
          <div className="card factcard">
            <h2>Aboard</h2>
            <div className="body">
              {item.balances.map((balance) => (
                <div className="row" key={balance.asset}>
                  <span className="k">
                    <Link href={`/asset/${encodeURIComponent(balance.asset)}` as Route}>
                      {balance.asset_longname || balance.asset}
                    </Link>
                  </span>
                  <span className="amt mono">{commas(balance.quantity_normalized)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <SectionHeader flush>
        <SectionIdentity
          visual={
            primary ? (
              <img className="icon" src={`https://cdn.xcp.io/img/icon/${encodeURIComponent(primary)}`} alt="" />
            ) : undefined
          }
          name={<span className="font-mono">{short(item.utxo, 10, 8)}</span>}
          chips={
            <>
              {item.attached ? (
                <SectionChip variant="open">
                  <Link2 className="size-3" aria-hidden /> ATTACHED
                </SectionChip>
              ) : (
                <SectionChip variant="neutral">
                  <Unlink className="size-3" aria-hidden /> {status.toUpperCase()}
                </SectionChip>
              )}
              {item.address && (
                <SectionChip variant="neutral" href={`/address/${item.address}` as Route}>
                  {short(item.address, 8, 6)}
                </SectionChip>
              )}
            </>
          }
        />
        <SectionStats stats={stats} />
      </SectionHeader>
      <UtxoTabs utxo={item.utxo} overview={overview} />
    </>
  );
}
