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
