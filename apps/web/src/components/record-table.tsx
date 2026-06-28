import { Table, Row, Cell } from "@/components/ui";
import type { Col } from "@/lib/indexes";

// Single source of truth for rendering a record list: dense table on desktop, stacked cards on mobile
// (first column is the card title; the rest become label/value rows). Used by the index pages, the
// detail-page tabs, and the block page so the responsive logic lives in exactly one place.
export function RecordTable({ cols, rows }: { cols: Col[]; rows: any[] }) {
  // suffix with row index: the same tx_hash can legitimately appear in two rows (order matches, a dispense
  // where the address is both source and destination), so id-alone keys can collide — index guarantees uniqueness.
  const key = (r: any, i: number) => `${r.tx_hash ?? r.id ?? r.event_index ?? r.block_index ?? "row"}-${i}`;
  // mobile card title = most identifying column (asset/tx/holder), not Block/Time which repeat across rows
  const tIdx = Math.max(0, cols.findIndex((c) => !c.numeric && c.label !== "Block" && c.label !== "Time"));
  return (
    <>
      <div className="hidden sm:block">
        <Table head={cols.map((c) => ({ label: c.label, numeric: c.numeric }))}>
          {rows.map((r, i) => (
            <Row key={key(r, i)}>{cols.map((c, ci) => <Cell key={ci} numeric={c.numeric}>{c.cell(r)}</Cell>)}</Row>
          ))}
        </Table>
      </div>
      <div className="sm:hidden divide-y divide-zinc-800">
        {rows.map((r, i) => (
          <div key={key(r, i)} className="py-3">
            <div className="font-medium text-zinc-100 mb-1.5">{cols[tIdx].cell(r)}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {cols.map((c, ci) => ci === tIdx ? null : (
                <div key={ci} className="flex justify-between gap-2 text-xs">
                  <span className="text-zinc-500 shrink-0">{c.label}</span>
                  <span className={`truncate ${c.numeric ? "font-mono text-zinc-300" : "text-zinc-300"}`}>{c.cell(r)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
