import type { D1Database } from "@cloudflare/workers-types";
import { hashToBytes } from "#api/indexer/identities";

export interface BitcoinFeeCandidate {
  tx_index: number;
  tx_hash: string;
}

export interface BitcoinFeeRow {
  tx_hash: string;
  fee: number;
}

const TX_HASH = /^[0-9a-f]{64}$/;

export async function listMissingBitcoinFees(
  db: D1Database,
  after: number | null,
  limit: number,
): Promise<BitcoinFeeCandidate[]> {
  const result = await db
    .prepare(
      `SELECT tx_index,LOWER(HEX(tx_hash)) tx_hash
       FROM transactions
       WHERE bitcoin_fee IS NULL AND (? IS NULL OR tx_index<?)
       ORDER BY tx_index DESC LIMIT ?`,
    )
    .bind(after, after, limit)
    .all<BitcoinFeeCandidate>();
  return result.results;
}

export function validBitcoinFeeRows(value: unknown): BitcoinFeeRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const rows: BitcoinFeeRow[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.tx_hash !== "string" || !TX_HASH.test(row.tx_hash.toLowerCase())) return null;
    if (!Number.isSafeInteger(row.fee) || Number(row.fee) < 0) return null;
    rows.push({ tx_hash: row.tx_hash.toLowerCase(), fee: Number(row.fee) });
  }
  return rows;
}

export async function storeBitcoinFees(db: D1Database, rows: BitcoinFeeRow[]): Promise<number> {
  const results = await db.batch(
    rows.map((row) =>
      db
        .prepare(`UPDATE transactions SET bitcoin_fee=? WHERE tx_hash=? AND bitcoin_fee IS NULL`)
        .bind(String(row.fee), hashToBytes(row.tx_hash)),
    ),
  );
  return results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
}
