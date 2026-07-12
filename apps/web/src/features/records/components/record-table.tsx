import type { CSSProperties } from "react";
import type { Col, RecordContext, SortState } from "@/features/records/cells";

// Single source of truth for rendering a record list, on the v20 .rt/.tr grammar (globals.css —
// ported verbatim from design-lab/v20-tables.html, the owner-approved acceptance reference).
// The lab hardcodes one grid template per table; here each column carries its track (`w`, with
// optional `w760`/`w420` narrow variants) and a `priority` (1 = always visible; 2 drops at 420px;
// 3+ drops at 760px), so the generic engine reproduces v20's hand-tuned column dropping.
// `context` is the page subject: columns marked omitOn are suppressed when the page already
// answers them (R4), and cells receive the context for perspective signing.
// `sort`/`onSort`: when a column carries a sortKey and onSort is set, its header becomes a
// tri-state sort button with aria-sort — the page owns what the sort MEANS (client comparator or
// server param). Everything else is unchanged.
export function RecordTable<T>({
  cols,
  rows,
  context = {},
  label = "records",
  sort,
  onSort,
}: {
  cols: Col<T>[];
  rows: T[];
  context?: RecordContext;
  label?: string;
  sort?: SortState;
  onSort?: (key: string) => void;
}) {
  // suffix with row index: the same tx_hash can legitimately appear in two rows (order matches, a
  // dispense where the address is both source and destination) — index guarantees uniqueness.
  const key = (r: T, i: number) => {
    const k = r as Partial<Record<"tx_hash" | "id" | "event_index" | "block_index", string | number>>;
    return `${k.tx_hash ?? k.id ?? k.event_index ?? k.block_index ?? "row"}-${i}`;
  };
  const visible = cols.filter((c) => !(c.omitOn && context[c.omitOn] != null));
  const prio = (c: Col<T>) => c.priority ?? 2;
  const track = (c: Col<T>, stage: 0 | 1 | 2) => {
    const base = c.w ?? (c.numeric ? "100px" : "minmax(0,1fr)");
    return stage === 0 ? base : stage === 1 ? (c.w760 ?? base) : (c.w420 ?? c.w760 ?? base);
  };
  const template = (maxPriority: number, stage: 0 | 1 | 2) =>
    visible
      .filter((c) => prio(c) <= maxPriority)
      .map((c) => track(c, stage))
      .join(" ");
  const style = {
    "--rtc": template(9, 0),
    "--rtc-3": template(2, 1),
    "--rtc-1": template(1, 2),
  } as CSSProperties;
  const dropClass = (c: Col<T>) => (prio(c) >= 3 ? "p3" : prio(c) === 2 ? "p2" : "");
  const cellClass = (c: Col<T>, head = false) =>
    [
      dropClass(c),
      head ? (c.numeric ? "r" : "") : (c.cellClass ?? (c.numeric ? "num" : "")),
      !head && c.weight === "muted" ? "dim" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const header = (c: Col<T>) => {
    const inner = c.srOnly ? <span className="sr-only">{c.label}</span> : c.label;
    if (c.sortKey && onSort) {
      const active = sort?.key === c.sortKey;
      const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
      return (
        <button type="button" className="th-sort" aria-sort={ariaSort} onClick={() => onSort(c.sortKey!)}>
          {inner}
          <span aria-hidden className={`th-arrow${active ? " on" : ""}`}>
            {active ? (sort!.dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      );
    }
    return inner;
  };

  return (
    <div className="rt" style={style} role="table" aria-label={label}>
      <div className="tr th" role="row">
        {visible.map((c) => (
          <span key={c.label} role="columnheader" className={cellClass(c, true)}>
            {header(c)}
          </span>
        ))}
      </div>
      {rows.length === 0 && <div className="rt-empty">No {label} yet</div>}
      {rows.map((r, i) => (
        <div key={key(r, i)} className="tr" role="row">
          {visible.map((c, ci) => (
            <span key={ci} role="cell" className={cellClass(c)}>
              {c.cell(r, context, i)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
