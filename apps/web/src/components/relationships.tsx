"use client";
import useSWR from "swr";
import { GitBranch } from "lucide-react";
import type { AddressConnectionRow, AddressLineageRow } from "@xcp/shared/addresses";
import { apiUrl, type Envelope } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { addrCell } from "@/lib/cells";
import { commas } from "@/lib/format";

// Top counterparties merged across sends + dispenses + DEX trades — the address's on-chain social
// graph, as a ranked list with proportional interaction bars.
export function AddressConnections({ address }: { address: string }) {
  const { data, isLoading } = useSWR<Envelope<AddressConnectionRow[]>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/connections`));
  const rows = data?.result ?? [];
  const max = rows.length ? Number(rows[0].interactions) : 1;
  if (!isLoading && rows.length === 0) return null;
  return (
    <Card title="Connections">
      {isLoading ? <Skeleton rows={3} /> : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.cp} className="relative rounded overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-(--color-accent)/10" style={{ width: `${Math.max(3, (Number(r.interactions) / max) * 100)}%` }} />
              <div className="relative flex items-center justify-between px-2 py-1.5 text-sm">
                <span className="truncate">{addrCell(r.cp)}</span>
                <span className="font-mono text-xs text-zinc-400 shrink-0 ml-2">{commas(r.interactions)}×</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Identity lineage via sweeps — a SWEEP moves all assets + ownership to another address, the strongest
// "same person" signal on chain (commonly legacy 1… → segwit bc1q… wallet migrations).
export function AddressLineage({ address }: { address: string }) {
  const { data } = useSWR<Envelope<AddressLineageRow[]>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/lineage`));
  const rows = data?.result ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-4 py-2.5 text-sm flex items-start gap-2.5">
      <GitBranch className="size-4 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <span className="text-zinc-200 font-medium">Identity lineage <span className="text-zinc-400 font-normal">· linked by sweep (same owner)</span></span>
        {rows.map((r, i) => (
          <span key={i} className="text-zinc-400">
            {r.direction === "out" ? "swept all assets → " : "received sweep ← "}
            {addrCell(r.counterparty)} <span className="text-zinc-500">· block {commas(r.block_index)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
