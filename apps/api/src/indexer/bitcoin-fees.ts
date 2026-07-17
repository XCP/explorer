import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "#api/env";
import { fetchTransactionFee } from "#api/integrations/electrs";
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
const FEE_PAGE_SIZE = 100;
// Cloudflare permits six simultaneous outgoing connections per invocation. Matching that limit explicitly avoids
// relying on the runtime's connection queue. A 2026-07-16 production-provider sample completed 60/60 requests at
// ~69 requests/second with this concurrency, so 1,000 candidates is a conservative fraction of the paid Worker's
// 10,000-subrequest and 15-minute scheduled-invocation limits while materially shortening the finite backfill.
export const FEE_FETCH_CONCURRENCY = 6;
export const FEES_PER_RUN = 1_000;

export async function listMissingBitcoinFees(
  db: D1Database,
  after: number | null,
  limit: number,
): Promise<BitcoinFeeCandidate[]> {
  const result = await db
    .prepare(
      `SELECT tx_index,LOWER(HEX(tx_hash)) tx_hash FROM transactions
       WHERE fee IS NULL AND (? IS NULL OR tx_index<?)
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
        .prepare(`UPDATE transactions SET fee=? WHERE tx_hash=? AND fee IS NULL RETURNING tx_index`)
        .bind(String(row.fee), hashToBytes(row.tx_hash)),
    ),
  );
  // D1 meta.changes includes writes performed by fee-maintenance triggers. RETURNING counts only transactions.
  return results.reduce((sum, result) => sum + (result.results?.length ?? 0), 0);
}

/** Keep the staging frontier current while the one-time historical exporter walks backward. */
export async function reconcileStagedBitcoinFees(
  env: Pick<Env, "CORE_DB" | "ELECTRS_API_BASE">,
  limit = FEES_PER_RUN,
): Promise<{ requested: number; updated: number }> {
  const boundedLimit = Math.min(FEES_PER_RUN, Math.max(1, Math.trunc(limit)));
  let requested = 0;
  let updated = 0;
  let after: number | null = null;
  while (requested < boundedLimit) {
    const pageSize = Math.min(FEE_PAGE_SIZE, boundedLimit - requested);
    const rows = await listMissingBitcoinFees(env.CORE_DB, after, pageSize);
    if (rows.length === 0) break;
    requested += rows.length;
    after = rows.at(-1)!.tx_index;

    const fees: BitcoinFeeRow[] = [];
    for (let offset = 0; offset < rows.length; offset += FEE_FETCH_CONCURRENCY) {
      const settled = await Promise.allSettled(
        rows.slice(offset, offset + FEE_FETCH_CONCURRENCY).map(async (row) => ({
          tx_hash: row.tx_hash,
          fee: await fetchTransactionFee(env.ELECTRS_API_BASE, row.tx_hash),
        })),
      );
      fees.push(
        ...settled.flatMap((result) =>
          result.status === "fulfilled" && result.value.fee !== null
            ? [{ tx_hash: result.value.tx_hash, fee: result.value.fee }]
            : [],
        ),
      );
    }
    if (fees.length > 0) updated += await storeBitcoinFees(env.CORE_DB, fees);
    if (rows.length < pageSize) break;
  }
  return { requested, updated };
}
