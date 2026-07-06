import Link from "next/link";

// 404 — a real not-found page (asset/tx/block that isn't in the mirror) instead of a soft-404.
export default function NotFound() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-16 text-center">
      <div className="text-4xl font-semibold text-zinc-100">404</div>
      <p className="mt-2 text-sm text-zinc-500">That asset, address, block, or transaction isn’t here.</p>
      <Link href="/" className="mt-5 inline-block rounded border border-zinc-700 px-3 py-1.5 text-sm !text-zinc-300 !no-underline hover:bg-zinc-900">
        ← Back to the explorer
      </Link>
    </section>
  );
}
