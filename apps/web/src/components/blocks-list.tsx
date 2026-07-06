"use client";
import { useState } from "react";
import type { BlockRow } from "@xcp/shared/chain";
import { useBlocks } from "@/lib/hooks";
import { type Col, blockCell, timeCell, mono } from "@/lib/cells";
import { commas, short } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { AsyncContent } from "@/components/ui/async-content";
import { RecordTable } from "@/components/record-table";

const PAGE = 25;

const BLOCK_COLS: Col<BlockRow>[] = [
  { label: "Block", numeric: true, cell: (r) => blockCell(r.block_index) },
  { label: "Time", cell: (r) => timeCell(r.block_time ?? undefined) },
  { label: "Txs", numeric: true, cell: (r) => commas(r.transaction_count ?? 0) },
  { label: "Hash", hideBelow: "sm", cell: (r) => mono(short(r.block_hash)) },
];

export function BlocksList() {
  const [offset, setOffset] = useState(0);
  const { rows, nextOffset, error, isLoading } = useBlocks(offset, PAGE);

  return (
    <Card title="Blocks">
      <AsyncContent isLoading={isLoading} error={error} empty={rows.length === 0} emptyWhat="blocks">
        <RecordTable cols={BLOCK_COLS} rows={rows} />
        <div className="flex gap-2 mt-4">
          <SecondaryButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</SecondaryButton>
          <SecondaryButton disabled={nextOffset == null} onClick={() => setOffset(nextOffset!)}>Next</SecondaryButton>
        </div>
      </AsyncContent>
    </Card>
  );
}
