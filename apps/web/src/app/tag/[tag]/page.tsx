import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { TagDetail } from "@xcp/shared/tags";
import type { CollectionProfile } from "@xcp/shared/collections";
import { getJson, NotFoundError, type Envelope } from "@/lib/api/server";
import { Stat } from "@/components/ui/card";
import { TagMembers } from "@/components/tag-members";
import { commas, compact } from "@/lib/format";

async function loadTag(tag: string): Promise<TagDetail | null> {
  try {
    const envelope = await getJson<Envelope<TagDetail>>(`/v2/tags/${encodeURIComponent(tag)}`, { revalidate: 300 });
    return envelope.result ?? null;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

async function loadCollection(tag: string): Promise<CollectionProfile | null> {
  const envelope = await getJson<Envelope<CollectionProfile>>(`/v2/collection-profiles/${encodeURIComponent(tag)}`, {
    revalidate: 300,
  }).catch(() => null);
  return envelope?.result ?? null;
}

const usd = (value: number) => (value > 0 ? `$${compact(value)}` : "—");

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params;
  const [detail, collection] = await Promise.all([loadTag(tag), loadCollection(tag)]);
  if (!detail) return { title: "Not found" };
  const members =
    detail.entity_type === "asset" ? `${commas(detail.n_assets)} assets` : `${commas(detail.n_addresses)} addresses`;
  const title = collection?.name ?? detail.tag;
  const description = `${title} on Counterparty — ${members}${collection?.median_rating != null ? `, median Rating ${collection.median_rating.toFixed(1)} / 10` : ""}.`;
  return { title, description, openGraph: { title: `${title} | XCP.io`, description } };
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const [detail, collection] = await Promise.all([loadTag(tag), loadCollection(tag)]);
  if (!detail) notFound();
  const isAsset = detail.entity_type === "asset";

  return (
    <>
      <div>
        <h1 className="break-all text-xl font-semibold text-zinc-100">{collection?.name ?? detail.tag}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {collection
            ? "A descriptive collection profile. Each measure stands on its own; there is no collection score."
            : `A ${detail.source} ${detail.entity_type} tag.`}
        </p>
      </div>

      {collection ? (
        <>
          {collection.integrity_assets > 0 ? (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
              Integrity warning: {commas(collection.integrity_assets)} of {commas(collection.members)} members are
              explicitly flagged and receive no numeric Rating.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Members" value={commas(collection.members)} />
            <Stat label="Rated" value={`${commas(collection.rated_members)} · ${collection.rated_pct}%`} />
            <Stat
              label="Median Rating"
              value={collection.median_rating == null ? "—" : `${collection.median_rating.toFixed(1)} / 10`}
            />
            <Stat label="Realized USD" value={usd(collection.total_realized_usd)} />
            <Stat label="Active months" value={commas(collection.total_active_months)} />
            <Stat label="Paid buyers" value={commas(collection.total_paid_buyers)} />
            <Stat label="Unique holders" value={commas(collection.unique_holders)} />
            <Stat
              label="Holder overlap"
              value={collection.holder_overlap_pct == null ? "—" : `${collection.holder_overlap_pct}%`}
            />
            <Stat
              label="Top member value"
              value={collection.top_asset_value_pct == null ? "—" : `${collection.top_asset_value_pct}%`}
            />
            <Stat label="Issuers" value={commas(collection.issuers)} />
          </div>
          <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
            <div className="text-sm font-medium text-zinc-200">Rating distribution</div>
            <div
              className="mt-3 flex h-3 overflow-hidden rounded-full bg-zinc-900"
              aria-label="Rated member distribution"
            >
              {[
                [collection.rating_exceptional, "bg-sky-400"],
                [collection.rating_strong, "bg-sky-600"],
                [collection.rating_developing, "bg-zinc-500"],
                [collection.rating_limited, "bg-zinc-700"],
              ].map(([count, color], index) =>
                Number(count) > 0 ? (
                  <div
                    key={index}
                    className={String(color)}
                    style={{ width: `${(100 * Number(count)) / collection.rated_members}%` }}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-zinc-500">
              <span>9–10 {commas(collection.rating_exceptional)}</span>
              <span>7–8.9 {commas(collection.rating_strong)}</span>
              <span>4–6.9 {commas(collection.rating_developing)}</span>
              <span>0–3.9 {commas(collection.rating_limited)}</span>
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-500">
              Holder overlap is the share of member–holder relationships beyond each unique holder&apos;s first holding.
              Realized value and market activity use the same eligible direct-sale evidence as Asset Rating.
            </p>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Members" value={commas(isAsset ? detail.n_assets : detail.n_addresses)} />
          <Stat
            label="Median Rating"
            value={detail.median_rating == null ? "—" : `${detail.median_rating.toFixed(1)} / 10`}
          />
          <Stat label="Low-quality" value={detail.pct_low_quality != null ? `${detail.pct_low_quality}%` : "—"} />
          <Stat label="Realized USD" value={usd(detail.total_realized_usd)} />
          <Stat label="Holders" value={commas(detail.total_holders)} />
        </div>
      )}

      {isAsset ? (
        <TagMembers tag={detail.tag} />
      ) : (
        <p className="text-sm text-zinc-400">
          This is an address tag — {commas(detail.n_addresses)} addresses carry it. Address-member listings live on the
          reputation surfaces.
        </p>
      )}
    </>
  );
}
