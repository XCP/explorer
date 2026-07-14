const UPSERT = `INSERT INTO asset_feed_counts(
  asset_id,sales,issuances,dispensers,dispenses,orders,sends,fairmints,dividends,destructions,pools,subassets,updated_at
)
SELECT identity.asset_id,
  (SELECT COUNT(*) FROM trades WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM issuances WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM dispensers WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM dispenses WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM orders WHERE give_asset_id=identity.asset_id OR get_asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM sends WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM fairmints WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM dividends WHERE asset_id=identity.asset_id OR dividend_asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM destructions WHERE asset_id=identity.asset_id),
  (SELECT COUNT(*) FROM pools WHERE asset_a_id=identity.asset_id OR asset_b_id=identity.asset_id OR lp_asset=identity.asset),
  (SELECT COUNT(*) FROM assets WHERE asset_longname LIKE identity.asset||'.%'),
  unixepoch()
FROM asset_dictionary identity WHERE identity.asset=?
ON CONFLICT(asset_id) DO UPDATE SET
  sales=excluded.sales,issuances=excluded.issuances,dispensers=excluded.dispensers,
  dispenses=excluded.dispenses,orders=excluded.orders,sends=excluded.sends,
  fairmints=excluded.fairmints,dividends=excluded.dividends,destructions=excluded.destructions,
  pools=excluded.pools,subassets=excluded.subassets,updated_at=excluded.updated_at`;

/** Recompute only identities touched by a canonical compact write batch. */
export async function rebuildCoreAssetFeedCounts(db: D1Database, assets: Iterable<string>): Promise<number> {
  const unique = [...new Set(assets)];
  for (let index = 0; index < unique.length; index += 50) {
    await db.batch(unique.slice(index, index + 50).map((asset) => db.prepare(UPSERT).bind(asset)));
  }
  return unique.length;
}

interface ChangedAsset {
  asset_id: number;
  asset: string;
  asset_longname: string | null;
}

const CHANGED_ASSET_QUERIES = [
  ["issuances", "asset_id", "block_index"],
  ["dispensers", "asset_id", "block_index"],
  ["dispenses", "asset_id", "block_index"],
  ["orders", "give_asset_id", "block_index"],
  ["orders", "get_asset_id", "block_index"],
  ["sends", "asset_id", "block_index"],
  ["fairmints", "asset_id", "block_index"],
  ["dividends", "asset_id", "block_index"],
  ["dividends", "dividend_asset_id", "block_index"],
  ["destructions", "asset_id", "block_index"],
  ["pools", "asset_a_id", "updated_block_index"],
  ["pools", "asset_b_id", "updated_block_index"],
  ["trades", "asset_id", "block_index"],
  ["assets", "asset_id", "last_issuance_block_index"],
] as const;

function parentAssets(longname: string | null): string[] {
  if (longname == null) return [];
  const parts = longname.split(".");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("."));
}

/** Close the moving-snapshot gap from compact canonical relations, without consulting the source database. */
export async function catchUpCoreAssetFeedCounts(db: D1Database, rowsPerPage = 100) {
  const state = await db
    .prepare(`SELECT key,value FROM core_state WHERE key IN ('seed_block_index','asset_feed_counts_native_cursor')`)
    .all<{ key: string; value: string }>();
  const values = new Map(state.results.map((row) => [row.key, row.value]));
  const seedBlock = Number.parseInt(values.get("seed_block_index") ?? "0", 10);
  const cursor = Number.parseInt(values.get("asset_feed_counts_native_cursor") ?? "0", 10);
  if (!Number.isSafeInteger(seedBlock) || seedBlock <= 0) throw new Error("compact seed block is missing");
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("invalid asset feed count cursor");
  const limit = Math.max(1, Math.min(rowsPerPage, 250));
  const pages = await db.batch<{ asset_id: number }>([
    ...CHANGED_ASSET_QUERIES.map(([table, column, block]) =>
      db
        .prepare(
          `SELECT DISTINCT ${column} asset_id FROM ${table}
           WHERE ${block}>? AND ${column}>? ORDER BY ${column} LIMIT ?`,
        )
        .bind(seedBlock, cursor, limit),
    ),
    db
      .prepare(
        `SELECT DISTINCT dictionary.asset_id FROM pools
         JOIN asset_dictionary dictionary ON dictionary.asset=pools.lp_asset
         WHERE pools.updated_block_index>? AND dictionary.asset_id>?
         ORDER BY dictionary.asset_id LIMIT ?`,
      )
      .bind(seedBlock, cursor, limit),
  ]);
  const ids = [...new Set(pages.flatMap((page) => page.results.map((row) => row.asset_id)))]
    .sort((left, right) => left - right)
    .slice(0, limit);
  const changed =
    ids.length === 0
      ? { results: [] as ChangedAsset[] }
      : await db
          .prepare(
            `SELECT dictionary.asset_id,dictionary.asset,assets.asset_longname
             FROM asset_dictionary dictionary LEFT JOIN assets ON assets.asset_id=dictionary.asset_id
             WHERE dictionary.asset_id IN (${ids.map(() => "?").join(",")}) ORDER BY dictionary.asset_id`,
          )
          .bind(...ids)
          .all<ChangedAsset>();
  const assets = changed.results.flatMap((row) => [row.asset, ...parentAssets(row.asset_longname)]);
  await rebuildCoreAssetFeedCounts(db, assets);
  const nextCursor = changed.results.at(-1)?.asset_id ?? cursor;
  const caughtUp = changed.results.length < limit;
  await db.batch([
    db
      .prepare(
        `INSERT INTO core_state(key,value) VALUES('asset_feed_counts_native_cursor',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .bind(nextCursor),
    db
      .prepare(
        `INSERT INTO core_state(key,value) VALUES('asset_feed_counts_native_complete',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .bind(caughtUp ? "1" : "0"),
  ]);
  return {
    processed: changed.results.length,
    recomputed: new Set(assets).size,
    cursor: nextCursor,
    caught_up: caughtUp,
  };
}
