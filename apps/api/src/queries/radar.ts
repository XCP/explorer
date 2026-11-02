/**
 * Established and available asset queries. Conviction uses the same holder-and-scarcity factors as asset pages.
 */
import type { AvailableAsset, RadarAsset } from "@xcp/shared/radar";
import { q } from "#api/db";
import { assetRankingEligibleSql } from "#api/reputation/eligibility";
import { rawSqlExpr } from "#api/reputation/score";
import { CONVICTION_FACTORS, CONVICTION_PCT } from "#api/reputation/config";

// Conviction raw as SQL (no tip terms in CONVICTION_FACTORS, so 0). Bare column names resolve against
// asset_signals inside the CTEs below (no join there ⇒ no ambiguity with the assets table's `supply`).
const CONVICTION = rawSqlExpr(CONVICTION_FACTORS, 0);

// The base population: real, broadly held, named assets (not numeric stamps). Network standing remains a
// score component, not an eligibility gate: held-out graph recovery does not validate asset quality.
const ELIGIBLE = `${assetRankingEligibleSql("signal")} AND signal.holders>=15
   AND EXISTS (SELECT 1 FROM assets eligible_state
                WHERE eligible_state.asset_id=signal.asset_id AND eligible_state.type<>'numeric')`;

/** Established: the strongest mature holder-conviction profiles in the eligible population. */
export function radarEstablished(db: D1Database, limit = 40): Promise<RadarAsset[]> {
  return q<RadarAsset>(
    db,
    `WITH conv AS (
       SELECT signal.asset_id,dictionary.asset, (${CONVICTION}) conviction,
              COALESCE(signal.max_realized_usd,0) market_usd,
              signal.holders,signal.supply,signal.avg_holder_dex,signal.pct_creator_holders
         FROM asset_signals signal
         JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
        WHERE ${ELIGIBLE}
     )
     SELECT c.asset,state.asset_longname,
            ROUND(c.conviction,2) conviction, ROUND(c.market_usd) market_usd,
            c.holders, CAST(ROUND(c.supply) AS INTEGER) supply,
            ROUND(c.avg_holder_dex,1) holder_dex, ROUND(c.pct_creator_holders) creator_pct
       FROM conv c LEFT JOIN assets state ON state.asset_id=c.asset_id
      ORDER BY c.conviction DESC,c.asset ASC LIMIT ${limit}`,
  );
}

/** Available now: eligible high-Conviction assets with a stocked Counterparty dispenser.
 * Ethereum asks are no longer advertised: their Sequence provider is retiring. */
export function radarAvailable(db: D1Database, limit = 40): Promise<AvailableAsset[]> {
  return q<AvailableAsset>(
    db,
    `WITH px AS (SELECT usd FROM prices WHERE currency='BTC' ORDER BY day DESC LIMIT 1),
     disp AS ( -- cheapest open dispenser per asset, per UNIT of the card (satoshirate is priced per dispense,
               -- which can hand out give_quantity>1 units, so divide to get the effective one-unit BTC price).
               -- Oracle dispensers quote fiat cents settled at the oracle's latest valid broadcast, exactly as
               -- counterparty-core prices a dispense; one without a usable quote cannot vend and is skipped.
       SELECT dispenser.asset_id,MIN(
              CASE WHEN dispenser.oracle_address_id IS NULL THEN CAST(dispenser.satoshirate_normalized AS REAL)
                   ELSE (CAST(dispenser.satoshirate AS REAL)/100.0)/quote.price END
              / NULLIF(CAST(dispenser.give_quantity_normalized AS REAL),0)) ask_btc
         FROM dispensers dispenser
         LEFT JOIN (
           SELECT source_id,CAST(value AS REAL) price,
                  ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY block_index DESC,tx_index DESC) recency
             FROM broadcasts
            WHERE status='valid'
              AND source_id IN (SELECT DISTINCT oracle_address_id FROM dispensers
                                 WHERE status=0 AND oracle_address_id IS NOT NULL)
         ) quote ON quote.source_id=dispenser.oracle_address_id AND quote.recency=1
        WHERE dispenser.status=0 AND CAST(dispenser.give_remaining_normalized AS REAL) > 0
          AND (dispenser.oracle_address_id IS NULL OR quote.price > 0)
        GROUP BY dispenser.asset_id
     ),
     conv AS (
       SELECT signal.asset_id,dictionary.asset, (${CONVICTION}) conviction,
              COALESCE(signal.max_realized_usd,0) market_usd,
              signal.holders,signal.supply,signal.avg_holder_dex,signal.pct_creator_holders
         FROM disp
         JOIN asset_signals signal ON signal.asset_id=disp.asset_id
         JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
        WHERE ${ELIGIBLE} AND (${CONVICTION}) >= ${CONVICTION_PCT.p90}
     )
     SELECT c.asset,state.asset_longname,
            ROUND(c.conviction,2) conviction, ROUND(c.market_usd) market_usd,
            c.holders, CAST(ROUND(c.supply) AS INTEGER) supply,
            ROUND(c.avg_holder_dex,1) holder_dex, ROUND(c.pct_creator_holders) creator_pct,
            'dispenser' venue,
            ROUND(disp.ask_btc*(SELECT usd FROM px)) ask_usd,
            ROUND(disp.ask_btc,8) ask_btc,
            NULL marketplace, NULL listing_url
       FROM conv c
       JOIN disp ON disp.asset_id=c.asset_id
       LEFT JOIN assets state ON state.asset_id=c.asset_id
      ORDER BY c.conviction DESC,c.asset ASC LIMIT ${limit}`,
  );
}
