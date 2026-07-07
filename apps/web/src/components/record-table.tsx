import type { CSSProperties } from "react";
import type { Col, RecordContext } from "@/lib/cells";

// Single source of truth for rendering a record list, on the v19 .xtable grid (see globals.css).
// One responsive table: each column carries a `priority` (1 = always visible; 4 drops first) and the
// grid template for every breakpoint travels as custom properties (--xtc*), so narrow screens drop
// LOW-priority columns while the payload + Time anchor stay scannable (v19-style column dropping).
// `context` is the page subject: columns marked omitOn are suppressed when the page already answers
// them (R4), and cells receive the context for perspective signing. Used by the index pages, the
// detail-page tabs, and the block page so the responsive logic lives in exactly one place.
export function RecordTable<T>({ cols, rows, context = {} }: { cols: Col<T>[]; rows: T[]; context?: RecordContext }) {
  // suffix with row index: the same tx_hash can legitimately appear in two rows (order matches, a dispense
  // where the address is both source and destination), so id-alone keys can collide — index guarantees uniqueness.
  const key = (r: T, i: number) => {
    const k = r as Partial<Record<"tx_hash" | "id" | "event_index" | "block_index", string | number>>;
    return `${k.tx_hash ?? k.id ?? k.event_index ?? k.block_index ?? "row"}-${i}`;
  };
  const visible = cols.filter((c) => !(c.omitOn && context[c.omitOn] != null));
  const prio = (c: Col<T>) => c.priority ?? 2;
  const track = (c: Col<T>) => c.w ?? (c.numeric ? "120px" : "minmax(0,1fr)");
  const template = (maxPriority: number) =>
    visible.filter((c) => prio(c) <= maxPriority).map(track).join(" ");
  const style = {
    "--xtc": template(4), "--xtc-4": template(3), "--xtc-3": template(2), "--xtc-2": template(1),
  } as CSSProperties;
  const prioClass = (c: Col<T>) => (prio(c) >= 4 ? "xt-p4" : prio(c) === 3 ? "xt-p3" : prio(c) === 2 ? "xt-p2" : "");
  const cellClass = (c: Col<T>, head = false) => [
    prioClass(c),
    c.numeric ? (head ? "r" : "xt-price") : "",
    !head && c.weight === "muted" ? "text-zinc-400" : "",
  ].filter(Boolean).join(" ") || undefined;

  return (
    <div className="xtable" data-cols={visible.length} style={style} role="table">
      <div className="xt-row xt-head" role="row">
        {visible.map((c) => (
          <span key={c.label} role="columnheader" className={cellClass(c, true)}>
            {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={key(r, i)} className="xt-row" role="row">
          {visible.map((c, ci) => (
            <span key={ci} role="cell" className={cellClass(c)}>{c.cell(r, context, i)}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
