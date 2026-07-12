/**
 * Emblem queries — the SQL behind GET /v2/emblem/*. Every "what's inside a vault" figure is derived from
 * our OWN Counterparty ledger (balances/sends) joined to the crawler's emblem_vaults(token_id, contract,
 * btc_address) map; Emblem is never trusted for contents.
 */
import type { EmblemStats, EmblemAssetRow, EmblemVaultRow } from "@xcp/shared/emblem";
import { q, one } from "../db";

export interface Page {
  limit: number;
  offset: number;
}

/** The stats row without the derived `empty` count (the handler computes empty = vaults − funded). */
export type EmblemStatsRow = Omit<EmblemStats, "empty">;

/** Segmentation counts: vaults + funded/cracked/revaulted/depositor splits + holder/real-user totals. */
export function emblemStats(db: D1Database): Promise<EmblemStatsRow | null> {
  return one<EmblemStatsRow>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM emblem_vaults WHERE btc_address IS NOT NULL) vaults,
       (SELECT COUNT(DISTINCT e.btc_address) FROM emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND CAST(b.quantity AS INTEGER)>0) funded,
       (SELECT COUNT(DISTINCT s.destination) FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source
          WHERE s.destination IS NOT NULL AND NOT EXISTS (SELECT 1 FROM emblem_vaults v WHERE v.btc_address=s.destination)) cracked_to_user,
       (SELECT COUNT(DISTINCT s.destination) FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source
          WHERE EXISTS (SELECT 1 FROM emblem_vaults v WHERE v.btc_address=s.destination)) revaulted,
       (SELECT COUNT(DISTINCT s.source) FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination) depositors,
       (SELECT COUNT(*) FROM address_signals WHERE assets_held>0) all_holders,
       (SELECT COUNT(*) FROM address_signals WHERE assets_held>0 AND is_emblem_vault=0 AND is_exchange=0 AND is_burn=0 AND is_deposit=0 AND likely_service=0) real_users`,
  );
}

/** Assets currently locked inside Emblem vaults (held by a vault BTC address), by vault count. */
export function emblemAssets(db: D1Database, p: Page): Promise<EmblemAssetRow[]> {
  return q<EmblemAssetRow>(
    db,
    `SELECT b.asset, COUNT(*) vaults FROM balances b JOIN emblem_vaults e ON e.btc_address=b.holder
     WHERE CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset ORDER BY vaults DESC LIMIT ? OFFSET ?`,
    p.limit,
    p.offset,
  );
}

/** The vaults themselves: token id + contract + BTC address, and whether they currently hold Counterparty value. */
export function emblemVaults(db: D1Database, p: Page): Promise<EmblemVaultRow[]> {
  return q<EmblemVaultRow>(
    db,
    `SELECT e.token_id, e.contract, e.btc_address,
            (SELECT COUNT(*) FROM balances b WHERE b.holder=e.btc_address AND CAST(b.quantity AS INTEGER)>0) held_assets
     FROM emblem_vaults e WHERE e.btc_address IS NOT NULL ORDER BY e.first_seen DESC LIMIT ? OFFSET ?`,
    p.limit,
    p.offset,
  );
}
