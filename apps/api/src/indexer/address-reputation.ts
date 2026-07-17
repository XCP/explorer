import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

export const ADDRESS_REPUTATION_MODEL_VERSION = 1;
export const ADDRESS_REPUTATION_REFRESH_SECONDS = 86_400;

export const ADDRESS_REPUTATION_BANDS = [
  { tier: "Exceptional", slug: "exceptional", minimum: 99, meaning: "top 1% — an exceptional observed track record" },
  { tier: "Strong", slug: "strong", minimum: 90, meaning: "top 10% — a strong, substantial observed track record" },
  { tier: "Established", slug: "established", minimum: 50, meaning: "upper half — an established observed track record" },
  { tier: "Limited", slug: "limited", minimum: 0, meaning: "limited evidence relative to ranked addresses" },
] as const;

export const addressReputationRefreshDue = (now: number, refreshedAt: number): boolean =>
  refreshedAt <= 0 || now - refreshedAt >= ADDRESS_REPUTATION_REFRESH_SECONDS;

// Classification is a prerequisite, not a scoring input. Only user-like addresses
// with at least one directly observed family of evidence enter the comparison set.
export const ADDRESS_REPUTATION_ELIGIBLE_SQL = `signal.is_exchange=0 AND signal.is_deposit=0 AND signal.is_burn=0
  AND COALESCE(signal.is_emblem_vault,0)=0 AND COALESCE(signal.likely_service,0)=0
  AND COALESCE(signal.vault_scams,0)+COALESCE(signal.shell_scams,0)+COALESCE(signal.dump_scams,0)=0
  AND (signal.last_block>COALESCE(signal.first_block,signal.last_block)
    OR signal.survived_assets>0 OR signal.dividends>0 OR signal.locked_assets>0
    OR signal.btc_fees>0 OR signal.clean_btc_spent>0 OR signal.clean_dispense_btc>0
    OR signal.assets_held>0 OR signal.dex_trades>0 OR signal.stamps_created>0)`;

/**
 * Reputation claims one thing: relative strength of directly observed Counterparty track record.
 * Log transforms prevent raw volume from dominating within a family. Each family becomes a population
 * percentile, receives equal weight, and the combined evidence is ranked once more onto a literal 0–100 scale.
 * Current recency, infrastructure identity, and integrity evidence remain separate facts/classifications.
 */
export const ADDRESS_REPUTATION_UPSERT_SQL = `INSERT INTO address_reputations(
  address_id,reputation,rank_position,population,duration_score,creation_score,
  economic_score,participation_score,calculated_at,model_version
)
WITH components AS MATERIALIZED (
  SELECT signal.address_id,
    PERCENT_RANK() OVER(ORDER BY LN(1+MAX(0,signal.last_block-COALESCE(signal.first_block,signal.last_block)))) duration,
    PERCENT_RANK() OVER(ORDER BY LN(1+signal.survived_assets)+LN(1+signal.dividends)+LN(1+signal.locked_assets)) creation,
    PERCENT_RANK() OVER(ORDER BY LN(1+signal.btc_fees)+LN(1+signal.clean_btc_spent)+LN(1+signal.clean_dispense_btc)) economic,
    PERCENT_RANK() OVER(ORDER BY LN(1+signal.assets_held)+LN(1+signal.dex_trades)+LN(1+signal.stamps_created)) participation
  FROM address_signals signal WHERE ${ADDRESS_REPUTATION_ELIGIBLE_SQL}
), ranked AS (
  SELECT address_id,duration,creation,economic,participation,
    100.0*PERCENT_RANK() OVER(ORDER BY (duration+creation+economic+participation)/4.0) reputation,
    ROW_NUMBER() OVER(ORDER BY (duration+creation+economic+participation)/4.0 DESC,address_id) rank_position,
    COUNT(*) OVER() population
  FROM components
)
SELECT address_id,reputation,rank_position,population,100.0*duration,100.0*creation,
  100.0*economic,100.0*participation,?1,${ADDRESS_REPUTATION_MODEL_VERSION}
FROM ranked WHERE 1
ON CONFLICT(address_id) DO UPDATE SET reputation=excluded.reputation,
  rank_position=excluded.rank_position,population=excluded.population,
  duration_score=excluded.duration_score,creation_score=excluded.creation_score,
  economic_score=excluded.economic_score,participation_score=excluded.participation_score,
  calculated_at=excluded.calculated_at,model_version=excluded.model_version`;

export const ADDRESS_REPUTATION_RECONCILE_SQL = `DELETE FROM address_reputations AS reputation
  WHERE NOT EXISTS (
    SELECT 1 FROM address_signals signal
    WHERE signal.address_id=reputation.address_id AND ${ADDRESS_REPUTATION_ELIGIBLE_SQL}
  )`;

export async function refreshAddressReputations(db: D1Database, now = Math.floor(Date.now() / 1_000)) {
  const [result] = await db.batch([
    db.prepare(ADDRESS_REPUTATION_UPSERT_SQL).bind(now),
    db.prepare(ADDRESS_REPUTATION_RECONCILE_SQL),
  ]);
  await setCoreState(db, "address_reputations_refreshed_at", now);
  return {
    refreshed: true,
    rowsWritten: result.meta.changes,
    calculatedAt: now,
    modelVersion: ADDRESS_REPUTATION_MODEL_VERSION,
  };
}

export async function maybeRefreshAddressReputations(db: D1Database, now = Math.floor(Date.now() / 1_000)) {
  const refreshedAt = await getCoreStateInt(db, "address_reputations_refreshed_at");
  if (!addressReputationRefreshDue(now, refreshedAt)) return { refreshed: false, refreshedAt };
  return refreshAddressReputations(db, now);
}

export function addressReputationTier(reputation: number): string {
  return ADDRESS_REPUTATION_BANDS.find((band) => reputation >= band.minimum)?.tier ?? "Limited";
}

export type AddressReputationState =
  | "ranked"
  | "exchange"
  | "deposit"
  | "vault"
  | "burn"
  | "service"
  | "integrity"
  | "unrated";

export const ADDRESS_REPUTATION_STATE_LABELS: Record<Exclude<AddressReputationState, "ranked">, string> = {
  exchange: "Exchange",
  deposit: "Exchange deposit",
  vault: "Vault",
  burn: "Burn",
  service: "Service",
  integrity: "Integrity flag",
  unrated: "No history",
};

export function addressReputationState(row: Record<string, unknown>): AddressReputationState {
  const yes = (key: string) => Number(row[key]) === 1;
  const count = (key: string) => Number(row[key]) || 0;
  if (yes("is_exchange")) return "exchange";
  if (yes("is_deposit")) return "deposit";
  if (yes("is_emblem_vault")) return "vault";
  if (yes("is_burn")) return "burn";
  if (yes("likely_service")) return "service";
  if (count("vault_scams") + count("shell_scams") + count("dump_scams") > 0) return "integrity";
  return row.reputation == null ? "unrated" : "ranked";
}
