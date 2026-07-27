"use client";

import Link from "next/link";
import useSWR from "swr";
import type { AddressSummary } from "@xcp/shared/addresses";
import type { Envelope } from "@xcp/shared/envelope";
import { apiUrl } from "@/lib/api/url";
import {
  SectionHeader,
  SectionIdentity,
  SectionStats,
  SectionChip,
  type SectionStat,
} from "@/components/section-header";
import { CopyButton } from "@/components/copy-button";
import { ReputationStat } from "@/features/addresses/components/reputation-stat";
import { commas } from "@/lib/format";

const BURN_ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const Chip = ({ children }: { children: React.ReactNode }) => <SectionChip>{children}</SectionChip>;

function AddressGradient({ address }: { address: string }) {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  const hues = [h % 360, (h >> 7) % 360, (h >> 14) % 360];
  return (
    <div
      aria-hidden
      className="size-[52px] shrink-0 rounded-lg border border-zinc-800"
      style={{
        background: `linear-gradient(135deg, hsl(${hues[0]} 55% 38%) 0%, hsl(${hues[1]} 50% 30%) 60%, hsl(${hues[2]} 45% 24%) 100%)`,
      }}
    />
  );
}

/** Identity renders immediately; optional counts hydrate without participating in the RSC stream. */
export function AddressHeader({ address }: { address: string }) {
  const { data } = useSWR<Envelope<AddressSummary | null>>(
    apiUrl(`/v2/addresses/${encodeURIComponent(address)}/summary`),
  );
  const s = data?.result ?? null;
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
        chips={
          <>
            {address === BURN_ADDRESS && <Chip>Burn address</Chip>}
            {(s?.issued ?? 0) > 0 && <Chip>Issuer · {commas(s?.issued)} assets</Chip>}
            {(s?.dispensers ?? 0) > 0 && (
              <Chip>Dispenser operator{(s?.open_dispensers ?? 0) > 0 ? ` · ${s?.open_dispensers} open` : ""}</Chip>
            )}
            {(s?.open_orders ?? 0) > 0 && <Chip>Active trader · {s?.open_orders} open</Chip>}
            {xcp >= 50000 && <Chip>XCP whale</Chip>}
            {!s?.issued && !s?.dispensers && (s?.assets ?? 0) > 0 && <Chip>Holder</Chip>}
          </>
        }
        actions={<CopyButton value={address} />}
      />
      <SectionStats stats={stats} />
    </SectionHeader>
  );
}
