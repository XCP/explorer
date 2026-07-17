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

/** Available now: high-Conviction assets (raw ≥ calibrated p90) purchasable right now, ranked by Conviction,
 *  showing the CHEAPEST path per asset (in USD) across two venues:
 *   - dispenser: cheapest open Counterparty dispenser holding stock (fixed-price BTC vending, instant buy)
 *   - emblem:    cheapest live Ethereum listing of a vault wrapping the card (Sequence-aggregated ask, USD)
 *  The dispenser ask converts to USD at the latest daily BTC rate so the two venues are comparable. */
export function radarAvailable(db: D1Database, limit = 40): Promise<AvailableAsset[]> {
  return q<AvailableAsset>(
    db,
    `WITH px AS (SELECT usd FROM prices WHERE currency='BTC' ORDER BY day DESC LIMIT 1),
     disp AS ( -- cheapest open dispenser per asset, per UNIT of the card (satoshirate is priced per dispense,
               -- which can hand out give_quantity>1 units, so divide to get the effective one-unit BTC price)
       SELECT asset_id,MIN(CAST(satoshirate_normalized AS REAL)
              / NULLIF(CAST(give_quantity_normalized AS REAL),0)) ask_btc
         FROM dispensers
        WHERE status=0 AND CAST(give_remaining_normalized AS REAL) > 0
        GROUP BY asset_id
     ),
     emb_ranked AS ( -- cheapest current-generation listing, keeping venue and URL from the same order
       SELECT asset_id,price_usd ask_usd,marketplace,url,
              ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY price_usd,order_id) rank
         FROM emblem_listings
        WHERE generation=COALESCE((SELECT CAST(value AS INTEGER) FROM core_state
                                    WHERE key='emblem_listings_generation'),0)
          AND asset_id IS NOT NULL AND price_usd IS NOT NULL
          AND (expiry=0 OR expiry>=unixepoch())
     ),
     emb AS (
       SELECT asset_id,ask_usd,marketplace,url FROM emb_ranked WHERE rank=1
     ),
     offers AS MATERIALIZED (
       SELECT asset_id FROM disp
       UNION
       SELECT asset_id FROM emb
     ),
     conv AS (
       SELECT signal.asset_id,dictionary.asset, (${CONVICTION}) conviction,
              COALESCE(signal.max_realized_usd,0) market_usd,
              signal.holders,signal.supply,signal.avg_holder_dex,signal.pct_creator_holders
         FROM offers
         JOIN asset_signals signal ON signal.asset_id=offers.asset_id
         JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
        WHERE ${ELIGIBLE} AND (${CONVICTION}) >= ${CONVICTION_PCT.p90}
     )
     SELECT c.asset,state.asset_longname,
            ROUND(c.conviction,2) conviction, ROUND(c.market_usd) market_usd,
            c.holders, CAST(ROUND(c.supply) AS INTEGER) supply,
            ROUND(c.avg_holder_dex,1) holder_dex, ROUND(c.pct_creator_holders) creator_pct,
            CASE WHEN emb.ask_usd IS NOT NULL AND (disp.ask_btc IS NULL OR emb.ask_usd < disp.ask_btc*(SELECT usd FROM px))
                 THEN 'emblem' ELSE 'dispenser' END venue,
            CASE WHEN emb.ask_usd IS NOT NULL AND (disp.ask_btc IS NULL OR emb.ask_usd < disp.ask_btc*(SELECT usd FROM px))
                 THEN ROUND(emb.ask_usd) ELSE ROUND(disp.ask_btc*(SELECT usd FROM px)) END ask_usd,
            CASE WHEN emb.ask_usd IS NOT NULL AND (disp.ask_btc IS NULL OR emb.ask_usd < disp.ask_btc*(SELECT usd FROM px))
                 THEN NULL ELSE ROUND(disp.ask_btc,8) END ask_btc,
            CASE WHEN emb.ask_usd IS NOT NULL AND (disp.ask_btc IS NULL OR emb.ask_usd < disp.ask_btc*(SELECT usd FROM px))
                 THEN emb.marketplace ELSE NULL END marketplace,
            CASE WHEN emb.ask_usd IS NOT NULL AND (disp.ask_btc IS NULL OR emb.ask_usd < disp.ask_btc*(SELECT usd FROM px))
                 THEN emb.url ELSE NULL END listing_url
       FROM conv c
       LEFT JOIN disp ON disp.asset_id=c.asset_id
      LEFT JOIN emb ON emb.asset_id=c.asset_id
       LEFT JOIN assets state ON state.asset_id=c.asset_id
      WHERE disp.asset_id IS NOT NULL OR emb.asset_id IS NOT NULL
      ORDER BY c.conviction DESC,c.asset ASC LIMIT ${limit}`,
  );
}
