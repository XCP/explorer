import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReputationTiersOverview, ReputationTierMembers } from "@xcp/shared/addresses";
import { getJson, type Envelope } from "@/lib/api/server";
import { SectionHeader, SectionIdentity, SectionStats } from "@/components/section-header";
import { addrCell } from "@/features/records/cells";
import { commas } from "@/lib/format";

const VALID = new Set(["og", "established", "active", "casual"]);

export async function generateMetadata({ params }: { params: Promise<{ tier: string }> }): Promise<Metadata> {
  const { tier } = await params;
  const slug = tier.toLowerCase();
  if (!VALID.has(slug)) return { title: "Reputation tier" };
  const env = await getJson<Envelope<ReputationTiersOverview>>("/v2/reputation/tiers", { revalidate: 300 }).catch(
    () => null,
  );
  const t = env?.result?.tiers.find((x) => x.slug === slug);
  return { title: `${t?.tier ?? slug} reputation`, description: t?.meaning };
}

// The score's evidence columns — the same signals the tier is built from, so the leaderboard shows WHY
// each wallet ranks where it does (mirrors ReputationTopRow).
const COLS: { label: string; key: keyof ReputationTierMembers["members"][number]; right?: boolean }[] = [
  { label: "Created", key: "survived_assets", right: true },
  { label: "Holds", key: "assets_held", right: true },
  { label: "DEX", key: "dex_trades", right: true },
  { label: "Stamps", key: "stamps_created", right: true },
  { label: "Dividends", key: "dividends", right: true },
  { label: "BTC fees", key: "btc_fees", right: true },
];

export default async function TierPage({ params }: { params: Promise<{ tier: string }> }) {
  const { tier } = await params;
  const slug = tier.toLowerCase();
  if (!VALID.has(slug)) notFound();
  const [overviewEnv, membersEnv] = await Promise.all([
    getJson<Envelope<ReputationTiersOverview>>("/v2/reputation/tiers", { revalidate: 300 }).catch(() => null),
    getJson<Envelope<ReputationTierMembers>>(`/v2/reputation/tiers/${slug}?limit=50`, { revalidate: 300 }).catch(
      () => null,
    ),
  ]);
  const tiersList = overviewEnv?.result?.tiers ?? [];
  const idx = tiersList.findIndex((t) => t.slug === slug);
  const summary = idx >= 0 ? tiersList[idx] : undefined;
  if (!summary) notFound();
  const total = overviewEnv?.result?.total ?? 0;
  const members = membersEnv?.result?.members ?? [];
  const share = total ? ((100 * summary.count) / total).toFixed(1) : "0";
  // cumulative percentile band — the newcomer-legible framing (not the raw cutoff)
  const cum = tiersList.slice(0, idx + 1).reduce((sum, t) => sum + t.count, 0);
  const band =
    idx === tiersList.length - 1
      ? "Everyone else"
      : `Top ${total && (100 * cum) / total < 1.5 ? 1 : Math.round((100 * cum) / total)}%`;

  return (
    <>
      <SectionHeader>
        <SectionIdentity
          name={
            <>
              {summary.tier} <span className="text-zinc-500">reputation</span>
            </>
          }
          chips={<span className="chip og">{band}</span>}
        />
        <SectionStats
          stats={[
            { label: "Wallets", value: commas(summary.count) },
            { label: "Share of users", value: `${share}%` },
          ]}
        />
      </SectionHeader>

      <p className="max-w-[72ch] text-sm leading-relaxed text-zinc-400">
        {summary.meaning}. A wallet reaches <span className="text-zinc-200">{summary.tier}</span> when its reputation
        score — earned across its whole Counterparty history, not its holdings of any one asset — puts it in the{" "}
        {band === "Everyone else" ? "remaining half" : band.toLowerCase()} of real users. Exchanges, custody, burn and
        empty wallets aren&apos;t scored.{" "}
        <Link href="/reputation" className="hover:text-(--color-accent)">
          ← all tiers
        </Link>
      </p>

      <div className="card overflow-hidden">
        <h2>{summary.tier} wallets · highest score first</h2>
        <p className="border-b border-[var(--border2)] px-3.5 py-2 text-xs text-zinc-500">
          Score is the internal reputation number — higher means more, longer, realer history. The columns show the
          evidence behind it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border2)] bg-[var(--panel2)] text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Address</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                {COLS.map((c) => (
                  <th key={c.label} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.address} className="border-b border-[#14171d] last:border-0 hover:bg-white/[.02]">
                  <td className="px-3 py-2 font-mono text-zinc-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2 max-w-0">{addrCell(m.address)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-100">{m.raw}</td>
                  {COLS.map((c) => (
                    <td key={c.label} className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400">
                      {commas(m[c.key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={3 + COLS.length} className="px-3 py-6 text-center text-zinc-500">
                    No wallets in this tier.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
