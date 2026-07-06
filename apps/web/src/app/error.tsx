"use client";

// Route error boundary — a failed server fetch (or render) lands here with a retry, instead of the
// bare error string it used to show. Must be a client component (Next requirement) for reset().
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="rounded-xl border border-red-500/20 bg-red-500/[0.04] px-5 py-16 text-center">
      <h1 className="text-lg font-semibold text-zinc-100">Something went wrong</h1>
      <p className="mt-2 text-sm text-red-400/90">{error.message}</p>
      <button
        onClick={reset}
        className="mt-5 inline-block rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
      >
        Try again
      </button>
    </section>
  );
}
