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

const CEX_USD = `CASE observation.quote_currency
  WHEN 'BTC' THEN observation.volume_base*observation.price*(SELECT usd FROM prices
    WHERE currency='BTC' AND day=observation.day)
  WHEN 'JPY' THEN observation.volume_base*observation.price
    *(SELECT price FROM market_price_observations WHERE source='ecb' AND venue='reference'
      AND base_currency='EUR' AND quote_currency='USD' AND day<=observation.day ORDER BY day DESC LIMIT 1)
    /(SELECT price FROM market_price_observations WHERE source='ecb' AND venue='reference'
      AND base_currency='EUR' AND quote_currency='JPY' AND day<=observation.day ORDER BY day DESC LIMIT 1)
  END`;

/** Executed CEX volume normalized through the reviewed same/prior-day BTC and ECB calendars. */
export function exchangeMarketHistory(db: D1Database) {
  return q<{ year: string; usd_volume: number; observations: number }>(
    db,
    `SELECT substr(observation.day,1,4) year,SUM(${CEX_USD}) usd_volume,COUNT(*) observations
     FROM market_price_observations observation WHERE observation.venue='cex'
     GROUP BY substr(observation.day,1,4) ORDER BY year`,
  );
}

export function exchangeMarketAssets(db: D1Database) {
  return q<{ asset: string; usd_volume: number; observations: number; first_day: string; last_day: string }>(
    db,
    `SELECT observation.base_currency asset,SUM(${CEX_USD}) usd_volume,COUNT(*) observations,
       MIN(observation.day) first_day,MAX(observation.day) last_day
     FROM market_price_observations observation WHERE observation.venue='cex'
     GROUP BY observation.base_currency ORDER BY usd_volume DESC`,
  );
}

export function exchangeMarketAssetHistory(db: D1Database) {
  return q<{ year: string; asset: string; usd_volume: number }>(
    db,
    `SELECT substr(observation.day,1,4) year,observation.base_currency asset,SUM(${CEX_USD}) usd_volume
     FROM market_price_observations observation WHERE observation.venue='cex'
     GROUP BY substr(observation.day,1,4),observation.base_currency ORDER BY year,asset`,
  );
}

/** Provider-reported aggregate volume is useful context but cannot be attributed to a venue. */
export function aggregateMarketAssets(db: D1Database) {
  return q<{ asset: string; reported_usd_volume: number; observations: number; first_day: string; last_day: string }>(
    db,
    `SELECT base_currency asset,SUM(reported_volume_quote) reported_usd_volume,COUNT(*) observations,
       MIN(day) first_day,MAX(day) last_day FROM market_price_observations
     WHERE source='coinmarketcap' AND venue='aggregate' AND quote_currency='USD'
       AND base_currency<>'BTC' AND reported_volume_quote IS NOT NULL
     GROUP BY base_currency ORDER BY reported_usd_volume DESC`,
  );
}

const COMBINED_MARKET = `WITH cex_daily AS (
  SELECT observation.day,observation.base_currency asset,SUM(${CEX_USD}) usd_volume
  FROM market_price_observations observation WHERE observation.venue='cex'
  GROUP BY observation.day,observation.base_currency
), cmc_daily AS (
  SELECT day,base_currency asset,MAX(reported_volume_quote) usd_volume
  FROM market_price_observations WHERE source='coinmarketcap' AND venue='aggregate'
    AND quote_currency='USD' AND base_currency<>'BTC' AND reported_volume_quote IS NOT NULL
  GROUP BY day,base_currency
), combined AS (
  SELECT * FROM cmc_daily UNION ALL SELECT cex.* FROM cex_daily cex
  WHERE NOT EXISTS(
    SELECT 1 FROM cmc_daily cmc WHERE cmc.day=cex.day AND cmc.asset=cex.asset)
)`;

/** One non-overlapping daily market-volume series: reported aggregate first, executions as gap fill. */
export function combinedMarketHistory(db: D1Database) {
  return q<{ year: string; asset: string; usd_volume: number }>(
    db,
    `${COMBINED_MARKET} SELECT substr(day,1,4) year,asset,SUM(usd_volume) usd_volume
     FROM combined GROUP BY substr(day,1,4),asset ORDER BY year,asset`,
  );
}

export function combinedMarketAssets(db: D1Database) {
  return q<{ asset: string; usd_volume: number; first_day: string; last_day: string }>(
    db,
    `${COMBINED_MARKET} SELECT asset,SUM(usd_volume) usd_volume,MIN(day) first_day,MAX(day) last_day
     FROM combined GROUP BY asset ORDER BY usd_volume DESC`,
  );
}

/** The same non-overlapping exchange series, scoped for an asset detail page. */
export function combinedMarketAsset(db: D1Database, asset: string) {
  return one<{ usd_volume: number; first_day: string; last_day: string }>(
    db,
    `${COMBINED_MARKET} SELECT SUM(usd_volume) usd_volume,MIN(day) first_day,MAX(day) last_day
     FROM combined WHERE asset=?`,
    asset,
  );
}
