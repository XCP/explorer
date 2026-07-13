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
    `SELECT address, assets_received, in_peers, first_block, last_block FROM address_signals WHERE is_exchange=1 ORDER BY in_peers DESC`,
  );
}

/** Assets that most moved onto exchanges (distinct depositors per asset = CEX-listed / liquid history). */
export function exchangeTopAssets(db: D1Database): Promise<ExchangeTopAsset[]> {
  return q<ExchangeTopAsset>(
    db,
    `SELECT asset, asset_longname, depositors
       FROM exchange_top_assets
      WHERE generation=COALESCE(
        (SELECT CAST(value AS INTEGER) FROM indexer_state WHERE key='exchange_top_assets_generation'), 0
      )
      ORDER BY depositors DESC, asset ASC`,
  );
}

/** Exchange + deposit-address counts for the header. */
export function exchangeSummary(db: D1Database): Promise<ExchangeSummary | null> {
  return one<ExchangeSummary>(
    db,
    `SELECT (SELECT COUNT(*) FROM address_signals WHERE is_exchange=1) exchanges, (SELECT COUNT(*) FROM address_signals WHERE is_deposit=1) deposit_addresses`,
  );
}
