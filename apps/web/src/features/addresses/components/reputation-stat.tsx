"use client";
import useSWR from "swr";
import type { AddressReputation } from "@xcp/shared/addresses";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api/url";

/** The address band's Reputation stat value — a tiny client island so the server-rendered stat strip
 *  can lead with the composed score. Null score (new/quiet/infra address) reads as a dash. */
export function ReputationStat({ address }: { address: string }) {
  const { data } = useSWR<Envelope<AddressReputation>>(
    apiUrl(`/v2/addresses/${encodeURIComponent(address)}/reputation`),
  );
  const r = data?.result;
  return (
    <>
      {r?.track_record.score ?? "—"}
      {r?.track_record.tier && (
        <span className="ml-1.5 text-[11px] font-normal text-zinc-400">{r.track_record.tier}</span>
      )}
    </>
  );
}
