import type { Metadata } from "next";
import Link from "next/link";
import type { AddressSummary } from "@xcp/shared/addresses";
import { getJson, NotFoundError, type Envelope } from "@/lib/api/server";
import { SectionHeader, SectionIdentity, SectionStats, SectionChip, type SectionStat } from "@/components/section-header";
import { CopyButton } from "@/components/copy-button";
import { GraphTrustChip } from "@/components/graph-trust-chip";
import { AddressTabs } from "@/components/address-tabs";
import { Holdings } from "@/components/holdings";
import { AddressConnections, AddressLineage } from "@/components/relationships";
import { ReputationHeader } from "@/components/reputation";
import { ReputationStat } from "@/components/reputation-stat";
import { PendingActions } from "@/components/pending-actions";
import { commas, short } from "@/lib/format";

const BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const Chip = ({ children }: { children: React.ReactNode }) => <SectionChip>{children}</SectionChip>;

// Deterministic identity visual (v11 reference): 2-3 hues hashed from the address chars, blended as a
// 135° gradient — every address gets a stable face without any asset art. Server-safe (pure string math).
function AddressGradient({ address }: { address: string }) {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  const hues = [h % 360, (h >> 7) % 360, (h >> 14) % 360];
  return (
    <div
      aria-hidden
      className="size-[52px] shrink-0 rounded-lg border border-zinc-800"
      style={{ background: `linear-gradient(135deg, hsl(${hues[0]} 55% 38%) 0%, hsl(${hues[1]} 50% 30%) 60%, hsl(${hues[2]} 45% 24%) 100%)` }}
    />
  );
}

// The summary is one of several panels, not a gate — an address with no history still renders (dashes),
// so we tolerate a null result and only translate a real 404 into notFound().
async function loadSummary(address: string): Promise<AddressSummary | null> {
  try {
    const env = await getJson<Envelope<AddressSummary | null>>(`/v2/addresses/${encodeURIComponent(address)}/summary`, { revalidate: 30 });
    return env.result;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const title = `Address ${short(address)}`;
  const description = `Counterparty holdings, activity, and reputation for address ${address}.`;
  return { title, description, openGraph: { title: `${title} | XCP.io`, description } };
}

// Identity-first section band (v3 chrome, v11 reference): who is this address (gradient visual +
// archetype chips), then reputation-first headline stats. Server-rendered from the fetched summary;
// the copy button, graph-trust chip, and reputation score are client islands.
function AddressHeader({ address, s }: { address: string; s: AddressSummary | null }) {
  const xcp = Number(s?.xcp) || 0;
  const stats: SectionStat[] = [
    { label: "Reputation", value: <ReputationStat address={address} /> },
    { label: "Assets held", value: commas(s?.assets) },
    { label: "Assets issued", value: commas(s?.issued) },
  ];
  if (s?.first_block != null) {
    stats.push({ label: "First block", value: <Link href={`/block/${s.first_block}`}>{commas(s.first_block)}</Link> });
  }
  stats.push({ label: "XCP balance", value: commas(Math.round(Number(s?.xcp) || 0)), hideOnMobile: true });
  stats.push({ label: "Dispensers", value: commas(s?.dispensers), hideOnMobile: true });
  return (
    <SectionHeader flush>
      <SectionIdentity
        compact
        visual={<AddressGradient address={address} />}
        name={address}
        chips={<>
          <GraphTrustChip kind="addresses" id={address} />
          {address === BURN_ADDRESS && <Chip>Burn address</Chip>}
          {(s?.issued ?? 0) > 0 && <Chip>Issuer · {commas(s?.issued)} assets</Chip>}
          {(s?.dispensers ?? 0) > 0 && <Chip>Dispenser operator{(s?.open_dispensers ?? 0) > 0 ? ` · ${s?.open_dispensers} open` : ""}</Chip>}
          {(s?.open_orders ?? 0) > 0 && <Chip>Active trader · {s?.open_orders} open</Chip>}
          {xcp >= 50000 && <Chip>XCP whale</Chip>}
          {!s?.issued && !s?.dispensers && (s?.assets ?? 0) > 0 && <Chip>Holder</Chip>}
        </>}
        actions={<CopyButton value={address} />}
      />
      <SectionStats stats={stats} />
    </SectionHeader>
  );
}

export default async function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const summary = await loadSummary(address);

  const overview = (
    <>
      <ReputationHeader address={address} />
      <AddressLineage address={address} />
      <PendingActions address={address} />
      <Holdings address={address} />
      <AddressConnections address={address} />
    </>
  );

  return (
    <>
      <AddressHeader address={address} s={summary} />
      <AddressTabs address={address} inBand overview={overview} />
    </>
  );
}
