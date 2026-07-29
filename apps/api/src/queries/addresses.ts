/**
 * Address queries — the only place the address read surfaces' SQL lives. Handlers call these and wrap
 * the result in the envelope. List-row shapes are the wire contract (@xcp/shared/addresses); the
 * reputation row is the internal signals row (../schema) the scorer consumes.
 *
 * NOTE: the "real, non-dust address holder" predicate (holder_type='address' AND quantity>0) is written
 * inline in the two reads that need it — an honest one-line duplication, not a shared exported fragment.
 * The reputation-review expression/filter strings are composed in the handler from reputation/config
 * (config-derived, not user input) and passed in — the query owns the surrounding SQL.
 */
import type {
  AddressIssuanceRow,
  AddressDispenserRow,
  AddressDispenseRow,
  AddressIssuedAssetRow,
  AddressSummary,
  AddressConnectionRow,
  AddressLineageRow,
  AddressLedgerRow,
  ReputationDistribution,
  ReputationTopRow,
  AddressCensus,
  AddressKindRow,
} from "@xcp/shared/addresses";
import type { AddressSignalsRow } from "#api/storage-types";
import { PERSONA } from "#api/reputation/config";
import { q, one } from "#api/db";
import { ADDRESS_LEDGER_SQL } from "#api/queries/ledger";

export interface Page {
  limit: number;
  offset: number;
}

/** The address_signals row plus the read-time extras the scorer needs (XCP balance + chain tip). */
export type AddressReputationRow = AddressSignalsRow & {
  xcp: number | null;
  tip: number | null;
  last_active_at: number | null;
  observed_at: number | null;
  reputation: number | null;
  rank_position: number | null;
  population: number | null;
  duration_score: number | null;
  creation_score: number | null;
  economic_score: number | null;
  participation_score: number | null;
  calculated_at: number | null;
  model_version: number | null;
};

/** Provenance ledger — every raw credit (in) and debit (out) for an address, newest first (credits/debits,
 *  migration 0038). ?1 is the address (used by both legs); a 2-term union stays under D1's compound-SELECT cap. */
export function listAddressLedger(db: D1Database, address: string, p: Page): Promise<AddressLedgerRow[]> {
  return q<AddressLedgerRow>(db, ADDRESS_LEDGER_SQL, address, p.limit, p.offset);
}

/** Issuances the address made or received (transfer), newest first. */
export function listIssuances(db: D1Database, address: string, p: Page): Promise<AddressIssuanceRow[]> {
  return q<AddressIssuanceRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1),
     candidates AS (
       SELECT event_index,block_index FROM issuances WHERE source_id=(SELECT address_id FROM identity)
       UNION
       SELECT event_index,block_index FROM issuances WHERE issuer_id=(SELECT address_id FROM identity)
     ), page AS (
       SELECT event_index FROM candidates ORDER BY block_index DESC,event_index DESC LIMIT ?2 OFFSET ?3
     )
     SELECT LOWER(HEX(i.tx_hash)) tx_hash,i.block_index,i.block_time,a.asset,i.asset_longname,
       i.quantity_normalized,i.transfer,issuer.address issuer,i.description,i.asset_events,i.status
     FROM page JOIN issuances i ON i.event_index=page.event_index
     LEFT JOIN asset_dictionary a ON a.asset_id=i.asset_id
     LEFT JOIN address_dictionary issuer ON issuer.address_id=i.issuer_id
     ORDER BY i.block_index DESC,i.event_index DESC`,
    address,
    p.limit,
    p.offset,
  );
}

/** Dispensers opened by the address, newest first. */
export function listDispensers(db: D1Database, address: string, p: Page): Promise<AddressDispenserRow[]> {
  return q<AddressDispenserRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1), page AS (
       SELECT tx_index FROM dispensers WHERE source_id=(SELECT address_id FROM identity)
       ORDER BY block_index DESC,tx_index DESC LIMIT ?2 OFFSET ?3
     )
     SELECT LOWER(HEX(d.tx_hash)) tx_hash,d.block_index,d.block_time,source.address source,asset.asset,
       d.give_quantity_normalized,d.give_remaining_normalized,d.satoshirate,d.satoshirate_normalized,
       d.dispense_count,d.status
     FROM page JOIN dispensers d ON d.tx_index=page.tx_index
     LEFT JOIN address_dictionary source ON source.address_id=d.source_id
     LEFT JOIN asset_dictionary asset ON asset.asset_id=d.asset_id
     ORDER BY d.block_index DESC,d.tx_index DESC`,
    address,
    p.limit,
    p.offset,
  );
}

/** Dispenses the address triggered or received, newest first. */
export function listDispenses(db: D1Database, address: string, p: Page): Promise<AddressDispenseRow[]> {
  return q<AddressDispenseRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1),
     candidates AS (
       SELECT event_index,block_index FROM dispenses WHERE source_id=(SELECT address_id FROM identity)
       UNION
       SELECT event_index,block_index FROM dispenses WHERE destination_id=(SELECT address_id FROM identity)
     ), page AS (
       SELECT event_index FROM candidates ORDER BY block_index DESC,event_index DESC LIMIT ?2 OFFSET ?3
     )
     SELECT LOWER(HEX(d.tx_hash)) tx_hash,d.block_index,d.block_time,source.address source,
       destination.address destination,asset.asset,d.dispense_quantity_normalized,
       LOWER(HEX(dispenser.tx_hash)) dispenser_tx_hash,d.btc_amount,t.usd_value
     FROM page JOIN dispenses d ON d.event_index=page.event_index
     LEFT JOIN address_dictionary source ON source.address_id=d.source_id
     LEFT JOIN address_dictionary destination ON destination.address_id=d.destination_id
     LEFT JOIN asset_dictionary asset ON asset.asset_id=d.asset_id
     LEFT JOIN dispensers dispenser ON dispenser.tx_index=d.dispenser_tx_index
     LEFT JOIN trades t ON t.venue='dispense' AND t.ref=CAST(d.dispense_id AS TEXT)
     ORDER BY d.block_index DESC,d.event_index DESC`,
    address,
    p.limit,
    p.offset,
  );
}

/** Assets the address issued or owns, newest issuance first. */
export function listIssued(db: D1Database, address: string, p: Page): Promise<AddressIssuedAssetRow[]> {
  return q<AddressIssuedAssetRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1),
     candidates AS (
       SELECT asset_id,first_issuance_block_index FROM assets WHERE issuer_id=(SELECT address_id FROM identity)
       UNION
       SELECT asset_id,first_issuance_block_index FROM assets WHERE owner_id=(SELECT address_id FROM identity)
     ), page AS (
       SELECT asset_id FROM candidates ORDER BY first_issuance_block_index DESC,asset_id DESC LIMIT ?2 OFFSET ?3
     )
     SELECT dictionary.asset,asset.asset_longname,asset.divisible,asset.locked,issuer.address issuer,
       asset.first_issuance_block_index
     FROM page JOIN assets asset ON asset.asset_id=page.asset_id
     JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
     LEFT JOIN address_dictionary issuer ON issuer.address_id=asset.issuer_id
     ORDER BY asset.first_issuance_block_index DESC,asset.asset_id DESC`,
    address,
    p.limit,
    p.offset,
  );
}

/** Identity header counts (XCP balance, held/issued/dispenser/order counts, activity span, disp trust). */
export function addressSummary(db: D1Database, address: string): Promise<AddressSummary | null> {
  return one<AddressSummary>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1)
     SELECT (
              SELECT balance.quantity_normalized FROM balances balance
              WHERE balance.address_id=identity.address_id
                AND balance.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
            ) xcp,
            COALESCE(signal.assets_held,0) assets,
            (SELECT COUNT(*) FROM assets WHERE issuer_id=identity.address_id) issued,
            (SELECT COUNT(*) FROM dispensers WHERE source_id=identity.address_id) dispensers,
            (SELECT COUNT(*) FROM dispensers WHERE source_id=identity.address_id AND status=0) open_dispensers,
            (SELECT COUNT(*) FROM orders WHERE source_id=identity.address_id AND status='open') open_orders,
            signal.first_block,NULLIF(signal.last_block,0) last_block,
            ROUND(signal.disp_trust,1) dispenser_trust
       FROM (SELECT (SELECT address_id FROM identity) address_id) identity
       LEFT JOIN address_signals signal ON signal.address_id=identity.address_id`,
    address,
  );
}

/** The precomputed address_signals row + XCP balance + chain tip, for the reputation scorer. */
export function addressReputationRow(db: D1Database, address: string): Promise<AddressReputationRow | null> {
  return one<AddressReputationRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1)
     SELECT signal.*,reputation.reputation,reputation.rank_position,reputation.population,
            reputation.duration_score,reputation.creation_score,reputation.economic_score,
            reputation.participation_score,reputation.calculated_at,reputation.model_version,
            (SELECT CAST(balance.quantity_normalized AS REAL) FROM balances balance
              WHERE balance.address_id=signal.address_id
                AND balance.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')) xcp,
            (SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1) tip,
            (SELECT block_time FROM blocks WHERE block_index=signal.last_block) last_active_at,
            (SELECT block_time FROM blocks ORDER BY block_index DESC LIMIT 1) observed_at
       FROM address_signals signal LEFT JOIN address_reputations reputation USING(address_id)
      WHERE signal.address_id=(SELECT address_id FROM identity)`,
    address,
  );
}

/** Top counterparties merged across sends + dispenses + DEX order-matches (excludes self + deposit plumbing).
 *  D1 caps compound-SELECT terms LOW (a six-arm UNION ALL fails to even parse: "too many terms in
 *  compound SELECT" — this endpoint 500'd for EVERY address until 2026-07-21). The parser counts
 *  syntactic terms per compound, so each per-table pair lives in its own two-term CTE and the final
 *  merge unions three CTE references. */
export function addressConnections(db: D1Database, address: string, limit: number): Promise<AddressConnectionRow[]> {
  return q<AddressConnectionRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1), send_edges AS (
       SELECT destination_id cp,COUNT(*) n FROM sends
        WHERE source_id=(SELECT address_id FROM identity) AND destination_id IS NOT NULL GROUP BY destination_id
       UNION ALL
       SELECT source_id cp,COUNT(*) n FROM sends
        WHERE destination_id=(SELECT address_id FROM identity) AND source_id IS NOT NULL GROUP BY source_id
     ), dispense_edges AS (
       SELECT destination_id cp,COUNT(*) n FROM dispenses
        WHERE source_id=(SELECT address_id FROM identity) GROUP BY destination_id
       UNION ALL
       SELECT source_id cp,COUNT(*) n FROM dispenses
        WHERE destination_id=(SELECT address_id FROM identity) GROUP BY source_id
     ), match_edges AS (
       SELECT tx1_address_id cp,COUNT(*) n FROM order_matches
        WHERE tx0_address_id=(SELECT address_id FROM identity) GROUP BY tx1_address_id
       UNION ALL
       SELECT tx0_address_id cp,COUNT(*) n FROM order_matches
        WHERE tx1_address_id=(SELECT address_id FROM identity) GROUP BY tx0_address_id
     ), edges AS (
       SELECT cp,n FROM send_edges UNION ALL SELECT cp,n FROM dispense_edges UNION ALL SELECT cp,n FROM match_edges
     ), grouped AS (
       SELECT cp,SUM(n) interactions FROM edges
        WHERE cp IS NOT NULL AND cp<>(SELECT address_id FROM identity) GROUP BY cp
     )
     SELECT dictionary.address cp,grouped.interactions,COALESCE(signal.is_exchange,0) is_exchange
       FROM grouped JOIN address_dictionary dictionary ON dictionary.address_id=grouped.cp
       LEFT JOIN address_signals signal ON signal.address_id=grouped.cp
      WHERE COALESCE(signal.is_deposit,0)=0
      ORDER BY grouped.interactions DESC,grouped.cp LIMIT ?2`,
    address,
    limit,
  );
}

/** Sweep-based identity lineage — swept-to / swept-from links (strongest "same person" on-chain signal). */
export function addressLineage(db: D1Database, address: string): Promise<AddressLineageRow[]> {
  return q<AddressLineageRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1)
     SELECT 'out' direction,destination.address counterparty,sweep.block_index,sweep.block_time
       FROM sweeps sweep LEFT JOIN address_dictionary destination ON destination.address_id=sweep.destination_id
      WHERE sweep.source_id=(SELECT address_id FROM identity)
     UNION ALL
     SELECT 'in' direction,source.address counterparty,sweep.block_index,sweep.block_time
       FROM sweeps sweep LEFT JOIN address_dictionary source ON source.address_id=sweep.source_id
      WHERE sweep.destination_id=(SELECT address_id FROM identity)
     ORDER BY block_index`,
    address,
  );
}

/* ---------- reputation methodology (/v2/reputation/review) ---------- */
/** Population counts across the materialized Reputation bands. */
export function reputationDistribution(db: D1Database): Promise<ReputationDistribution | null> {
  return one<ReputationDistribution>(
    db,
    `SELECT COUNT(*) n,ROUND(AVG(reputation),2) mean,ROUND(MAX(reputation),2) max,
       SUM(reputation>=99) exceptional,SUM(reputation>=90 AND reputation<99) strong,
       SUM(reputation>=50 AND reputation<90) established,SUM(reputation<50) limited
     FROM address_reputations`,
  );
}

/** Top of the population table for face-validity review. */
export function reputationTop(db: D1Database): Promise<ReputationTopRow[]> {
  return q<ReputationTopRow>(
    db,
    `SELECT dictionary.address,ROUND(reputation.reputation,1) score,reputation.rank_position,
       signal.survived_assets,signal.assets_held,
       signal.dex_trades,signal.stamps_created,signal.dividends,signal.btc_fees
     FROM address_reputations reputation JOIN address_signals signal USING(address_id)
     JOIN address_dictionary dictionary USING(address_id)
     ORDER BY reputation.reputation DESC,reputation.address_id LIMIT 20`,
  );
}

export function reputationMetadata(db: D1Database): Promise<{ calculated_at: number | null } | null> {
  return one<{ calculated_at: number | null }>(db, `SELECT MAX(calculated_at) calculated_at FROM address_reputations`);
}

/** The infrastructure census: how the mirror's non-user addresses break down by kind. The read layer
 *  builds the funnel as infrastructure + scored (the real-address total); "no history" is 0 by
 *  definition. Powers the /reputation "who counts" act. */
export function reputationFunnel(db: D1Database): Promise<{
  infra: number;
  exchanges: number;
  deposits: number;
  vaults: number;
  burns: number;
} | null> {
  return one<{ infra: number; exchanges: number; deposits: number; vaults: number; burns: number }>(
    db,
    `SELECT
       SUM(CASE WHEN is_exchange=1 OR is_deposit=1 OR is_burn=1 OR COALESCE(is_emblem_vault,0)=1 THEN 1 ELSE 0 END) infra,
       SUM(CASE WHEN is_exchange=1 THEN 1 ELSE 0 END) exchanges,
       SUM(CASE WHEN is_deposit=1 THEN 1 ELSE 0 END) deposits,
       SUM(CASE WHEN COALESCE(is_emblem_vault,0)=1 THEN 1 ELSE 0 END) vaults,
       SUM(CASE WHEN is_burn=1 THEN 1 ELSE 0 END) burns
     FROM address_signals`,
  );
}

/** Score histogram over the scored population — integer-binned raw scores (0..cap, the tail lumped at cap)
 *  for the distribution curve on /reputation. `expr`/`notInfra` are the same config-driven fragments the
 *  distribution + tier reads use; `cap` is an interpolated literal (not user input). */
export function reputationHistogram(db: D1Database): Promise<{ bin: number; count: number }[]> {
  return q<{ bin: number; count: number }>(
    db,
    `SELECT MIN(100,CAST(reputation AS INTEGER)) bin,COUNT(*) count
     FROM address_reputations GROUP BY bin ORDER BY bin`,
  );
}

/** One Reputation band's members, with bounds supplied by the fixed model definition. */
export function reputationTierMembers(
  db: D1Database,
  minimum: number,
  maximum: number,
  limit: number,
  offset: number,
): Promise<ReputationTopRow[]> {
  return q<ReputationTopRow>(
    db,
    `SELECT dictionary.address,ROUND(reputation.reputation,1) score,reputation.rank_position,
       signal.survived_assets,signal.assets_held,
       signal.dex_trades,signal.stamps_created,signal.dividends,signal.btc_fees
     FROM address_reputations reputation JOIN address_signals signal USING(address_id)
     JOIN address_dictionary dictionary USING(address_id)
     WHERE reputation.reputation>=? AND reputation.reputation<?
     ORDER BY reputation.reputation DESC,reputation.address_id LIMIT ? OFFSET ?`,
    minimum,
    maximum,
    limit,
    offset,
  );
}

/** Population census — the /addresses knowledge page. Three bounded scans composed into one
 *  payload; the route caches it for a day (the population moves by tens of addresses per block).
 *  Persona thresholds interpolate from reputation/config.ts, the same source the address header
 *  and collection holder-makeup use. */
export async function addressCensus(db: D1Database): Promise<AddressCensus> {
  const P = PERSONA;
  const [kindRows, personaRows, arrivalRows, tipRow] = [
    await q<
      AddressKindRow & {
        infra_exchanges: number;
        infra_deposits: number;
        infra_vaults: number;
        infra_burns: number;
        ethereum: number;
        utxo: number;
      }
    >(
      db,
      `SELECT
         CASE WHEN d.address LIKE '1%' THEN 'p2pkh' WHEN d.address LIKE '3%' THEN 'p2sh'
              WHEN d.address LIKE 'bc1q%' AND LENGTH(d.address)=42 THEN 'p2wpkh'
              WHEN d.address LIKE 'bc1q%' THEN 'p2wsh' WHEN d.address LIKE 'bc1p%' THEN 'taproot'
              WHEN d.address LIKE '0x%' THEN 'ethereum' ELSE 'utxo' END kind,
         COUNT(*) total,
         SUM(CASE WHEN s.last_block>0 THEN 1 ELSE 0 END) active,
         SUM(CASE WHEN r.reputation IS NOT NULL THEN 1 ELSE 0 END) ranked,
         MIN(CASE WHEN s.first_block>0 THEN s.first_block END) first_seen_block,
         SUM(COALESCE(s.is_exchange,0)) infra_exchanges,
         SUM(COALESCE(s.is_deposit,0)) infra_deposits,
         SUM(COALESCE(s.is_emblem_vault,0)) infra_vaults,
         SUM(COALESCE(s.is_burn,0)) infra_burns
       FROM address_dictionary d
       LEFT JOIN address_signals s ON s.address_id=d.address_id
       LEFT JOIN address_reputations r ON r.address_id=d.address_id
       GROUP BY kind`,
    ),
    await q<{ persona: string; addresses: number }>(
      db,
      `WITH classified AS (
         SELECT CASE
           WHEN s.is_exchange=1 OR s.is_deposit=1 OR s.is_emblem_vault=1 OR s.is_burn=1 THEN 'service'
           WHEN s.vault_scams+s.shell_scams+s.dump_scams > 0 THEN 'integrity'
           WHEN r.reputation IS NULL THEN 'unrated'
           ELSE (
             WITH role(k, i, ok, w) AS (
               SELECT 'creator',
                 ln(1+s.assets_issued+s.stamps_created+2*s.src20_deploys)/ln(1+${P.creatorCap}),
                 s.assets_issued+s.stamps_created+2*s.src20_deploys >= ${P.creatorFloor}, 4
               UNION ALL SELECT 'merchant', ln(1+s.dispenses)/ln(1+${P.merchantCap}), s.dispenses >= ${P.merchantFloor}, 3
               UNION ALL SELECT 'trader', ln(1+s.dex_trades)/ln(1+${P.traderCap}), s.dex_trades >= ${P.traderFloor}, 2
               UNION ALL SELECT 'collector',
                 ln(1+s.assets_held+0.5*s.assets_received)/ln(1+${P.collectorCap}), s.assets_held >= ${P.collectorFloor}, 1
             )
             SELECT COALESCE(
               (SELECT k FROM role WHERE ok ORDER BY MIN(i,1.0) DESC, w DESC LIMIT 1),
               CASE WHEN s.assets_held > 0 THEN 'light' ELSE 'dormant' END)
           )
         END persona
         FROM address_signals s
         LEFT JOIN address_reputations r ON r.address_id=s.address_id
         WHERE s.last_block > 0
       )
       SELECT persona, COUNT(*) addresses FROM classified GROUP BY persona ORDER BY addresses DESC`,
    ),
    await q<{ year: string; addresses: number }>(
      db,
      `SELECT strftime('%Y', b.block_time, 'unixepoch') year, COUNT(*) addresses
       FROM address_signals s JOIN blocks b ON b.block_index=s.first_block
       WHERE s.first_block>0 GROUP BY year ORDER BY year`,
    ),
    await one<{ tip: number }>(db, `SELECT MAX(block_index) tip FROM blocks`),
  ];
  const infrastructure = { exchanges: 0, deposits: 0, vaults: 0, burns: 0 };
  const kinds: AddressKindRow[] = [];
  let ethereum = 0;
  let utxoHoldings = 0;
  for (const row of kindRows) {
    infrastructure.exchanges += row.infra_exchanges;
    infrastructure.deposits += row.infra_deposits;
    infrastructure.vaults += row.infra_vaults;
    infrastructure.burns += row.infra_burns;
    if (row.kind === ("ethereum" as string)) ethereum = row.total;
    else if (row.kind === ("utxo" as string)) utxoHoldings = row.total;
    else {
      kinds.push({
        kind: row.kind,
        total: row.total,
        active: row.active,
        ranked: row.ranked,
        first_seen_block: row.first_seen_block,
      });
    }
  }
  kinds.sort((a, b) => b.total - a.total);
  return {
    as_of_block: tipRow?.tip ?? 0,
    kinds,
    personas: personaRows,
    infrastructure,
    ethereum,
    utxo_holdings: utxoHoldings,
    arrivals: arrivalRows,
  };
}
