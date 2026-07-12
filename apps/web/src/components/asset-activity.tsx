"use client";
import Link from "next/link";
import useSWR from "swr";
import type { AssetActivityMonth, AssetActiveUser } from "@xcp/shared/assets";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Skeleton } from "@/components/ui/feedback";
import { commas, short } from "@/lib/format";
import { AssetActivityChart } from "@/components/asset-activity-chart";
// Static import (not next/dynamic): this whole panel is a DetailTabs entry that only ever renders after a
// client-side tab click — it's never in the SSR tree — so lightweight-charts' DOM init in useEffect is safe,
// and a static import dodges OpenNext's dynamic-chunk 404s. The chart still costs nothing until Activity is opened.

/**
 * The Activity tab: the asset's on-chain life over time (stacked monthly histogram) plus its MOST ACTIVE
 * USERS — addresses ranked by lifetime credits + debits, i.e. who has moved the asset the most, which is a
 * different (and often more telling) question than who holds the most. Both reads are lazy (the panel mounts
 * only when the tab is selected) and computed entirely from our own mirror.
 */
export function AssetActivity({ asset }: { asset: string }) {
  const { data: act } = useSWR<Envelope<AssetActivityMonth[]>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/activity`));
  const { data: usr } = useSWR<Envelope<AssetActiveUser[]>>(apiUrl(`/v2/assets/${encodeURIComponent(asset)}/active-users`));
  const activity = act?.result ?? [];
  const users = usr?.result ?? [];

  return (
    <div className="space-y-4">
      {act == null ? (
        <div className="card"><div className="p-3"><Skeleton rows={4} /></div></div>
      ) : activity.length >= 2 ? (
        <AssetActivityChart data={activity} />
      ) : (
        <div className="card"><div className="px-3 py-8 text-center text-xs text-zinc-600">Not enough activity yet to chart.</div></div>
      )}

      {users.length > 0 && (
        <div className="card factcard">
          <h2>Most active users</h2>
          <div className="body">
            <p className="pb-1 text-xs leading-relaxed text-zinc-500">
              Ranked by lifetime <span className="text-zinc-300">credits + debits</span> — who has <em>used</em> {asset} the most
              (moved it in and out), regardless of what they hold now.
            </p>
            {users.map((u, i) => (
              <div key={u.address} className="row">
                <span className="k inline-flex items-center gap-2">
                  <span className="w-4 text-right text-zinc-600 tabular-nums">{i + 1}</span>
                  <Link href={`/address/${u.address}`} className="font-mono">{short(u.address)}</Link>
                </span>
                <span className="amt mono">{commas(u.activity)} <span className="time">{commas(u.credits)} in · {commas(u.debits)} out</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
