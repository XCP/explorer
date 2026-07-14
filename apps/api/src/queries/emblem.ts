/**
 * Emblem queries — the SQL behind GET /v2/emblem/*. Every "what's inside a vault" figure is derived from
 * our OWN Counterparty ledger (balances/sends) joined to the crawler's emblem_vaults(token_id, contract,
 * btc_address) map; Emblem is never trusted for contents.
 */
import type { EmblemStats, EmblemAssetRow, EmblemVaultRow } from "@xcp/shared/emblem";
import { q } from "#api/db";

export interface Page {
  limit: number;
  offset: number;
}

/** The stats row without the derived `empty` count (the handler computes empty = vaults − funded). */
export type EmblemStatsRow = Omit<EmblemStats, "empty">;

/** Segmentation counts: vaults + funded/cracked/revaulted/depositor splits + holder/real-user totals. */
export function emblemStats(db: D1Database): Promise<EmblemStatsRow | null> {
  return db
    .prepare(
      `SELECT vaults,funded,cracked_to_user,revaulted,depositors,all_holders,real_users
       FROM emblem_stats WHERE id=1`,
    )
    .first<EmblemStatsRow>();
}

/** Assets currently locked inside Emblem vaults (held by a vault BTC address), by vault count. */
export function emblemAssets(db: D1Database, p: Page): Promise<EmblemAssetRow[]> {
  return q<EmblemAssetRow>(
    db,
    `SELECT asset.asset,COUNT(*) vaults FROM balances balance
     JOIN emblem_vaults vault ON vault.btc_address_id=balance.address_id
     JOIN asset_dictionary asset ON asset.asset_id=balance.asset_id
     WHERE CAST(balance.quantity AS INTEGER)>0 GROUP BY balance.asset_id
     ORDER BY vaults DESC,asset.asset ASC LIMIT ? OFFSET ?`,
    p.limit,
    p.offset,
  );
}

/** The vaults themselves: token id + contract + BTC address, and whether they currently hold Counterparty value. */
export function emblemVaults(db: D1Database, p: Page): Promise<EmblemVaultRow[]> {
  return q<EmblemVaultRow>(
    db,
    `SELECT vault.token_id,contract.address contract,btc.address btc_address,
            (SELECT COUNT(*) FROM balances balance
              WHERE balance.address_id=vault.btc_address_id AND CAST(balance.quantity AS INTEGER)>0) held_assets
     FROM emblem_vaults vault
     LEFT JOIN address_dictionary contract ON contract.address_id=vault.contract_id
     JOIN address_dictionary btc ON btc.address_id=vault.btc_address_id
     ORDER BY vault.first_seen DESC,vault.token_id DESC LIMIT ? OFFSET ?`,
    p.limit,
    p.offset,
  );
}
