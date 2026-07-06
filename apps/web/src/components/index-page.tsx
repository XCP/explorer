"use client";
import { useState } from "react";
import type { RecordKind, RecordRowMap } from "@xcp/shared/records";
import { useIndex } from "@/lib/hooks";
import { REGISTRY } from "@/lib/registry";
import { Card } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";

// Generic explorer index page — config-driven (see lib/registry.tsx). Offset Prev/Next pagination.
const PAGE = 50;
export function IndexPage<K extends RecordKind>({ name }: { name: K }) {
  const def = REGISTRY[name]!;
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useIndex<RecordRowMap[K]>(name, offset, PAGE);

  return (
    <Card title={def.title}>
      <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat={def.title.toLowerCase()}>
        <RecordTable cols={def.cols} rows={rows} />
        <div className="flex gap-2 mt-4">
          <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</SecondaryButton>
          <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
        </div>
      </AsyncContent>
    </Card>
  );
}
