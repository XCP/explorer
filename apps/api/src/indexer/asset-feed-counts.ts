export const FEED_COUNT_COLUMNS = [
  "sales", "issuances", "dispensers", "dispenses", "orders",
  "sends", "fairmints", "dividends", "destructions", "pools", "subassets",
] as const;

export type FeedCountColumn = typeof FEED_COUNT_COLUMNS[number];

/** Canonical one-row-per-record projections used by both the rebuild and its parity tests. */
export const ASSET_FEED_COUNT_SOURCES: Record<FeedCountColumn, {
  reads: string[];
  sql: string;
  heavy?: boolean;
}> = {
  sales: { reads: ["trades"], sql: `SELECT asset FROM trades` },
  issuances: { reads: ["issuances"], sql: `SELECT asset FROM issuances` },
  dispensers: { reads: ["dispensers"], sql: `SELECT asset FROM dispensers` },
  dispenses: { reads: ["dispenses"], sql: `SELECT asset FROM dispenses` },
  orders: { reads: ["orders"], sql: `
    SELECT give_asset asset FROM orders
    UNION ALL SELECT get_asset FROM orders WHERE get_asset IS NOT give_asset` },
  sends: { reads: ["sends"], sql: `SELECT asset FROM sends`, heavy: true },
  fairmints: { reads: ["fairmints"], sql: `SELECT asset FROM fairmints` },
  dividends: { reads: ["dividends"], sql: `
    SELECT asset FROM dividends
    UNION ALL SELECT dividend_asset FROM dividends WHERE dividend_asset IS NOT asset` },
  destructions: { reads: ["destructions"], sql: `SELECT asset FROM destructions` },
  pools: { reads: ["pools"], sql: `
    SELECT asset_a asset FROM pools
    UNION ALL SELECT asset_b FROM pools WHERE asset_b IS NOT asset_a
    UNION ALL SELECT lp_asset FROM pools WHERE lp_asset IS NOT asset_a AND lp_asset IS NOT asset_b` },
  // The public subasset tab is keyed by the named top-level parent (PARENT.%). A nested longname is
  // therefore one descendant of its first segment, matching the former LIKE 'PARENT.%' count exactly.
  subassets: { reads: ["assets"], sql: `
    SELECT substr(asset_longname,1,instr(asset_longname,'.')-1) asset
      FROM assets WHERE instr(asset_longname,'.')>0` },
};

export function feedCountWriteSql(column: FeedCountColumn, source: string, filter = ""): string {
  return `INSERT INTO asset_feed_counts (asset,${column},updated_at)
    SELECT asset,COUNT(*),unixepoch() FROM (${source}) WHERE asset IS NOT NULL ${filter} GROUP BY asset
    ON CONFLICT(asset) DO UPDATE SET ${column}=excluded.${column},updated_at=excluded.updated_at`;
}

export function feedCountResetSql(placeholders: string): string {
  return `INSERT INTO asset_feed_counts (asset,sales,issuances,dispensers,dispenses,orders,sends,fairmints,dividends,destructions,pools,subassets,updated_at)
    SELECT asset,0,0,0,0,0,0,0,0,0,0,0,unixepoch() FROM assets WHERE asset IN (${placeholders})
    ON CONFLICT(asset) DO UPDATE SET sales=0,issuances=0,dispensers=0,dispenses=0,orders=0,sends=0,
      fairmints=0,dividends=0,destructions=0,pools=0,subassets=0,updated_at=excluded.updated_at`;
}
