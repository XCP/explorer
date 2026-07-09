/**
 * Curated allow/deny lists — now stored in the `curated` D1 table (migration 0022), edited via
 * /admin/curated. The lists themselves moved out of this file; what remains are the `…_SQL` fragments
 * the signal passes interpolate into `IN (…)` clauses. Each is a correlated subquery over the table, so
 * signals.ts reads the curated table transparently (no code change there) and there is a single source
 * of truth — the seed in 0022_curated.sql reproduces the old hard-coded arrays exactly.
 *
 * See also queries/curated.ts (the read-side helpers: exchange-name map, generic list/upsert/delete).
 */

// asset IN (…) → curated low-quality (wash/scam/bridge) set. Used by asset_signals.low_quality.
export const CURATED_LOWQ_SQL = `SELECT key FROM curated WHERE kind='lowq'`;

// address IN (…) → curated exchange / consolidation-hub wallets. Used by address_signals.is_exchange
// (and, transitively, deposit detection).
export const EXCHANGES_SQL = `SELECT key FROM curated WHERE kind='exchange'`;

// address IN (…) → verified burn addresses. Used by address_signals.is_burn.
export const CURATED_BURNS_SQL = `SELECT key FROM curated WHERE kind='burn'`;
