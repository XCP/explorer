export async function runBootstrapPipeline({
  concurrency,
  exportPage,
  importPage,
  logPage,
  maxPages = 0,
  startCursor,
}) {
  let cursor = startCursor;
  let submitted = 0;
  const pending = [];

  const settleOldest = async () => {
    const entry = pending.shift();
    if (!entry) return;
    const outcome = await entry.outcome;
    if (!outcome.ok) throw outcome.error;
    logPage({ page: entry.page, cursor: entry.cursor, source: entry.source, result: outcome.result });
  };

  while (!maxPages || submitted < maxPages) {
    const pageCursor = cursor;
    const source = await exportPage(pageCursor);
    const pageNumber = ++submitted;
    const outcome = importPage(pageCursor, source).then(
      (result) => ({ ok: true, result }),
      (error) => ({ ok: false, error }),
    );
    pending.push({ page: pageNumber, cursor: pageCursor, source, outcome });

    if (pending.length >= concurrency) await settleOldest();
    if (source.next_id == null) break;
    cursor = source.next_id;
  }

  while (pending.length) await settleOldest();
  return { pages: submitted };
}
