import type { Env } from "#api/env";
import { parseUtxoHolder } from "#api/indexer/compact-codec";

interface SourceRow {
  rowid: number;
  [column: string]: unknown;
}

/** Copy one stable page of the small rolling rollback-checkpoint relation using its canonical identity. */
export async function reconcileBalanceSnapshotPage(env: Pick<Env, "DB" | "CORE_DB">, offset: number, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT holder,asset,block_index,quantity,coalesce(updated_event_index,0) updated_event_index
       FROM balance_snapshots ORDER BY block_index,holder,asset LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<SourceRow>();
  const addresses = new Set<string>();
  const assets = new Set<string>();
  for (const row of rows.results) {
    const holder = String(row.holder);
    if (!/^[0-9a-fA-F]{64}:(0|[1-9][0-9]*)$/.test(holder)) addresses.add(holder);
    assets.add(String(row.asset));
  }
  if (addresses.size > 0)
    await env.CORE_DB.batch(
      [...addresses].map((address) =>
        env.CORE_DB.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address),
      ),
    );
  if (assets.size > 0)
    await env.CORE_DB.batch(
      [...assets].map((asset) =>
        env.CORE_DB.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES(?)`).bind(asset),
      ),
    );
  const statements = rows.results.map((row) => {
    const holder = String(row.holder);
    if (/^[0-9a-fA-F]{64}:(0|[1-9][0-9]*)$/.test(holder)) {
      const utxo = parseUtxoHolder(holder);
      return env.CORE_DB.prepare(
        `INSERT INTO balance_snapshots(utxo_tx_hash,utxo_vout,asset_id,block_index,quantity,updated_event_index)
         SELECT ?,?,asset_id,?,?,? FROM asset_dictionary WHERE asset=?
         ON CONFLICT DO UPDATE SET quantity=excluded.quantity,updated_event_index=excluded.updated_event_index`,
      ).bind(utxo.txHash, utxo.vout, row.block_index, row.quantity, row.updated_event_index, row.asset);
    }
    return env.CORE_DB.prepare(
      `INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
       SELECT address_id,asset_id,?,?,? FROM address_dictionary,asset_dictionary
        WHERE address=? AND asset=?
       ON CONFLICT DO UPDATE SET quantity=excluded.quantity,updated_event_index=excluded.updated_event_index`,
    ).bind(row.block_index, row.quantity, row.updated_event_index, holder, row.asset);
  });
  for (let index = 0; index < statements.length; index += 80) {
    await env.CORE_DB.batch(statements.slice(index, index + 80));
  }
  return {
    processed: rows.results.length,
    next_offset: offset + rows.results.length,
    caught_up: rows.results.length < limit,
  };
}
