"use client";
import { useState } from "react";
import { useIndex, type IndexName } from "@/lib/hooks";
import { INDEXES } from "@/lib/indexes";
import { Card, Loading, ErrorBox, Empty, SecondaryButton } from "@/components/ui";
import { RecordTable } from "@/components/record-table";

// Generic explorer index page — config-driven (see lib/indexes.tsx). Offset Prev/Next pagination.
const PAGE = 50;
export function IndexPage({ name }: { name: IndexName }) {
  const def = INDEXES[name]!;
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useIndex(name, offset, PAGE);

  return (
    <Card title={def.title}>
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : rows.length === 0 ? <Empty what={def.title.toLowerCase()} /> : (
        <>
          <RecordTable cols={def.cols} rows={rows} />
          <div className="flex gap-2 mt-4">
            <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</SecondaryButton>
            <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
          </div>
        </>
      )}
    </Card>
  );
}
