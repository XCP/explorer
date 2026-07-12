"use client";
import { useState } from "react";
import type { RecordKind, RecordRowMap } from "@xcp/shared/records";
import { useIndex, useStats } from "@/lib/hooks";
import { REGISTRY } from "@/features/records/registry";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/features/records/components/record-table";

// Generic explorer index page — config-driven (see lib/registry.tsx). Offset Prev/Next pagination.
// The dense v19 .xtable brings its own card chrome; the chain tip (same SWR key as the footer
// heartbeat, so deduped) feeds lifetime cells like the orders Expires column.
const PAGE = 50;
export function IndexPage<K extends RecordKind>({ name }: { name: K }) {
  const def = REGISTRY[name]!;
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useIndex<RecordRowMap[K]>(name, offset, PAGE);
  const tip = useStats().item?.tip;

  return (
    <div className="flex flex-col gap-3">
      <div className="pagehead"><h1>{def.title}</h1></div>
      <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat={def.title.toLowerCase()}>
        <RecordTable cols={def.cols} rows={rows} context={{ tip: tip ?? undefined, offset }} />
        <div className="flex gap-2 mt-1">
          <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</SecondaryButton>
          <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
        </div>
      </AsyncContent>
    </div>
  );
}
