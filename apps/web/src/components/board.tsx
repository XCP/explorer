import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";

// A ranked list panel — numbered rows in a titled Card, with a skeleton until rows arrive. The
// leaderboard/vault/exchange "top N" boards all render this shape; `render` draws one row's content.
export function Board<T>({ title, rows, render }: { title: string; rows: T[]; render: (r: T) => ReactNode }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Skeleton rows={6} />
      ) : (
        <ol className="text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-3 py-1.5 border-b border-zinc-900 last:border-0">
              <span className="w-5 shrink-0 text-right text-zinc-500 font-mono text-xs">{i + 1}</span>
              {render(r)}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
