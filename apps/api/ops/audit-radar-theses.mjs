#!/usr/bin/env node

/**
 * Measure whether the canonical database can support two distinct Radar theses:
 *
 * - dislocation: an established market is currently offered below a robust prior range;
 * - new: credible adoption is forming before a durable market history exists.
 *
 * This is a coverage audit, not a ranking model. In particular, current balances and offers must never be
 * joined into historical cutoffs and described as though they existed then. Run from apps/api with:
 *
 *   npm run audit:radar
 */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { pathToFileURL } from "node:url";

export const RADAR_COVERAGE_QUERIES = {
  market: `SELECT COUNT(*) trades,COUNT(DISTINCT asset_id) assets,
    COUNT(DISTINCT CASE WHEN usd_value>0 THEN asset_id END) usd_assets,
    MIN(block_time) first_time,MAX(block_time) last_time
    FROM trades`,
  venues: `SELECT venue,COUNT(*) trades,COUNT(DISTINCT asset_id) assets,
    SUM(usd_value IS NOT NULL AND usd_value>0) usd_rows
    FROM trades GROUP BY venue ORDER BY trades DESC`,
  current_supply: `SELECT COUNT(*) signals,SUM(supply<=300) supply_le_300,
    SUM(supply>300 AND supply<=1000) supply_301_1000,
    SUM(top1_pct>=50) top_holder_at_least_half,SUM(holders>=2) multiple_holders
    FROM asset_signals WHERE low_quality=0 AND supply>0`,
  collection_evidence: `SELECT COUNT(DISTINCT entity_id) member_assets,
    COUNT(DISTINCT CASE WHEN sources>=2 THEN entity_id END) corroborated_assets
    FROM (SELECT entity_id,tag,COUNT(*) sources
      FROM collection_membership_evidence GROUP BY entity_id,tag)`,
  current_offers: `SELECT
    (SELECT COUNT(DISTINCT asset_id) FROM dispensers
      WHERE status=0 AND CAST(give_remaining_normalized AS REAL)>0) dispenser_assets,
    (SELECT COUNT(DISTINCT asset_id) FROM emblem_listings
      WHERE asset_id IS NOT NULL AND price_usd>0
        AND (expiry=0 OR expiry>=unixepoch())) emblem_assets`,
  balance_snapshots: `SELECT COUNT(*) rows,COUNT(DISTINCT asset_id) assets,
    MIN(block_index) min_block,MAX(block_index) max_block FROM balance_snapshots`,
  ownership_ledger: `SELECT COUNT(*) events,COUNT(DISTINCT asset_id) assets,
    COUNT(DISTINCT address_id) holder_identities,MIN(block_index) min_block,MAX(block_index) max_block
    FROM ledger_events`,
  polymorphic_holders: `SELECT
    SUM(instr(dictionary.address,':')=0) address_events,
    SUM(instr(dictionary.address,':')>0) utxo_events,
    COUNT(DISTINCT CASE WHEN instr(dictionary.address,':')>0 THEN event.address_id END) utxo_identities
    FROM ledger_events event JOIN address_dictionary dictionary ON dictionary.address_id=event.address_id`,
};

function run() {
  const measuredAt = new Date().toISOString();
  const results = Object.fromEntries(
    Object.entries(RADAR_COVERAGE_QUERIES).map(([name, sql]) => {
      const result = executeRemoteD1(sql);
      return [name, { rows: result.rows, query_ms: result.meta?.timings?.sql_duration_ms ?? null }];
    }),
  );

  console.log(
    JSON.stringify(
      {
        measured_at: measuredAt,
        purpose: "coverage only; no production ranking decision",
        results,
        constraints: {
          historical_offers:
            "Counterparty dispenser lifecycle can be reconstructed; current Emblem listings cannot be projected backward.",
          historical_ownership:
            "Current balances are descriptive only. Historical concentration requires exact-integer, cutoff-safe ledger reconstruction preserving address and txid:vout holders.",
          issuer_exception:
            "Needs issuer identity plus cutoff-safe issuer balance and outflow/sale history; current top1_pct is insufficient.",
        },
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
