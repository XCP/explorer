import { classifyStamp } from "#api/indexer/events/stamp";

export interface StampProtectionSource {
  txid: string;
  source_reference: string;
}

interface IssuanceCandidate {
  event_index: number;
  tx_hash: string;
  description: string | null;
}

export interface StampSourcePage {
  transactions: StampProtectionSource[];
  next_cursor: number | null;
  scanned: number;
}

/**
 * Scan issuance records, not asset tags. An asset can have many issuances and
 * only the exact issuance whose own description is a Stamp protects its Bitcoin
 * transaction. The event cursor makes this resumable and uses idx_iss_evidx.
 */
export async function stampProtectionSourcePage(
  db: D1Database,
  cursor: number,
  limit: number,
): Promise<StampSourcePage> {
  const result = await db
    .prepare(
      `SELECT event_index,tx_hash,description
         FROM issuances
        WHERE event_index>? AND status='valid'
        ORDER BY event_index
        LIMIT ?`,
    )
    .bind(cursor, limit)
    .all<IssuanceCandidate>();
  const rows = result.results;
  const transactions = rows.flatMap((row) =>
    classifyStamp(row.description)
      ? [{ txid: row.tx_hash.toLowerCase(), source_reference: `issuance:${row.event_index}` }]
      : [],
  );

  return {
    transactions,
    next_cursor: rows.length === limit ? Number(rows.at(-1)!.event_index) : null,
    scanned: rows.length,
  };
}
