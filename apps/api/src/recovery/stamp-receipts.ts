export interface StampImportReceipt {
  page_cursor: number;
  next_cursor: number;
  snapshot_sha256: string;
}

export function completeStampReceiptChain(
  receipts: StampImportReceipt[],
  finalPageCursor: number,
  finalNextCursor: number,
  snapshotSha256: string,
): boolean {
  if (receipts.length === 0) return false;
  let expectedCursor = -1;
  for (const receipt of receipts) {
    if (
      receipt.page_cursor !== expectedCursor ||
      receipt.next_cursor <= receipt.page_cursor ||
      receipt.snapshot_sha256 !== snapshotSha256
    )
      return false;
    expectedCursor = receipt.next_cursor;
  }
  const finalReceipt = receipts.at(-1)!;
  return finalReceipt.page_cursor === finalPageCursor && finalReceipt.next_cursor === finalNextCursor;
}
