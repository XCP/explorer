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
  AddressBalanceRow, AddressSendRow, AddressIssuanceRow, AddressDispenserRow,
  AddressDispenseRow, AddressIssuedAssetRow, AddressSummary, AddressConnectionRow,
  AddressLineageRow, ReputationDistribution, ReputationTopRow,
} from "@xcp/shared/addresses";
import type { AddressSignalsRow } from "../schema";
import { q, one } from "../db";

export interface Page { limit: number; offset: number; }

/** The address_signals row plus the read-time extras the scorer needs (XCP balance + chain tip). */
export type AddressReputationRow = AddressSignalsRow & { xcp: number | null; tip: number | null };

/** Held assets (real, non-dust), with divisibility + stamp flag, asset-sorted. */
export function listBalances(db: D1Database, addr: string, p: Page): Promise<AddressBalanceRow[]> {
  return q<AddressBalanceRow>(
    db,
    `SELECT b.asset, b.quantity, b.quantity_normalized, a.divisible, a.asset_longname,
            EXISTS(SELECT 1 FROM tags t WHERE t.entity_type='asset' AND t.entity_id=b.asset AND t.tag='stamp') stamp
     FROM balances b LEFT JOIN assets a ON a.asset=b.asset
     WHERE b.holder=? AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0
     ORDER BY b.asset LIMIT ? OFFSET ?`,
    addr, p.limit, p.offset
  );
}

/** Sends where the address is source or destination, newest first. */
export function listSends(db: D1Database, addr: string, p: Page): Promise<AddressSendRow[]> {
  return q<AddressSendRow>(
    db,
    `SELECT tx_hash, block_index, block_time, source, destination, asset, quantity_normalized, send_type, status
     FROM sends WHERE source=? OR destination=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    addr, addr, p.limit, p.offset
  );
}

/** Issuances the address made or received (transfer), newest first. */
export function listIssuances(db: D1Database, addr: string, p: Page): Promise<AddressIssuanceRow[]> {
  return q<AddressIssuanceRow>(
    db,
    `SELECT tx_hash, block_index, block_time, asset, asset_longname, quantity_normalized, transfer, issuer, description, asset_events, status
     FROM issuances WHERE source=? OR issuer=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    addr, addr, p.limit, p.offset
  );
}

/** Dispensers opened by the address, newest first. */
export function listDispensers(db: D1Database, addr: string, p: Page): Promise<AddressDispenserRow[]> {
  return q<AddressDispenserRow>(
    db,
    `SELECT tx_hash,block_index,block_time,source,asset,give_quantity_normalized,give_remaining_normalized,satoshirate,satoshirate_normalized,dispense_count,status FROM dispensers WHERE source=? ORDER BY block_index DESC LIMIT ? OFFSET ?`,
    addr, p.limit, p.offset
  );
}

/** Dispenses the address triggered or received, newest first. */
export function listDispenses(db: D1Database, addr: string, p: Page): Promise<AddressDispenseRow[]> {
  return q<AddressDispenseRow>(
    db,
    `SELECT d.tx_hash,d.block_index,d.block_time,d.source,d.destination,d.asset,d.dispense_quantity_normalized,d.dispenser_tx_hash,d.btc_amount,t.usd_value
     FROM dispenses d LEFT JOIN trades t ON t.venue='dispense' AND t.ref=CAST(d.id AS TEXT)
     WHERE d.source=? OR d.destination=? ORDER BY d.block_index DESC LIMIT ? OFFSET ?`,
    addr, addr, p.limit, p.offset
  );
}

/** Assets the address issued or owns, newest issuance first. */
export function listIssued(db: D1Database, addr: string, p: Page): Promise<AddressIssuedAssetRow[]> {
  return q<AddressIssuedAssetRow>(
    db,
    `SELECT asset, asset_longname, divisible, locked, issuer, first_issuance_block_index FROM assets
     WHERE issuer=? OR owner=? ORDER BY first_issuance_block_index DESC LIMIT ? OFFSET ?`,
    addr, addr, p.limit, p.offset
  );
}

/** Identity header counts (XCP balance, held/issued/dispenser/order counts, activity span, disp trust). */
export function addressSummary(db: D1Database, addr: string): Promise<AddressSummary | null> {
  return one<AddressSummary>(
    db,
    `SELECT (SELECT quantity_normalized FROM balances WHERE holder=? AND asset='XCP') xcp,
            (SELECT COUNT(*) FROM balances WHERE holder=? AND holder_type='address' AND CAST(quantity AS INTEGER)>0) assets,
            (SELECT COUNT(*) FROM assets WHERE issuer=?) issued,
            (SELECT COUNT(*) FROM dispensers WHERE source=?) dispensers,
            (SELECT COUNT(*) FROM dispensers WHERE source=? AND status=0) open_dispensers,
            (SELECT COUNT(*) FROM orders WHERE source=? AND status='open') open_orders,
            (SELECT MIN(block_index) FROM sends WHERE source=? OR destination=?) first_block,
            (SELECT MAX(block_index) FROM sends WHERE source=? OR destination=?) last_block,
            (SELECT ROUND(disp_trust,1) FROM address_signals WHERE addr=?) dispenser_trust`,
    addr, addr, addr, addr, addr, addr, addr, addr, addr, addr, addr
  );
}

/** The precomputed address_signals row + XCP balance + chain tip, for the reputation scorer. */
export function addressReputationRow(db: D1Database, addr: string): Promise<AddressReputationRow | null> {
  return one<AddressReputationRow>(
    db,
    `SELECT sg.*, (SELECT CAST(quantity_normalized AS REAL) FROM balances WHERE holder=? AND asset='XCP') xcp,
            (SELECT MAX(block_index) FROM blocks) tip
     FROM address_signals sg WHERE sg.addr=?`,
    addr, addr
  );
}

/** Top counterparties merged across sends + dispenses + DEX order-matches (excludes self + deposit plumbing). */
export function addressConnections(db: D1Database, addr: string, limit: number): Promise<AddressConnectionRow[]> {
  return q<AddressConnectionRow>(
    db,
    `SELECT g.cp, g.interactions, COALESCE(sg.is_exchange,0) is_exchange FROM (
        SELECT cp, SUM(n) interactions FROM (
          SELECT CASE WHEN source=? THEN destination ELSE source END cp, COUNT(*) n
            FROM sends WHERE (source=? OR destination=?) AND destination IS NOT NULL GROUP BY cp
          UNION ALL
          SELECT CASE WHEN source=? THEN destination ELSE source END cp, COUNT(*) n
            FROM dispenses WHERE source=? OR destination=? GROUP BY cp
          UNION ALL
          SELECT CASE WHEN tx0_address=? THEN tx1_address ELSE tx0_address END cp, COUNT(*) n
            FROM order_matches WHERE tx0_address=? OR tx1_address=? GROUP BY cp
        ) WHERE cp IS NOT NULL AND cp<>? GROUP BY cp
     ) g LEFT JOIN address_signals sg ON sg.addr=g.cp
     WHERE COALESCE(sg.is_deposit,0)=0 ORDER BY g.interactions DESC LIMIT ?`,
    addr, addr, addr, addr, addr, addr, addr, addr, addr, addr, limit
  );
}

/** Sweep-based identity lineage — swept-to / swept-from links (strongest "same person" on-chain signal). */
export function addressLineage(db: D1Database, addr: string): Promise<AddressLineageRow[]> {
  return q<AddressLineageRow>(
    db,
    `SELECT 'out' direction, destination counterparty, block_index, block_time FROM sweeps WHERE source=?
     UNION ALL
     SELECT 'in' direction, source counterparty, block_index, block_time FROM sweeps WHERE destination=?
     ORDER BY block_index`,
    addr, addr
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
  db: D1Database, expr: string, notInfra: string, vetCut: number, estCut: number, actCut: number
): Promise<ReputationDistribution | null> {
  return one<ReputationDistribution>(
    db,
    `WITH r AS (SELECT (${expr}) raw FROM address_signals WHERE ${notInfra})
     SELECT COUNT(*) n, ROUND(AVG(raw),2) mean, ROUND(MAX(raw),2) max,
       SUM(CASE WHEN raw>=${vetCut} THEN 1 ELSE 0 END) og,
       SUM(CASE WHEN raw>=${estCut} AND raw<${vetCut} THEN 1 ELSE 0 END) established,
       SUM(CASE WHEN raw>=${actCut} AND raw<${estCut} THEN 1 ELSE 0 END) active,
       SUM(CASE WHEN raw<${actCut} THEN 1 ELSE 0 END) casual
     FROM r`
  );
}

/** Top of the population table — spot-check that high scorers are credible. */
export function reputationTop(db: D1Database, expr: string, notInfra: string): Promise<ReputationTopRow[]> {
  return q<ReputationTopRow>(
    db,
    `SELECT addr, ROUND((${expr}),2) raw, survived_assets, assets_held, dex_trades, stamps_created, dividends, btc_fees
     FROM address_signals WHERE ${notInfra} ORDER BY (${expr}) DESC LIMIT 20`
  );
}

/** The scoring funnel: every address in the mirror, split into infrastructure (by kind) vs the rest. The
 *  read layer derives no-history = total − infrastructure − scored. Powers the /reputation "who counts" act. */
export function reputationFunnel(db: D1Database): Promise<{
  total: number; infra: number; exchanges: number; deposits: number; vaults: number; burns: number; services: number;
} | null> {
  return one<{ total: number; infra: number; exchanges: number; deposits: number; vaults: number; burns: number; services: number }>(
    db,
    `SELECT COUNT(*) total,
       SUM(CASE WHEN is_exchange=1 OR is_deposit=1 OR is_burn=1 OR COALESCE(is_emblem_vault,0)=1 OR COALESCE(likely_service,0)=1 THEN 1 ELSE 0 END) infra,
       SUM(CASE WHEN is_exchange=1 THEN 1 ELSE 0 END) exchanges,
       SUM(CASE WHEN is_deposit=1 THEN 1 ELSE 0 END) deposits,
       SUM(CASE WHEN COALESCE(is_emblem_vault,0)=1 THEN 1 ELSE 0 END) vaults,
       SUM(CASE WHEN is_burn=1 THEN 1 ELSE 0 END) burns,
       SUM(CASE WHEN COALESCE(likely_service,0)=1 THEN 1 ELSE 0 END) services
     FROM address_signals`
  );
}

/** Score histogram over the scored population — integer-binned raw scores (0..cap, the tail lumped at cap)
 *  for the distribution curve on /reputation. `expr`/`notInfra` are the same config-driven fragments the
 *  distribution + tier reads use; `cap` is an interpolated literal (not user input). */
export function reputationHistogram(
  db: D1Database, expr: string, notInfra: string, cap: number
): Promise<{ bin: number; count: number }[]> {
  return q<{ bin: number; count: number }>(
    db,
    `WITH r AS (SELECT MAX(0, MIN(${cap}, CAST((${expr}) AS INTEGER))) b FROM address_signals WHERE ${notInfra})
     SELECT b bin, COUNT(*) count FROM r GROUP BY b ORDER BY b`
  );
}

/** One reputation tier's membership — real users whose raw score falls in [minRaw, maxRaw), ranked. The
 *  bounds are config-sourced tier cutoffs (interpolated, not user input); the caller passes a large sentinel
 *  for the top (OG) tier's open upper bound. Powers the /reputation/:tier deep-link leaderboard. */
export function reputationTierMembers(
  db: D1Database, expr: string, notInfra: string, minRaw: number, maxRaw: number, limit: number, offset: number
): Promise<ReputationTopRow[]> {
  return q<ReputationTopRow>(
    db,
    `SELECT addr, ROUND((${expr}),2) raw, survived_assets, assets_held, dex_trades, stamps_created, dividends, btc_fees
     FROM address_signals WHERE ${notInfra} AND (${expr})>=${minRaw} AND (${expr})<${maxRaw}
     ORDER BY (${expr}) DESC LIMIT ? OFFSET ?`,
    limit, offset
  );
}
