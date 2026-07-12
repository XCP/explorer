"use client";
import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import type { BitcoinTxIo, BitcoinTxSummary } from "@xcp/shared/chain";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { btcAmt } from "@/lib/tx";
import { commas, short } from "@/lib/format";

/**
 * The Bitcoin layer of a transaction — inputs LEFT, outputs RIGHT (the classic explorer read), each
 * row expandable for the full detail (exact sats, script type, funding outpoint). Two independent
 * sources so neither's rate limit breaks the page: mempool.space first, falling back to our API's
 * Counterparty-node bitcoind proxy. Size/fee-rate live in the page HEADER (via useBitcoinTx), not
 * here — this tab is purely the flow of coins.
 */

interface MempoolSpaceVout {
  scriptpubkey_address?: string;
  scriptpubkey_type?: string;
  value: number;
}
interface MempoolSpaceTx {
  fee: number;
  weight: number;
  size: number;
  vin: { txid?: string; vout?: number; prevout: MempoolSpaceVout | null; is_coinbase?: boolean }[];
  vout: MempoolSpaceVout[];
}

const fromMempoolSpace = (t: MempoolSpaceTx): BitcoinTxSummary => ({
  fee_sats: t.fee ?? null,
  size: t.size ?? null,
  weight: t.weight ?? null,
  vsize: t.weight != null ? Math.ceil(t.weight / 4) : null,
  vin: t.vin.map((v): BitcoinTxIo =>
    v.is_coinbase
      ? { address: null, sats: null, type: "coinbase", prev: null }
      : {
          address: v.prevout?.scriptpubkey_address ?? null,
          sats: v.prevout?.value ?? null,
          type: v.prevout?.scriptpubkey_type ?? null,
          prev: v.txid != null ? `${v.txid}:${v.vout ?? 0}` : null,
        },
  ),
  vout: t.vout.map((v): BitcoinTxIo => ({
    address: v.scriptpubkey_address ?? null,
    sats: v.value ?? null,
    type: v.scriptpubkey_type ?? null,
    prev: null,
  })),
});

type Sourced = BitcoinTxSummary & { source: "mempool.space" | "counterparty node" };
const REQUEST_TIMEOUT_MS = 8_000;

async function fetchBitcoinTx(hash: string): Promise<Sourced> {
  try {
    const r = await fetch(`https://mempool.space/api/tx/${hash}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (r.ok) return { ...fromMempoolSpace(await r.json()), source: "mempool.space" };
  } catch {
    /* fall through to the node */
  }
  const r2 = await fetch(apiUrl(`/v2/transactions/${encodeURIComponent(hash)}/bitcoin`), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r2.ok) throw new Error(String(r2.status));
  const env = (await r2.json()) as Envelope<BitcoinTxSummary>;
  if (!env.result) throw new Error("no result");
  return { ...env.result, source: "counterparty node" };
}

/** The Bitcoin-level view of one tx — also feeds the header's TX-fee rate + size row. */
export function useBitcoinTx(hash: string) {
  const { data, error, isLoading } = useSWR<Sourced>(["btc-tx", hash], () => fetchBitcoinTx(hash), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const feeRate = data?.fee_sats != null && data.vsize ? data.fee_sats / data.vsize : null;
  return { btcTx: data ?? null, feeRate, failed: !!error, loading: isLoading };
}

// One input/output row: address + amount on one line; the chevron expands the full detail
// (exact sats, script type, and — for inputs — the funding outpoint, linked).
function IoRow({ io }: { io: BitcoinTxIo }) {
  const [open, setOpen] = useState(false);
  const label = io.address ? (
    <Link href={`/address/${io.address}`} className="address" title={io.address}>
      {io.address}
    </Link>
  ) : io.type === "coinbase" ? (
    <span className="font-mono text-xs text-zinc-500">coinbase (new coins)</span>
  ) : io.type === "op_return" || io.type === "nulldata" ? (
    <span className="font-mono text-xs text-zinc-500">OP_RETURN (data)</span>
  ) : io.prev ? (
    <span className="font-mono text-xs text-zinc-500" title={io.prev}>
      outpoint {short(io.prev, 10, 8)}
    </span>
  ) : (
    <span className="font-mono text-xs text-zinc-500">{io.type ?? "non-standard"}</span>
  );
  return (
    <div className="border-b border-zinc-900 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-2 text-left text-sm"
      >
        <span
          aria-hidden="true"
          className={`shrink-0 text-[9px] text-zinc-600 transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-zinc-100">
          {io.sats != null ? btcAmt(io.sats) : <span className="text-zinc-600">—</span>}
        </span>
      </button>
      {open && (
        <div className="mb-2 ml-4 rounded-md border border-zinc-900 bg-[#0d0f13] px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
          {io.sats != null && (
            <div>
              amount <span className="text-zinc-200">{commas(io.sats)} sats</span> = {btcAmt(io.sats)}
            </div>
          )}
          {io.type && (
            <div>
              script type <span className="text-zinc-200">{io.type}</span>
            </div>
          )}
          {io.address && (
            <div className="break-all">
              address{" "}
              <Link href={`/address/${io.address}`} className="text-zinc-200">
                {io.address}
              </Link>
            </div>
          )}
          {io.prev && (
            <div className="break-all">
              funded by{" "}
              <Link href={`/tx/${io.prev.split(":")[0]}`} className="text-zinc-200">
                {io.prev}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BitcoinTab({ hash }: { hash: string }) {
  const { btcTx, failed, loading } = useBitcoinTx(hash);
  if (loading)
    return (
      <Card title="Bitcoin transaction">
        <Skeleton rows={6} />
      </Card>
    );
  if (failed || !btcTx) {
    return (
      <Card title="Bitcoin transaction">
        <p className="text-sm text-zinc-400">
          Couldn&apos;t load the Bitcoin-level detail from either source (mempool.space, Counterparty node) right now.
        </p>
      </Card>
    );
  }
  const sum = (xs: BitcoinTxIo[]) => xs.reduce<number | null>((s, v) => (v.sats == null ? s : (s ?? 0) + v.sats), null);
  const inTotal = sum(btcTx.vin),
    outTotal = sum(btcTx.vout);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`Inputs · ${btcTx.vin.length}`}>
          {btcTx.vin.map((io, i) => (
            <IoRow key={i} io={io} />
          ))}
          {inTotal != null && (
            <div className="mt-2 text-right font-mono text-xs text-zinc-500">in {btcAmt(inTotal)}</div>
          )}
        </Card>
        <Card title={`Outputs · ${btcTx.vout.length}`}>
          {btcTx.vout.map((io, i) => (
            <IoRow key={i} io={io} />
          ))}
          {outTotal != null && (
            <div className="mt-2 text-right font-mono text-xs text-zinc-500">out {btcAmt(outTotal)}</div>
          )}
        </Card>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Bitcoin-level data via {btcTx.source} · click a row for the full detail.
      </p>
    </>
  );
}
