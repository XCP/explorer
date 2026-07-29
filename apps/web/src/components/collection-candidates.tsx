"use client";
import Link from "next/link";
import useSWR from "swr";
import type { CollectionCandidatesPayload } from "@xcp/shared/collections";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { commas, short } from "@/lib/format";

// Collection candidates — untagged assets the collector base has already chosen, ranked by collectors
// who acquired them by CHOICE (trade / dispense / non-distributor send) so airdrop blasts can't
// manufacture a place on the board. The owner reviews here, then promotes to a tag (admin). Client
// island rendered by the thin server page that owns the metadata.
export function CollectionCandidates() {
  const { data } = useSWR<Envelope<CollectionCandidatesPayload>>(apiUrl("/v2/collections/candidates"));
  const rows = data?.result.candidates;
  return (
    <>
      <div className="pagehead">
        <h1>Collection Candidates</h1>
        <p>
          Assets no collection tag claims yet, ranked by the <b>collectors who chose them</b> — holders with the
          Collector persona who acquired the asset through a trade, a dispense, or a send from anyone other than the
          asset&rsquo;s dominant distributor. Airdropped balances don&rsquo;t count as choosing.{" "}
          <Link href="/collections">← Collections</Link>
        </p>
      </div>
      <Card>
        {!rows ? (
          <Skeleton rows={10} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">No candidates right now.</p>
        ) : (
          <ol className="text-sm">
            {rows.map((r, i) => (
              <li key={r.asset} className="flex items-center gap-3 py-2.5 border-b border-zinc-900 last:border-0">
                <span className="w-7 shrink-0 text-right text-zinc-600 font-mono text-xs tabular-nums">{i + 1}</span>
                <Link href={`/asset/${r.asset}`} className="shrink-0">
                  <AssetIcon asset={r.asset} size={28} />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/asset/${r.asset}`} className="block truncate font-medium text-zinc-200">
                    {r.asset_longname ?? r.asset}
                  </Link>
                  <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
                    <span>
                      <span className="text-zinc-300 tabular-nums">{commas(r.collector_holders)}</span> collectors ·{" "}
                      <span className="text-zinc-300 tabular-nums">{commas(r.holders ?? 0)}</span> holders
                    </span>
                    {r.issuer ? (
                      <Link href={`/address/${r.issuer}`} className="font-mono text-zinc-600">
                        {short(r.issuer, 8, 5)}
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right w-16">
                  <div className="font-mono text-base text-(--color-xcp) tabular-nums leading-none">
                    {commas(r.chosen_collectors)}
                  </div>
                  <div className="text-[10px] text-zinc-600 uppercase tracking-wide mt-1">Chose it</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
