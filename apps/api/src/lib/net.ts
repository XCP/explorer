/**
 * Bounded fan-out for the API Worker.
 *
 * A Worker's outbound connections and its R2 operations are both finite and
 * both shared by everything running in the invocation. `Promise.all` over a
 * data-driven list ignores that: it asks for one operation per element at once,
 * however long the list is. Against R2 that returns "Reduce your concurrent
 * request rate for the same object (10058)"; against fetch it exhausts the six
 * connection slots and the runtime starts cancelling responses to avoid
 * deadlock, logging "A stalled HTTP response was canceled to prevent deadlock"
 * against whichever request happened to be oldest.
 *
 * `integrations/electrs.ts` already works in waves for the same reason. This is
 * that idea as a helper, for the paths that were still unbounded.
 */

/**
 * `Promise.all(items.map(fn))` with a ceiling on how many run at once.
 *
 * Results keep the order of `items`. `limit` defaults to five, matching the
 * Electrs client's wave size.
 *
 * A rejection propagates, as it would from `Promise.all` — this bounds
 * concurrency, it does not change error handling.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = 5,
): Promise<R[]> {
  if (items.length === 0) return [];
  const ceiling = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  // Each worker pulls the next index until the list is exhausted, so a slow
  // element delays only itself. Fixed chunks would make every chunk wait for
  // its slowest member.
  const workers = Array.from({ length: ceiling }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Let go of a response we are not going to read, so its connection slot is
 * released now rather than whenever the collector next runs. Never throws:
 * cleanup on a failed path must not replace the error being reported.
 */
export async function discard(response: Response | null | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // Already cancelled, already consumed, or never had a body. Nothing owed.
  }
}
