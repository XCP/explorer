import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { TagDetail } from "@xcp/shared/tags";
import { getJson, NotFoundError, type Envelope } from "@/lib/api/server";
import { Stat } from "@/components/ui/card";
import { ScoreBadge } from "@/components/ui/score-badge";
import { TagMembers } from "@/components/tag-members";
import { commas, compact } from "@/lib/format";

// Server-fetch the tag aggregate once; generateMetadata + the page both call this (Next dedupes). Only the
// header + metadata are read here — the paginated member table is a client island (TagMembers). Returns
// null on 404 so only the PAGE calls notFound() (notFound() in generateMetadata renders the error boundary).
async function loadTag(tag: string): Promise<TagDetail | null> {
  try {
    const env = await getJson<Envelope<TagDetail>>(`/v2/tags/${encodeURIComponent(tag)}`, { revalidate: 300 });
    return env.result ?? null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

const usd = (v: number) => (v > 0 ? `$${compact(v)}` : "—");

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params;
  const d = await loadTag(tag);
  if (!d) return { title: "Not found" };
  const members = d.entity_type === "asset" ? `${commas(d.n_assets)} assets` : `${commas(d.n_addresses)} addresses`;
  const description = `Counterparty "${d.tag}" tag — ${members}${d.median_tier ? `, median tier ${d.median_tier}` : ""}. A ${d.source} tag scored as a group.`;
  return { title: `${tag} tag`, description, openGraph: { title: `${tag} | XCP.io`, description } };
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const d = await loadTag(tag);
  if (!d) notFound();
  const isAsset = d.entity_type === "asset";
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100 break-all">{d.tag}</h1>
        <p className="text-sm text-zinc-400 mt-1">
          A <span className="text-zinc-300">{d.source}</span> {d.entity_type} tag, scored as a group. The median is
          the composed-quality tier of a typical member — real demand, realized value, durability — not price.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Members" value={commas(isAsset ? d.n_assets : d.n_addresses)} />
        <Stat label="Median tier" value={d.median_tier ? <ScoreBadge tier={d.median_tier} score={d.median_score} /> : "—"} />
        <Stat label="Low-quality" value={d.pct_low_quality != null ? `${d.pct_low_quality}%` : "—"} />
        <Stat label="Realized USD" value={usd(d.total_realized_usd)} />
        <Stat label="Holders" value={commas(d.total_holders)} />
      </div>
      {isAsset ? <TagMembers tag={d.tag} /> : (
        <p className="text-sm text-zinc-400">This is an address tag — {commas(d.n_addresses)} addresses carry it. Address-member listings live on the reputation surfaces.</p>
      )}
    </>
  );
}
