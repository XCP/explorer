/**
 * Bitcoin Counters (bitcoincounters.com) — files embedded in Bitcoin witness data, owned through
 * Counterparty assets and numbered gap-free by an external reference indexer. Witness data is
 * invisible from the Counterparty mirror, so this is a trust-but-verify sync: take the reference
 * server's counter list and tag each asset like a stamp (tag='counter'), but ONLY when both facts
 * check out against our own mirror — the asset exists and the counter's mint transaction is a
 * Counterparty transaction we indexed. source='counters' survives the computed-tag rebuild (same
 * contract as the collection sources); numbering authority stays with the reference indexer, and
 * meta carries {number, envelope, content_type} from the ORIGINAL (lowest-numbered) counter.
 */
import { type CounterListing, fetchCounterList } from "#api/integrations/bitcoin-counters";
import { hashToBytes } from "#api/indexer/identities";

export interface CounterSyncReport {
  listed: number;
  assets: number;
  tagged: number;
  unverified: string[]; // "asset#number: reason" — reference rows our mirror could not confirm
}

export async function syncCounterTags(db: D1Database): Promise<CounterSyncReport> {
  return applyCounterTags(db, await fetchCounterList());
}

export async function applyCounterTags(db: D1Database, listed: CounterListing[]): Promise<CounterSyncReport> {
  // One tag per asset, carrying its original (lowest-numbered) counter — reinscriptions add
  // provenance on the reference site, not extra tags here.
  const original = new Map<string, CounterListing>();
  for (const counter of [...listed].sort((a, b) => a.number - b.number)) {
    if (!original.has(counter.asset)) original.set(counter.asset, counter);
  }
  const report: CounterSyncReport = { listed: listed.length, assets: original.size, tagged: 0, unverified: [] };
  for (const counter of original.values()) {
    const label = `${counter.asset}#${counter.number}`;
    const known = await db
      .prepare(`SELECT asset_id FROM asset_dictionary WHERE asset=?`)
      .bind(counter.asset)
      .first<{ asset_id: number }>();
    if (!known) {
      report.unverified.push(`${label}: asset not in mirror`);
      continue;
    }
    const minted = await db
      .prepare(`SELECT tx_index FROM transactions WHERE tx_hash=?`)
      .bind(hashToBytes(counter.txid))
      .first<{ tx_index: number }>();
    if (!minted) {
      report.unverified.push(`${label}: mint tx not in mirror`);
      continue;
    }
    await db.batch([
      db
        .prepare(`INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key) VALUES('asset',?)`)
        .bind(counter.asset),
      db
        .prepare(
          `INSERT INTO tags(entity_id,tag,source,meta)
           SELECT entity_id,'counter','counters',? FROM entity_dictionary
           WHERE entity_type='asset' AND entity_key=?
           ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
        )
        .bind(
          JSON.stringify({ number: counter.number, envelope: counter.envelope, content_type: counter.content_type }),
          counter.asset,
        ),
    ]);
    report.tagged++;
  }
  return report;
}
