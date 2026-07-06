// Async/empty states — bare loading text, skeleton loader, error box, empty message.
export const Loading = () => <div className="text-zinc-500 text-sm py-6">Loading…</div>;

export const Skeleton = ({ rows = 8 }: { rows?: number }) => (
  <div className="space-y-2 py-2">
    {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-6 rounded bg-zinc-900 animate-pulse" />)}
  </div>
);
export const ErrorBox = ({ error }: { error: unknown }) =>
  <div className="text-red-400 text-sm py-6">Error: {String((error as Error)?.message ?? error)}</div>;
export const Empty = ({ what = "results" }: { what?: string }) =>
  <div className="text-zinc-500 text-sm py-6">No {what}.</div>;
