import type { Env } from "#api/env";
import { parseUtxoHolder } from "#api/indexer/compact-codec";
import { getCoreState } from "#api/indexer/core-state";
export const CORE_RECENT_PROJECTIONS = [
  "address_signals",
  "asset_signals",
  "asset_feed_counts",
  "exchange_top_assets",
] as const;
export type CoreRecentProjection = (typeof CORE_RECENT_PROJECTIONS)[number];

interface SourceRow {
  rowid: number;
  [column: string]: unknown;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
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

const ASSET_SIGNAL_COLUMNS = [
  "divisible",
  "locked",
  "holders",
  "top1_pct",
  "trades",
  "self_trade_pct",
  "first_trade_blk",
  "last_trade_blk",
  "dispenses",
  "dispense_btc",
  "low_quality",
  "holder_breadth",
  "pct_creator_holders",
  "burned_pct",
  "distinct_traders",
  "distinct_dispensers",
  "age_blocks",
  "avg_holder_dex",
  "recent_events",
  "recency_blocks",
  "max_dispense_btc",
  "max_trade_xcp",
  "supply",
  "max_realized_usd",
  "distinct_dispense_buyers",
  "max_dispense_btc_clean",
  "emblem_trades",
  "graph_trust",
  "graph_distrust",
  "holder_cohesion",
  "cohesion_edges",
  "cohesion_strong",
] as const;

const FEED_COLUMNS = [
  "sales",
  "issuances",
  "dispensers",
  "dispenses",
  "orders",
  "sends",
  "fairmints",
  "dividends",
  "destructions",
  "pools",
  "subassets",
  "updated_at",
] as const;

function upsertSet(columns: readonly string[]): string {
  return columns.map((column) => `${column}=excluded.${column}`).join(",");
}

function addressSignalValue(row: SourceRow, column: (typeof ADDRESS_SIGNAL_COLUMNS)[number]): unknown {
  if (column === "first_block") return row[column] ?? null;
  if (column === "rep_score") return row[column] ?? 1;
  return row[column] ?? 0;
}

function assetSignalValue(row: SourceRow, column: (typeof ASSET_SIGNAL_COLUMNS)[number]): unknown {
  if (["divisible", "locked", "holder_cohesion", "cohesion_edges", "cohesion_strong"].includes(column)) {
    return row[column] ?? null;
  }
  return row[column] ?? 0;
}

async function relationCount(db: D1Database, table: string): Promise<number> {
  return Number((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())?.count ?? 0);
}

/**
 * Reconcile rows appended while the source snapshot was being imported. These three source projections are
 * append-only by identity, so the compact count is also the first unimported source rowid. Existing identities
 * continue to be maintained by event replay; this closes only the snapshot's moving-tail interval.
 */
export async function reconcileRecentCoreProjection(env: Pick<Env, "DB" | "CORE_DB">, scope: CoreRecentProjection) {
  const seedBlock = Number.parseInt((await getCoreState(env.CORE_DB, "seed_block_index")) ?? "0", 10);
  if (!Number.isSafeInteger(seedBlock) || seedBlock <= 0) throw new Error("compact seed block is missing");
  const empty = { results: [] as SourceRow[] };
  const addresses =
    scope === "address_signals"
      ? await env.DB.prepare(`SELECT rowid,* FROM address_signals WHERE rowid>? ORDER BY rowid`)
          .bind(await relationCount(env.CORE_DB, "address_signals"))
          .all<SourceRow>()
      : empty;
  const assets =
    scope === "asset_signals"
      ? await env.DB.prepare(`SELECT rowid,* FROM asset_signals WHERE rowid>? ORDER BY rowid`)
          .bind(await relationCount(env.CORE_DB, "asset_signals"))
          .all<SourceRow>()
      : empty;
  const feeds =
    scope === "asset_feed_counts"
      ? await env.DB.prepare(`SELECT rowid,* FROM asset_feed_counts WHERE rowid>? ORDER BY rowid`)
          .bind(await relationCount(env.CORE_DB, "asset_feed_counts"))
          .all<SourceRow>()
      : empty;
  const exchange =
    scope === "exchange_top_assets"
      ? await env.DB.prepare(
          `SELECT generation,asset,depositors FROM exchange_top_assets ORDER BY generation,asset`,
        ).all<SourceRow>()
      : empty;
  const assetNames = assets.results.map((row) => String(row.asset));

  const addressNames = new Set<string>();
  for (const row of addresses.results) addressNames.add(String(row.address));
  for (const row of assets.results) if (nullableString(row.issuer)) addressNames.add(String(row.issuer));
  const allAssets = new Set<string>([
    ...assetNames,
    ...feeds.results.map((row) => String(row.asset)),
    ...exchange.results.map((row) => String(row.asset)),
  ]);
  if (addressNames.size > 0)
    await env.CORE_DB.batch(
      [...addressNames].map((address) =>
        env.CORE_DB.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address),
      ),
    );
  if (allAssets.size > 0)
    await env.CORE_DB.batch(
      [...allAssets].map((asset) =>
        env.CORE_DB.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES(?)`).bind(asset),
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

  const assetSql = `INSERT INTO asset_signals(asset_id,issuer_id,${ASSET_SIGNAL_COLUMNS.join(",")})
    VALUES((SELECT asset_id FROM asset_dictionary WHERE asset=?),
           (SELECT address_id FROM address_dictionary WHERE address=?),${ASSET_SIGNAL_COLUMNS.map(() => "?").join(",")})
    ON CONFLICT(asset_id) DO UPDATE SET issuer_id=excluded.issuer_id,${upsertSet(ASSET_SIGNAL_COLUMNS)}`;
  for (let index = 0; index < assets.results.length; index += 80)
    await env.CORE_DB.batch(
      assets.results
        .slice(index, index + 80)
        .map((row) =>
          env.CORE_DB.prepare(assetSql).bind(
            row.asset,
            row.issuer ?? null,
            ...ASSET_SIGNAL_COLUMNS.map((column) => assetSignalValue(row, column)),
          ),
        ),
    );

  const feedSql = `INSERT INTO asset_feed_counts(asset_id,${FEED_COLUMNS.join(",")})
    VALUES((SELECT asset_id FROM asset_dictionary WHERE asset=?),${FEED_COLUMNS.map(() => "?").join(",")})
    ON CONFLICT(asset_id) DO UPDATE SET ${upsertSet(FEED_COLUMNS)}`;
  for (let index = 0; index < feeds.results.length; index += 80)
    await env.CORE_DB.batch(
      feeds.results
        .slice(index, index + 80)
        .map((row) => env.CORE_DB.prepare(feedSql).bind(row.asset, ...FEED_COLUMNS.map((column) => row[column] ?? 0))),
    );

  for (let index = 0; index < exchange.results.length; index += 80)
    await env.CORE_DB.batch(
      exchange.results.slice(index, index + 80).map((row) =>
        env.CORE_DB.prepare(
          `INSERT INTO exchange_top_assets(generation,asset_id,depositors)
       SELECT ?,asset_id,? FROM asset_dictionary WHERE asset=?
       ON CONFLICT(generation,asset_id) DO UPDATE SET depositors=excluded.depositors`,
        ).bind(row.generation, row.depositors, row.asset),
      ),
    );

  return {
    scope,
    seed_block: seedBlock,
    processed: addresses.results.length + assets.results.length + feeds.results.length + exchange.results.length,
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
