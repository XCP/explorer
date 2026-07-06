"use client";
import { use, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Coins, Store, ArrowLeftRight, Flame, Wallet, Stamp } from "lucide-react";
import type { AddressSummary } from "@xcp/shared/addresses";
import { Card, Stat } from "@/components/ui/card";
import { apiUrl, type Envelope } from "@/lib/api";
import { DetailTabs, type TabDef } from "@/components/detail-tabs";
import { Holdings } from "@/components/holdings";
import { AddressConnections, AddressLineage } from "@/components/relationships";
import { ReputationHeader } from "@/components/reputation";
import { blockCell, txCell, addrCell, assetCell } from "@/lib/cells";
import { ASSET_LIST_COLS, DISPENSER_COLS } from "@/lib/registry";
import { commas } from "@/lib/format";

const BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const Chip = ({ children }: { children: React.ReactNode }) =>
  <span className="inline-flex items-center gap-1 rounded-md bg-zinc-800 text-zinc-200 px-2 py-1 text-xs font-medium ring-1 ring-inset ring-white/5">{children}</span>;

// Identity-first header: who is this address (archetype chips) + how old/active, then balances.
// Answers the non-owner's "can I trust this?" and the owner's "this is me / OG status" at a glance.
function AddressHeader({ address }: { address: string }) {
  const { data } = useSWR<Envelope<AddressSummary>>(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/summary`));
  const s = data?.result;
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  const xcp = Number(s?.xcp) || 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm break-all text-zinc-100">{address}</span>
        <button onClick={copy} className="shrink-0 text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-700 rounded px-1.5 py-0.5">{copied ? "copied ✓" : "copy"}</button>
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

export default function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const base = `/v2/addresses/${encodeURIComponent(address)}`;

  const tabs: TabDef[] = [
    { label: "Sends", path: `${base}/sends`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Asset", cell: (r) => assetCell(r.asset) },
      { label: "Direction", cell: (r) => r.source === address ? <span className="text-red-400">out</span> : <span className="text-green-400">in</span> },
      { label: "Counterparty", cell: (r) => addrCell(r.source === address ? r.destination : r.source) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Issuances", path: `${base}/issuances`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Asset", cell: (r) => assetCell(r.asset) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.quantity_normalized) },
      { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Dispensers", path: `${base}/dispensers`, cols: DISPENSER_COLS },
    { label: "Dispenses", path: `${base}/dispenses`, cols: [
      { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
      { label: "Asset", cell: (r) => assetCell(r.asset) },
      { label: "Quantity", numeric: true, cell: (r) => commas(r.dispense_quantity_normalized) },
      { label: "Counterparty", cell: (r) => addrCell(r.source === address ? r.destination : r.source) },
      { label: "Tx", cell: (r) => txCell(r.tx_hash) },
    ]},
    { label: "Issued", path: `${base}/issued`, cols: ASSET_LIST_COLS },
  ];

  return (
    <>
      <AddressHeader address={address} />
      <ReputationHeader address={address} />
      <AddressLineage address={address} />
      <Holdings address={address} />
      <AddressConnections address={address} />
      <DetailTabs tabs={tabs} />
    </>
  );
}
