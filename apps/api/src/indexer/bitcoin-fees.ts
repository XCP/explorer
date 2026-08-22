import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "#api/env";
import {
  ELECTRS_REQUEST_BATCH_INTERVAL_MS,
  ELECTRS_REQUEST_BATCH_SIZE,
  fetchTransactionFee,
} from "#api/integrations/electrs";
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
/**
 * Electrs replenishes roughly four requests a second and answers bursts with 429s, so fees are fetched
 * at the provider's smoothed budget (see integrations/electrs.ts). 300 candidates is ~100 seconds of
 * wall clock per two-minute tick; the 2026-07-16 figure of 1,000 predates the provider's tighter limit.
 */
export const FEE_FETCH_CONCURRENCY = ELECTRS_REQUEST_BATCH_SIZE;
export const FEES_PER_RUN = 300;
/** New transactions since the last run are fetched first so the tip never waits behind the historical walk. */
export const FEE_TIP_PAGE_SIZE = FEE_PAGE_SIZE;
/**
 * Some 2019–2021 P2SH-segwit transactions carry a witness hash as their Counterparty tx_hash, so no
 * Bitcoin index can ever serve them by hash. Without a persisted cursor the walk restarted at the top
 * every tick, spent its whole budget on those same rows, and never reached the million older rows
 * Electrs can serve. The cursor makes each unresolvable row cost one request per full cycle instead.
 */
export const FEE_WALK_CURSOR_KEY = "bitcoin_fees_walk_cursor";
export const FEE_TIP_WATERMARK_KEY = "bitcoin_fees_tip_watermark";

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

async function listMissingBitcoinFeesAbove(
  db: D1Database,
  above: number,
  limit: number,
): Promise<BitcoinFeeCandidate[]> {
  const result = await db
    .prepare(
      `SELECT tx_index,LOWER(HEX(tx_hash)) tx_hash FROM transactions
       WHERE fee IS NULL AND tx_index>? ORDER BY tx_index DESC LIMIT ?`,
    )
    .bind(above, limit)
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

async function readCursor(db: D1Database, key: string): Promise<number | null> {
  const row = await db.prepare(`SELECT value FROM core_state WHERE key=?`).bind(key).first<{ value: string }>();
  const value = row === null ? Number.NaN : Number(row.value);
  return Number.isSafeInteger(value) ? value : null;
}

async function writeCursor(db: D1Database, key: string, value: number | null): Promise<void> {
  if (value === null) {
    await db.prepare(`DELETE FROM core_state WHERE key=?`).bind(key).run();
    return;
  }
  await db
    .prepare(`INSERT INTO core_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(key, String(value))
    .run();
}

async function readMaxTransactionIndex(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT MAX(tx_index) tip FROM transactions`).first<{ tip: number | null }>();
  return row?.tip ?? 0;
}

export type FetchTransactionFee = (baseUrl: string, txid: string) => Promise<number | null>;

async function fetchFees(
  env: Pick<Env, "ELECTRS_API_BASE">,
  rows: BitcoinFeeCandidate[],
  fetchFee: FetchTransactionFee,
): Promise<BitcoinFeeRow[]> {
  const fees: BitcoinFeeRow[] = [];
  for (let offset = 0; offset < rows.length; offset += FEE_FETCH_CONCURRENCY) {
    if (offset > 0) await new Promise((resolve) => setTimeout(resolve, ELECTRS_REQUEST_BATCH_INTERVAL_MS));
    const settled = await Promise.allSettled(
      rows.slice(offset, offset + FEE_FETCH_CONCURRENCY).map(async (row) => ({
        tx_hash: row.tx_hash,
        fee: await fetchFee(env.ELECTRS_API_BASE, row.tx_hash),
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
  return fees;
}

export interface BitcoinFeeReconciliation {
  requested: number;
  updated: number;
  /** Where the historical walk resumes next run; null once a full cycle completes and restarts at the top. */
  cursor: number | null;
}

/**
 * Fill Bitcoin-authoritative fees in two passes per run: transactions newer than the last tip watermark,
 * then a bounded slice of the historical walk resumed from its persisted cursor.
 */
export async function reconcileStagedBitcoinFees(
  env: Pick<Env, "CORE_DB" | "ELECTRS_API_BASE">,
  limit = FEES_PER_RUN,
  fetchFee: FetchTransactionFee = fetchTransactionFee,
): Promise<BitcoinFeeReconciliation> {
  const boundedLimit = Math.min(FEES_PER_RUN, Math.max(1, Math.trunc(limit)));
  const db = env.CORE_DB;
  let requested = 0;
  let updated = 0;

  const watermark = await readCursor(db, FEE_TIP_WATERMARK_KEY);
  const maxTransactionIndex = await readMaxTransactionIndex(db);
  if (watermark !== null && maxTransactionIndex > watermark) {
    const tip = await listMissingBitcoinFeesAbove(db, watermark, Math.min(FEE_TIP_PAGE_SIZE, boundedLimit));
    requested += tip.length;
    const fees = await fetchFees(env, tip, fetchFee);
    if (fees.length > 0) updated += await storeBitcoinFees(db, fees);
  }
  // Anything the tip pass could not resolve falls through to the historical walk on its next cycle.
  if (watermark !== maxTransactionIndex) await writeCursor(db, FEE_TIP_WATERMARK_KEY, maxTransactionIndex);

  let cursor = await readCursor(db, FEE_WALK_CURSOR_KEY);
  while (requested < boundedLimit) {
    const pageSize = Math.min(FEE_PAGE_SIZE, boundedLimit - requested);
    const rows = await listMissingBitcoinFees(db, cursor, pageSize);
    if (rows.length === 0) {
      cursor = null;
      break;
    }
    requested += rows.length;
    cursor = rows.at(-1)!.tx_index;
    const fees = await fetchFees(env, rows, fetchFee);
    if (fees.length > 0) updated += await storeBitcoinFees(db, fees);
    if (rows.length < pageSize) {
      cursor = null;
      break;
    }
  }
  await writeCursor(db, FEE_WALK_CURSOR_KEY, cursor);
  return { requested, updated, cursor };
}
