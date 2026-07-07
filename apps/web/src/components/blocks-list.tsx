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

// Block-first is correct here — blocks are the table's subject (R1's exception).
const BLOCK_COLS: Col<BlockRow>[] = [
  { label: "Block", numeric: true, priority: 1, w: "90px", cell: (r) => blockCell(r.block_index) },
  { label: "Txs", numeric: true, priority: 1, w: "70px", cell: (r) => commas(r.transaction_count ?? 0) },
  { label: "Hash", priority: 3, weight: "muted", cell: (r) => mono(short(r.block_hash)) },
  { label: "Time", numeric: true, priority: 1, w: "76px", cell: (r) => timeCell(r.block_time ?? undefined) },
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
