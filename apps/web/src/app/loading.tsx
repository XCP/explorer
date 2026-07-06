import { Skeleton } from "@/components/ui/feedback";

// Route-level loading fallback (shown while a server component streams). Uses the same Skeleton the
// fetch-backed panels use, wrapped in the standard Card frame so the layout doesn't jump.
export default function Loading() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <Skeleton rows={8} />
    </div>
  );
}
