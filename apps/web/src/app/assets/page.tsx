"use client";
import Link from "next/link";
import { useState } from "react";
import { useAssets } from "@/lib/hooks";
import { Card, Table, Row, Cell, Skeleton, ErrorBox, Empty, AssetIcon, LockBadge, SecondaryButton } from "@/components/ui";
import { commas } from "@/lib/format";

export default function AssetsPage() {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useAssets(query || undefined, offset);

  return (
    <Card title="Assets">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOffset(0); }}
        placeholder="Filter assets…"
        className="mb-4 w-full max-w-sm rounded bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-[--color-xcp]"
      />
      {isLoading ? <Skeleton /> : error ? <ErrorBox error={error} /> : rows.length === 0 ? <Empty what="assets" /> : (
        <>
          <Table head={["Asset", "Description", { label: "Supply", numeric: true }, "Issuer", "Lock"]}>
            {rows.map((a: any) => (
              <Row key={a.asset}>
                <Cell primary>
                  <Link href={`/asset/${a.asset}`} className="flex items-center gap-2">
                    <AssetIcon asset={a.asset} />
                    <span>{a.asset_longname || a.asset}</span>
                  </Link>
                </Cell>
                <Cell muted><span className="block max-w-xs truncate">{a.description || ""}</span></Cell>
                <Cell numeric>{commas(a.supply_normalized)}</Cell>
                <Cell muted><Link href={`/address/${a.issuer}`} className="font-mono">{a.issuer}</Link></Cell>
                <Cell>{a.locked ? <LockBadge locked /> : <LockBadge />}</Cell>
              </Row>
            ))}
          </Table>
          <div className="flex gap-2 mt-4">
            <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Prev</SecondaryButton>
            <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
          </div>
        </>
      )}
    </Card>
  );
}
