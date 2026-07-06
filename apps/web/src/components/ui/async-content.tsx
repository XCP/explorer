import type { ReactNode } from "react";
import { Loading, ErrorBox, Empty } from "@/components/ui/feedback";

// The loading → error → empty → content ladder every fetch-backed panel repeats. Renders the first
// state that applies; falls through to children when the data is present. `emptyWhat` is the noun the
// Empty message uses ("No trades."). Same order/visuals as the hand-written ternary chains it replaces.
export function AsyncContent({
  isLoading, error, empty, emptyWhat, children,
}: { isLoading?: boolean; error?: unknown; empty?: boolean; emptyWhat?: string; children: ReactNode }) {
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (empty) return <Empty what={emptyWhat} />;
  return <>{children}</>;
}
