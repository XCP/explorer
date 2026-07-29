/**
 * Collection-candidate discovery — the SQL behind GET /v2/collections/candidates. Surfaces untagged
 * assets the collector base has already chosen: ranked by how many collector-persona addresses hold
 * them through a CHOSEN acquisition path — a trade, a dispense, or a send from anyone except the
 * asset's dominant distributor. That last clause is the airdrop gate: a single address spraying an
 * asset to nine thousand wallets manufactures holders, not collectors (ground truth: XCERPASS reads
 * 81% "collectors" by raw holding and 0% by choice; FoldingCoin reads 98% by choice).
 *
 * Two bounded stages so no single D1 query approaches the CPU limit: seeds (raw collector-held
 * ranking) then chosen counts over the seeds in small batches, composed by the route.
 */
import { PERSONA } from "#api/reputation/config";
import { q } from "#api/db";

const COLLECTION_SOURCES = "'manual','issuer','discovered','collection','digirare','tokenscan'";

// The H2 global persona, collector-primary — the same thresholds the address header and the
// collection holder-makeup use (reputation/config.ts), so "collector" means one thing everywhere.
const COLLECTOR_SET = `SELECT s.address_id
  FROM address_signals s
  JOIN address_reputations r ON r.address_id=s.address_id
  WHERE s.is_exchange=0 AND s.is_deposit=0 AND s.is_emblem_vault=0 AND s.is_burn=0
    AND s.vault_scams+s.shell_scams+s.dump_scams=0 AND r.reputation IS NOT NULL
    AND s.assets_held >= ${PERSONA.collectorFloor}
    AND MIN(ln(1+s.assets_held+0.5*s.assets_received)/ln(1+${PERSONA.collectorCap}), 1.0) > MAX(
      CASE WHEN s.assets_issued+s.stamps_created+2*s.src20_deploys >= ${PERSONA.creatorFloor}
        THEN MIN(ln(1+s.assets_issued+s.stamps_created+2*s.src20_deploys)/ln(1+${PERSONA.creatorCap}), 1.0) ELSE 0 END,
      CASE WHEN s.dispenses >= ${PERSONA.merchantFloor}
        THEN MIN(ln(1+s.dispenses)/ln(1+${PERSONA.merchantCap}), 1.0) ELSE 0 END,
      CASE WHEN s.dex_trades >= ${PERSONA.traderFloor}
        THEN MIN(ln(1+s.dex_trades)/ln(1+${PERSONA.traderCap}), 1.0) ELSE 0 END)`;

export interface CandidateSeedRow {
  asset_id: number;
  asset: string;
  asset_longname: string | null;
  issuer: string | null;
  collector_holders: number;
  holders: number | null;
}

/** Stage 1: untagged assets ranked by raw collector-persona holders (airdrops still inflate this —
 *  stage 2 deflates them). Low-quality assets never seed: both the computed signal and the curated
 *  lowq set (the owner's standing verdicts, which also feed the signal on its next rebuild). */
export function collectorCandidateSeeds(db: D1Database, limit = 150): Promise<CandidateSeedRow[]> {
  return q<CandidateSeedRow>(
    db,
    `WITH collectors AS MATERIALIZED (${COLLECTOR_SET})
     SELECT b.asset_id, d.asset, a.asset_longname,
            issuer_address.address issuer,
            COUNT(DISTINCT b.address_id) collector_holders, sig.holders
     FROM balances b
     JOIN collectors c ON c.address_id=b.address_id
     JOIN asset_dictionary d ON d.asset_id=b.asset_id
     LEFT JOIN assets a ON a.asset_id=b.asset_id
     LEFT JOIN address_dictionary issuer_address ON issuer_address.address_id=a.issuer_id
     LEFT JOIN asset_signals sig ON sig.asset_id=b.asset_id
     WHERE CAST(b.quantity AS INTEGER) > 0 AND d.asset NOT IN ('XCP','BTC')
       AND COALESCE(sig.low_quality,0)=0
       AND d.asset NOT IN (SELECT key FROM curated WHERE kind='lowq')
       AND NOT EXISTS (
         SELECT 1 FROM collection_membership_evidence evidence
         JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id
         WHERE entity.entity_type='asset' AND entity.entity_key=d.asset
           AND evidence.source IN (${COLLECTION_SOURCES})
       )
     GROUP BY b.asset_id HAVING collector_holders >= 5
     ORDER BY collector_holders DESC LIMIT ?`,
    limit,
  );
}

export interface ChosenCountRow {
  asset_id: number;
  chosen_collectors: number;
}

/** Stage 2 (batch ≤ ~30 asset ids): collector holders with a CHOSEN acquisition path — any dispense,
 *  any DEX match, or a send from anyone but the asset's single widest-reaching sender. */
export function chosenCollectorCounts(db: D1Database, assetIds: number[]): Promise<ChosenCountRow[]> {
  if (assetIds.length === 0) return Promise.resolve([]);
  const placeholders = assetIds.map(() => "?").join(",");
  return q<ChosenCountRow>(
    db,
    `WITH target(asset_id) AS (SELECT asset_id FROM asset_dictionary WHERE asset_id IN (${placeholders})),
     collectors AS MATERIALIZED (${COLLECTOR_SET}),
     sender_reach AS (
       SELECT s.asset_id, s.source_id,
              ROW_NUMBER() OVER (PARTITION BY s.asset_id ORDER BY COUNT(DISTINCT s.destination_id) DESC) rn
       FROM sends s JOIN target t ON t.asset_id=s.asset_id
       GROUP BY s.asset_id, s.source_id
     ), acquirers AS (
       SELECT s.asset_id, s.destination_id address_id
       FROM sends s JOIN target t ON t.asset_id=s.asset_id
       WHERE NOT EXISTS (SELECT 1 FROM sender_reach m
                          WHERE m.asset_id=s.asset_id AND m.rn=1 AND m.source_id=s.source_id)
       UNION
       SELECT dis.asset_id, dis.destination_id FROM dispenses dis JOIN target t ON t.asset_id=dis.asset_id
       UNION
       SELECT t.asset_id, om.tx1_address_id FROM order_matches om JOIN target t ON t.asset_id=om.forward_asset_id
        WHERE om.tx1_address_id IS NOT NULL
       UNION
       SELECT t.asset_id, om.tx0_address_id FROM order_matches om JOIN target t ON t.asset_id=om.backward_asset_id
        WHERE om.tx0_address_id IS NOT NULL
     )
     SELECT b.asset_id, COUNT(DISTINCT b.address_id) chosen_collectors
     FROM balances b
     JOIN collectors c ON c.address_id=b.address_id
     JOIN acquirers acq ON acq.asset_id=b.asset_id AND acq.address_id=b.address_id
     WHERE CAST(b.quantity AS INTEGER) > 0
     GROUP BY b.asset_id`,
    ...assetIds,
  );
}
