import type { Metadata } from "next";
import { AddressTabs } from "@/features/addresses/components/address-tabs";
import { AddressHeader } from "@/features/addresses/components/address-header";
import { Holdings } from "@/features/addresses/components/holdings";
import { AddressConnections, AddressLineage } from "@/features/addresses/components/relationships";
import { ReputationHeader } from "@/features/addresses/components/reputation";
import { PendingActions } from "@/components/pending-actions";
import { short } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const title = `Address ${short(address)}`;
  const description = `Counterparty holdings, activity, and reputation for address ${address}.`;
  return { title, description, openGraph: { title: `${title} | XCP.io`, description } };
}

export default async function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
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
      <AddressHeader address={address} />
      <AddressTabs address={address} inBand overview={overview} />
    </>
  );
}
