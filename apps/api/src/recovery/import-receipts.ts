export interface ImportReceipt {
  page_cursor: number;
  next_cursor: number | null;
}

export interface ImportFrontier {
  cursor: number;
  complete: boolean;
}

/** Follow only the contiguous receipt chain; buffered future pages cannot skip a gap. */
export function advanceImportFrontier(startCursor: number, receipts: ImportReceipt[]): ImportFrontier {
  const byCursor = new Map(receipts.map((receipt) => [receipt.page_cursor, receipt.next_cursor]));
  const visited = new Set<number>();
  let cursor = startCursor;
  while (byCursor.has(cursor)) {
    if (visited.has(cursor)) throw new Error("recovery import receipt cycle");
    visited.add(cursor);
    const next = byCursor.get(cursor);
    if (next == null) return { cursor, complete: true };
    if (next <= cursor) throw new Error("recovery import receipt did not advance");
    cursor = next;
  }
  return { cursor, complete: false };
}
