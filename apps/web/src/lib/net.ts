/**
 * The rule a Cloudflare Worker has to follow when it abandons a response.
 *
 * A Worker may hold only six outbound connections open at once. A `Response`
 * whose body is never read and never cancelled keeps its slot until garbage
 * collection, which may be long after the render that made it finished. Do that
 * on an error path — `if (!res.ok) throw` is the usual shape — and a struggling
 * upstream turns every failed read into a leaked slot. Past six, the runtime
 * cancels the oldest in-flight response to avoid deadlock and logs "A stalled
 * HTTP response was canceled to prevent deadlock". The cancelled response
 * belongs to some other, innocent request, so the symptom never points at the
 * code that caused it.
 *
 * `apps/api/src/integrations/electrs.ts` has always done this correctly; this
 * is the same move, available to the web app and to the integrations that did
 * not.
 */

/**
 * Let go of a response we are not going to read.
 *
 * Call it on every path that abandons a `Response` — before a `throw`, before
 * `return null`, before falling through to a second attempt. Cancelling is
 * cheap and releases the connection immediately, where dropping the reference
 * releases it whenever the collector next runs.
 *
 * Never throws: this is cleanup on a path that already failed, and a failure to
 * cancel must not replace the error the caller is actually reporting.
 */
export async function discard(response: Response | null | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // Already cancelled, already consumed, or never had a body. Nothing owed.
  }
}

/**
 * `Promise.all(items.map(fn))` with a ceiling on how many run at once.
 *
 * Results keep the order of `items`. `limit` defaults to five, matching the
 * waves the Electrs client already uses, and deliberately below the platform's
 * six connections so a fan-out leaves room for the rest of the request.
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
