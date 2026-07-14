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
} from "@xcp/shared/addresses";
import type { AddressSignalsRow } from "#api/storage-types";
import { q, one } from "#api/db";
import { ADDRESS_LEDGER_SQL } from "#api/queries/compact-ledger";

export interface Page {
  limit: number;
  offset: number;
}

/** The address_signals row plus the read-time extras the scorer needs (XCP balance + chain tip). */
export type AddressReputationRow = AddressSignalsRow & { xcp: number | null; tip: number | null };

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
     SELECT signal.*,
            (SELECT CAST(balance.quantity_normalized AS REAL) FROM balances balance
              WHERE balance.address_id=signal.address_id
                AND balance.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')) xcp,
            (SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1) tip
       FROM address_signals signal
      WHERE signal.address_id=(SELECT address_id FROM identity)`,
    address,
  );
}

/** Top counterparties merged across sends + dispenses + DEX order-matches (excludes self + deposit plumbing). */
export function addressConnections(db: D1Database, address: string, limit: number): Promise<AddressConnectionRow[]> {
  return q<AddressConnectionRow>(
    db,
    `WITH identity AS (SELECT address_id FROM address_dictionary WHERE address=?1), edges AS (
       SELECT destination_id cp,COUNT(*) n FROM sends
        WHERE source_id=(SELECT address_id FROM identity) AND destination_id IS NOT NULL GROUP BY destination_id
       UNION ALL
       SELECT source_id cp,COUNT(*) n FROM sends
        WHERE destination_id=(SELECT address_id FROM identity) AND source_id IS NOT NULL GROUP BY source_id
       UNION ALL
       SELECT destination_id cp,COUNT(*) n FROM dispenses
        WHERE source_id=(SELECT address_id FROM identity) GROUP BY destination_id
       UNION ALL
       SELECT source_id cp,COUNT(*) n FROM dispenses
        WHERE destination_id=(SELECT address_id FROM identity) GROUP BY source_id
       UNION ALL
       SELECT tx1_address_id cp,COUNT(*) n FROM order_matches
        WHERE tx0_address_id=(SELECT address_id FROM identity) GROUP BY tx1_address_id
       UNION ALL
       SELECT tx0_address_id cp,COUNT(*) n FROM order_matches
        WHERE tx1_address_id=(SELECT address_id FROM identity) GROUP BY tx0_address_id
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

/* ---------- reputation calibration (/v2/reputation/review) ---------- */
// `expr` (raw-score SQL) and `notInfra` (population filter) are composed in the handler from reputation/config
// via rawSqlExpr — config-derived, not request input. The query owns only the surrounding aggregate/select.

/** Chain tip block height (0 if none), the base for age terms in the calibration expression. */
export function maxBlockIndex(db: D1Database): Promise<{ m: number | null } | null> {
  return one<{ m: number | null }>(db, `SELECT MAX(block_index) m FROM blocks`);
}

/** Population raw-score band counts across the tier boundaries (one GROUP BY, no window sort). */
export function reputationDistribution(
  db: D1Database,
  expr: string,
  notInfra: string,
  vetCut: number,
  estCut: number,
  actCut: number,
): Promise<ReputationDistribution | null> {
  return one<ReputationDistribution>(
    db,
    `WITH r AS (SELECT (${expr}) raw FROM address_signals WHERE ${notInfra})
     SELECT COUNT(*) n, ROUND(AVG(raw),2) mean, ROUND(MAX(raw),2) max,
       SUM(CASE WHEN raw>=${vetCut} THEN 1 ELSE 0 END) og,
       SUM(CASE WHEN raw>=${estCut} AND raw<${vetCut} THEN 1 ELSE 0 END) established,
       SUM(CASE WHEN raw>=${actCut} AND raw<${estCut} THEN 1 ELSE 0 END) active,
       SUM(CASE WHEN raw<${actCut} THEN 1 ELSE 0 END) casual
     FROM r`,
  );
}

/** Top of the population table — spot-check that high scorers are credible. */
export function reputationTop(db: D1Database, expr: string, notInfra: string): Promise<ReputationTopRow[]> {
  return q<ReputationTopRow>(
    db,
    `SELECT dictionary.address,ROUND((${expr}),2) raw,signal.survived_assets,signal.assets_held,
       signal.dex_trades,signal.stamps_created,signal.dividends,signal.btc_fees
     FROM address_signals signal JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
     WHERE ${notInfra} ORDER BY (${expr}) DESC LIMIT 20`,
  );
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
  services: number;
} | null> {
  return one<{ infra: number; exchanges: number; deposits: number; vaults: number; burns: number; services: number }>(
    db,
    `SELECT
       SUM(CASE WHEN is_exchange=1 OR is_deposit=1 OR is_burn=1 OR COALESCE(is_emblem_vault,0)=1 OR COALESCE(likely_service,0)=1 THEN 1 ELSE 0 END) infra,
       SUM(CASE WHEN is_exchange=1 THEN 1 ELSE 0 END) exchanges,
       SUM(CASE WHEN is_deposit=1 THEN 1 ELSE 0 END) deposits,
       SUM(CASE WHEN COALESCE(is_emblem_vault,0)=1 THEN 1 ELSE 0 END) vaults,
       SUM(CASE WHEN is_burn=1 THEN 1 ELSE 0 END) burns,
       SUM(CASE WHEN COALESCE(likely_service,0)=1 THEN 1 ELSE 0 END) services
     FROM address_signals`,
  );
}

/** Score histogram over the scored population — integer-binned raw scores (0..cap, the tail lumped at cap)
 *  for the distribution curve on /reputation. `expr`/`notInfra` are the same config-driven fragments the
 *  distribution + tier reads use; `cap` is an interpolated literal (not user input). */
export function reputationHistogram(
  db: D1Database,
  expr: string,
  notInfra: string,
  cap: number,
): Promise<{ bin: number; count: number }[]> {
  return q<{ bin: number; count: number }>(
    db,
    `WITH r AS (SELECT MAX(0, MIN(${cap}, CAST((${expr}) AS INTEGER))) b FROM address_signals WHERE ${notInfra})
     SELECT b bin, COUNT(*) count FROM r GROUP BY b ORDER BY b`,
  );
}

/** One reputation tier's membership — real users whose raw score falls in [minRaw, maxRaw), ranked. The
 *  bounds are config-sourced tier cutoffs (interpolated, not user input); the caller passes a large sentinel
 *  for the top (OG) tier's open upper bound. Powers the /reputation/:tier deep-link leaderboard. */
export function reputationTierMembers(
  db: D1Database,
  expr: string,
  notInfra: string,
  minRaw: number,
  maxRaw: number,
  limit: number,
  offset: number,
): Promise<ReputationTopRow[]> {
  return q<ReputationTopRow>(
    db,
    `SELECT dictionary.address,ROUND((${expr}),2) raw,signal.survived_assets,signal.assets_held,
       signal.dex_trades,signal.stamps_created,signal.dividends,signal.btc_fees
     FROM address_signals signal JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
     WHERE ${notInfra} AND (${expr})>=${minRaw} AND (${expr})<${maxRaw}
     ORDER BY (${expr}) DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}
