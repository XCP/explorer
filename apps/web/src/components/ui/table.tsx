// Dense data table primitives — the xcpdex recipe (sticky header, hover rows, mono numerics
// handled per-cell). Row + Cell carry the hover/divider + numeric/mono conventions so pages stay terse.
import type { ReactNode } from "react";

export type Head = string | { label: string; numeric?: boolean; hide?: string };
export function Table({ head, children }: { head: Head[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="sticky top-0 bg-zinc-950 z-10">
          <tr className="text-zinc-400 border-b border-zinc-800">
            {head.map((h) => {
              const label = typeof h === "string" ? h : h.label;
              const numeric = typeof h === "object" && h.numeric;
              const hide = typeof h === "object" ? h.hide : undefined;
              return <th key={label} className={`font-normal px-3 py-2 ${numeric ? "text-right" : "text-left"} ${hide ?? ""}`}>{label}</th>;
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Row = ({ children }: { children: ReactNode }) => (
  <tr className="border-b border-zinc-900 hover:bg-zinc-900 transition-colors">{children}</tr>
);
export const Cell = ({ children, numeric, muted, primary, hide }: { children: ReactNode; numeric?: boolean; muted?: boolean; primary?: boolean; hide?: string }) => (
  <td className={[
    "px-3 py-2",
    numeric ? "text-right font-mono tabular-nums" : "",
    muted ? "text-zinc-400" : numeric ? "text-zinc-300" : "",
    primary ? "text-zinc-100 font-medium" : "",
    hide ?? "",
  ].filter(Boolean).join(" ")}>{children}</td>
);
