"use client";
import Link from "next/link";
import useSWR from "swr";
import type { CollectionCandidatesPayload } from "@xcp/shared/collections";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { AssetIcon } from "@/components/ui/badges";
import { commas, usdCompact, short } from "@/lib/format";

// Collection candidates — issuer clusters of uncollected media assets held by real collectors that look like
// projects we haven't tagged. Discovery, judged by who holds it. The owner reviews here, then promotes a
// cluster to a tag (admin). Client island rendered by the thin server page that owns the metadata.
export function CollectionCandidates() {
  const { data } = useSWR<Envelope<CollectionCandidatesPayload>>(apiUrl("/v2/collections/candidates"));
  const rows = data?.result.candidates;
  return (
    <>
      <div className="pagehead">
        <h1>Collection Candidates</h1>
        <p>
          Undiscovered projects. Issuers with a cluster of <b>media assets</b> that aren&rsquo;t tagged as a
          collection yet, held by <b>real, sophisticated collectors</b> — judged by who holds it, not by any
          directory. Includes art that was minted but never sold. Ranked by a composite of holder
          sophistication, cluster size, and creator-heaviness. <Link href="/collections">← Collections</Link>
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
              <li key={r.issuer} className="flex items-start gap-3 py-3 border-b border-zinc-900 last:border-0">
                <span className="w-5 shrink-0 text-right text-zinc-600 font-mono text-xs mt-1 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/address/${r.issuer}`} className="font-mono text-zinc-200">{short(r.issuer, 10, 6)}</Link>
                    <span className="text-xs text-zinc-500 tabular-nums">{commas(r.assets)} assets</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {r.samples.map((a) => (
                      <Link key={a} href={`/asset/${a}`} title={a} className="shrink-0"><AssetIcon asset={a} size={22} /></Link>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500 mt-1.5">
                    <span><span className="text-zinc-300 tabular-nums">{commas(r.avg_holders)}</span> avg holders</span>
                    <span>holder&nbsp;DEX <span className="text-zinc-300 tabular-nums">{commas(r.holder_dex)}</span></span>
                    <span><span className="text-zinc-300 tabular-nums">{r.creator_pct}%</span> creators</span>
                    <span className="text-zinc-600">{r.realized_usd > 0 ? `${usdCompact(r.realized_usd)} realized` : "never sold"}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right w-12">
                  <div className="font-mono text-base text-(--color-xcp) tabular-nums leading-none">{r.score}</div>
                  <div className="text-[10px] text-zinc-600 uppercase tracking-wide mt-1">Score</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
