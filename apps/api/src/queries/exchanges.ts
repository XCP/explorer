/**
 * Exchange queries — the SQL behind GET /v2/exchanges. The operator-name labelling (the NAMES map) stays
 * in the handler; these functions return the raw CEX-wallet rows, most-deposited assets, and the counts.
 */
import type { ExchangeRow, ExchangesPayload } from "@xcp/shared/addresses";
import { q, one } from "#api/db";

/** A curated CEX wallet before operator-name labelling (the handler adds `name`). */
export type ExchangeWalletRow = Omit<ExchangeRow, "name">;
type ExchangeTopAsset = ExchangesPayload["top_assets"][number];
type ExchangeSummary = NonNullable<ExchangesPayload["summary"]>;

/** The is_exchange wallets, most-connected first. */
export function exchangeWallets(db: D1Database): Promise<ExchangeWalletRow[]> {
  return q<ExchangeWalletRow>(
    db,
    `SELECT dictionary.address,signal.assets_received,signal.in_peers,signal.first_block,signal.last_block
       FROM address_signals signal JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
      WHERE signal.is_exchange=1 ORDER BY signal.in_peers DESC`,
  );
}

/** Assets that most moved onto exchanges (distinct depositors per asset = CEX-listed / liquid history). */
export function exchangeTopAssets(db: D1Database): Promise<ExchangeTopAsset[]> {
  return q<ExchangeTopAsset>(
    db,
    `SELECT dictionary.asset,asset.asset_longname,top.depositors
       FROM exchange_top_assets top
       JOIN asset_dictionary dictionary ON dictionary.asset_id=top.asset_id
       LEFT JOIN assets asset ON asset.asset_id=top.asset_id
      WHERE top.generation=(SELECT MAX(generation) FROM exchange_top_assets)
      ORDER BY top.depositors DESC,dictionary.asset ASC`,
  );
}

/** Exchange + deposit-address counts for the header. */
export function exchangeSummary(db: D1Database): Promise<ExchangeSummary | null> {
  return one<ExchangeSummary>(
    db,
    `SELECT (SELECT COUNT(*) FROM address_signals WHERE is_exchange=1) exchanges, (SELECT COUNT(*) FROM address_signals WHERE is_deposit=1) deposit_addresses`,
  );
}
