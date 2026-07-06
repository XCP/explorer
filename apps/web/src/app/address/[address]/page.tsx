import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Store, ArrowLeftRight, Flame, Wallet, Stamp } from "lucide-react";
import type { AddressSummary } from "@xcp/shared/addresses";
import { getJson, NotFoundError, type Envelope } from "@/lib/api";
import { Card, Stat } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { AddressTabs } from "@/components/address-tabs";
import { Holdings } from "@/components/holdings";
import { AddressConnections, AddressLineage } from "@/components/relationships";
import { ReputationHeader } from "@/components/reputation";
import { commas, short } from "@/lib/format";

const BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const Chip = ({ children }: { children: React.ReactNode }) =>
  <span className="inline-flex items-center gap-1 rounded-md bg-zinc-800 text-zinc-200 px-2 py-1 text-xs font-medium ring-1 ring-inset ring-white/5">{children}</span>;

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

// Identity-first header: who is this address (archetype chips) + how old/active, then balances.
// Server-rendered from the fetched summary; only the copy button is a client island.
function AddressHeader({ address, s }: { address: string; s: AddressSummary | null }) {
  const xcp = Number(s?.xcp) || 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm break-all text-zinc-100">{address}</span>
        <CopyButton value={address} />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {address === BURN_ADDRESS && <Chip><Flame className="size-3 text-orange-400" />Burn address</Chip>}
        {(s?.issued ?? 0) > 0 && <Chip><Stamp className="size-3" />Issuer · {commas(s?.issued)} assets</Chip>}
        {(s?.dispensers ?? 0) > 0 && <Chip><Store className="size-3" />Dispenser operator{(s?.open_dispensers ?? 0) > 0 ? ` · ${s?.open_dispensers} open` : ""}</Chip>}
        {(s?.open_orders ?? 0) > 0 && <Chip><ArrowLeftRight className="size-3" />Active trader · {s?.open_orders} open</Chip>}
        {xcp >= 50000 && <Chip><Coins className="size-3 text-[--color-xcp]" />XCP whale</Chip>}
        {!s?.issued && !s?.dispensers && (s?.assets ?? 0) > 0 && <Chip><Wallet className="size-3" />Holder</Chip>}
      </div>
      {s?.first_block != null && (
        <div className="text-xs text-zinc-500 mt-2">
          First active <Link href={`/block/${s.first_block}`}>block {commas(s.first_block)}</Link>
          {" · "}last active <Link href={`/block/${s.last_block}`}>block {commas(s.last_block)}</Link>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <Stat label="XCP balance" value={commas(s?.xcp)} icon={<Coins className="size-3" />} />
        <Stat label="Assets held" value={commas(s?.assets)} icon={<Wallet className="size-3" />} />
        <Stat label="Assets issued" value={commas(s?.issued)} icon={<Stamp className="size-3" />} />
        <Stat label="Dispensers" value={commas(s?.dispensers)} icon={<Store className="size-3" />} />
      </div>
    </Card>
  );
}

export default async function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const summary = await loadSummary(address);

  return (
    <>
      <AddressHeader address={address} s={summary} />
      <ReputationHeader address={address} />
      <AddressLineage address={address} />
      <Holdings address={address} />
      <AddressConnections address={address} />
      <AddressTabs address={address} />
    </>
  );
}
