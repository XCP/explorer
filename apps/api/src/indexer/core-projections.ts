import type { Env } from "#api/env";
import { parseUtxoHolder } from "#api/indexer/compact-codec";
import { getCoreState } from "#api/indexer/core-state";
export const CORE_RECENT_PROJECTIONS = ["address_signals"] as const;
export type CoreRecentProjection = (typeof CORE_RECENT_PROJECTIONS)[number];

interface SourceRow {
  rowid: number;
  [column: string]: unknown;
}

const ADDRESS_SIGNAL_COLUMNS = [
  "first_block",
  "last_block",
  "out_peers",
  "in_peers",
  "dispense_btc",
  "dispenses",
  "dividends",
  "assets_issued",
  "locked_assets",
  "btc_spent",
  "btc_fees",
  "assets_held",
  "assets_received",
  "survived_assets",
  "assets_distributed",
  "assets_hits",
  "rep_score",
  "clean_dispense_btc",
  "clean_btc_spent",
  "is_exchange",
  "is_deposit",
  "is_burn",
  "assets_burned",
  "disp_trust",
  "is_emblem_vault",
  "likely_service",
  "dex_trades",
  "stamps_created",
  "stamps_collected",
  "src20_deploys",
  "is_btns_user",
  "graph_trust",
  "graph_distrust",
  "vault_scams",
  "shell_scams",
  "dump_scams",
] as const;

function upsertSet(columns: readonly string[]): string {
  return columns.map((column) => `${column}=excluded.${column}`).join(",");
}

function addressSignalValue(row: SourceRow, column: (typeof ADDRESS_SIGNAL_COLUMNS)[number]): unknown {
  if (column === "first_block") return row[column] ?? null;
  if (column === "rep_score") return row[column] ?? 1;
  return row[column] ?? 0;
}

async function relationCount(db: D1Database, table: string): Promise<number> {
  return Number((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())?.count ?? 0);
}

/**
 * Close the append-only address-signal tail that moved while its source snapshot was imported. Compact-native
 * owners maintain every other projection directly; they must never be overwritten from the source database.
 */
export async function reconcileRecentCoreProjection(env: Pick<Env, "DB" | "CORE_DB">, _scope: CoreRecentProjection) {
  const seedBlock = Number.parseInt((await getCoreState(env.CORE_DB, "seed_block_index")) ?? "0", 10);
  if (!Number.isSafeInteger(seedBlock) || seedBlock <= 0) throw new Error("compact seed block is missing");
  const addresses = await env.DB.prepare(`SELECT rowid,* FROM address_signals WHERE rowid>? ORDER BY rowid`)
    .bind(await relationCount(env.CORE_DB, "address_signals"))
    .all<SourceRow>();

  const addressNames = new Set<string>();
  for (const row of addresses.results) addressNames.add(String(row.address));
  if (addressNames.size > 0)
    await env.CORE_DB.batch(
      [...addressNames].map((address) =>
        env.CORE_DB.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address),
      ),
    );

  const addressSql = `INSERT INTO address_signals(address_id,${ADDRESS_SIGNAL_COLUMNS.join(",")})
    VALUES((SELECT address_id FROM address_dictionary WHERE address=?),${ADDRESS_SIGNAL_COLUMNS.map(() => "?").join(",")})
    ON CONFLICT(address_id) DO UPDATE SET ${upsertSet(ADDRESS_SIGNAL_COLUMNS)}`;
  for (let index = 0; index < addresses.results.length; index += 80)
    await env.CORE_DB.batch(
      addresses.results
        .slice(index, index + 80)
        .map((row) =>
          env.CORE_DB.prepare(addressSql).bind(
            row.address,
            ...ADDRESS_SIGNAL_COLUMNS.map((column) => addressSignalValue(row, column)),
          ),
        ),
    );

  return {
    scope: "address_signals" as const,
    seed_block: seedBlock,
    processed: addresses.results.length,
  };
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
