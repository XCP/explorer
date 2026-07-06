import { Table, Row, Cell } from "@/components/ui";
import { HIDE, type Col } from "@/lib/columns";

// Single source of truth for rendering a record list. One responsive table: dense on desktop, and on
// narrow screens LOW-PRIORITY columns drop out (`hideBelow`) so the identity + key metric stay scannable;
// anything still too wide falls back to horizontal scroll (the Table wrapper is overflow-x-auto). Used by the
// index pages, the detail-page tabs, and the block page so the responsive logic lives in exactly one place.
export function RecordTable<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  // suffix with row index: the same tx_hash can legitimately appear in two rows (order matches, a dispense
  // where the address is both source and destination), so id-alone keys can collide — index guarantees uniqueness.
  const key = (r: T, i: number) => {
    const k = r as Partial<Record<"tx_hash" | "id" | "event_index" | "block_index", string | number>>;
    return `${k.tx_hash ?? k.id ?? k.event_index ?? k.block_index ?? "row"}-${i}`;
  };
  const hide = (c: Col<T>) => (c.hideBelow ? HIDE[c.hideBelow] : undefined);
  return (
    <Table head={cols.map((c) => ({ label: c.label, numeric: c.numeric, hide: hide(c) }))}>
      {rows.map((r, i) => (
        <Row key={key(r, i)}>
          {cols.map((c, ci) => (
            <Cell key={ci} numeric={c.numeric} primary={c.weight === "primary"} muted={c.weight === "muted"} hide={hide(c)}>
              {c.cell(r)}
            </Cell>
          ))}
        </Row>
      ))}
    </Table>
  );
}
