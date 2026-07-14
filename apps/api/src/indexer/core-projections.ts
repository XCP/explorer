import type { Env } from "#api/env";
import { hashToBytes } from "#api/indexer/compact-codec";

export const CORE_INCREMENTAL_PROJECTIONS = [
  "emblem_listings",
  "emblem_sales",
  "prices",
  "scarce_city_sales",
  "trades",
  "xcp_btc_daily",
] as const;
export type CoreIncrementalProjection = (typeof CORE_INCREMENTAL_PROJECTIONS)[number];

interface SourceRow {
  rowid: number;
  [column: string]: unknown;
}

const isProjection = (value: string): value is CoreIncrementalProjection =>
  CORE_INCREMENTAL_PROJECTIONS.some((table) => table === value);

async function state(db: D1Database, key: string): Promise<string | null> {
  return (
    (await db.prepare(`SELECT value FROM core_state WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null
  );
}

function setState(db: D1Database, key: string, value: string | number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO core_state(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .bind(key, String(value));
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

async function writeRows(
  db: D1Database,
  table: CoreIncrementalProjection,
  rows: SourceRow[],
  generation: number | null,
): Promise<void> {
  if (rows.length === 0) return;
  if (table === "emblem_listings") {
    if (generation == null) throw new Error("listing reconciliation generation is missing");
    const addresses = [
      ...new Set(
        rows
          .flatMap((row) => [row.contract, row.currency])
          .map(nullableString)
          .filter((address) => address != null),
      ),
    ];
    const assets = [...new Set(rows.map((row) => nullableString(row.asset)).filter((asset) => asset != null))];
    if (addresses.length > 0) {
      await db.batch(
        addresses.map((address) =>
          db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address),
        ),
      );
    }
    if (assets.length > 0) {
      await db.batch(
        assets.map((asset) => db.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES(?)`).bind(asset)),
      );
    }
    await db.batch(
      rows.map((row) =>
        db
          .prepare(
            `INSERT INTO emblem_listings(
               generation,contract_id,token_id,asset_id,order_id,marketplace,price_usd,
               price_amount,currency_id,url,expiry,updated_at
             ) VALUES(
               ?,(SELECT address_id FROM address_dictionary WHERE address=?),?,
               (SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,
               (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?
             )
             ON CONFLICT(generation,contract_id,token_id) DO UPDATE SET
               asset_id=excluded.asset_id,order_id=excluded.order_id,marketplace=excluded.marketplace,
               price_usd=excluded.price_usd,price_amount=excluded.price_amount,
               currency_id=excluded.currency_id,url=excluded.url,expiry=excluded.expiry,
               updated_at=excluded.updated_at`,
          )
          .bind(
            generation,
            row.contract,
            row.token_id,
            row.asset,
            row.order_id,
            row.marketplace,
            row.price_usd,
            row.price_amount,
            row.currency,
            row.url,
            row.expiry,
            row.updated_at,
          ),
      ),
    );
    return;
  }
  if (table === "prices") {
    await db.batch(
      rows.map((row) =>
        db
          .prepare(
            `INSERT INTO prices(day,currency,usd,source) VALUES(?,?,?,?)
             ON CONFLICT(day,currency) DO UPDATE SET usd=excluded.usd,source=excluded.source`,
          )
          .bind(row.day, row.currency, row.usd, row.source),
      ),
    );
    return;
  }
  if (table === "xcp_btc_daily") {
    await db.batch(
      rows.map((row) =>
        db
          .prepare(
            `INSERT INTO xcp_btc_daily(day,xcpbtc) VALUES(?,?)
             ON CONFLICT(day) DO UPDATE SET xcpbtc=excluded.xcpbtc`,
          )
          .bind(row.day, row.xcpbtc),
      ),
    );
    return;
  }
  if (table === "scarce_city_sales") {
    const assets = [...new Set(rows.map((row) => nullableString(row.asset)).filter((asset) => asset != null))];
    if (assets.length > 0) {
      await db.batch(
        assets.map((asset) => db.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES(?)`).bind(asset)),
      );
    }
    await db.batch(
      rows.map((row) =>
        db
          .prepare(
            `INSERT INTO scarce_city_sales(asset_id,sold_at,price_btc)
             SELECT asset_id,?,? FROM asset_dictionary WHERE asset=?
             ON CONFLICT(asset_id,sold_at) DO UPDATE SET price_btc=excluded.price_btc`,
          )
          .bind(row.sold_at, row.price_btc, row.asset),
      ),
    );
    return;
  }

  if (table === "trades") {
    const assets = [...new Set(rows.map((row) => nullableString(row.asset)).filter((asset) => asset != null))];
    const addresses = [
      ...new Set(
        rows
          .flatMap((row) => [row.buyer, row.seller])
          .map(nullableString)
          .filter((address) => address != null),
      ),
    ];
    if (assets.length > 0) {
      await db.batch(
        assets.map((asset) => db.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES(?)`).bind(asset)),
      );
    }
    if (addresses.length > 0) {
      await db.batch(
        addresses.map((address) =>
          db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address),
        ),
      );
    }
    await db.batch(
      rows.map((row) => {
        const hash = nullableString(row.tx_hash);
        const canonicalHash = hash != null && /^[0-9a-fA-F]{64}$/.test(hash) ? hashToBytes(hash) : null;
        return db
          .prepare(
            `INSERT INTO trades(
               venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,
               buyer_id,seller_id,tx_hash,external_tx_hash,sale_class
             ) VALUES(
               ?,?,(SELECT asset_id FROM asset_dictionary WHERE asset=?),?,?,?,?,?,?,
               (SELECT address_id FROM address_dictionary WHERE address=?),
               (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?
             )
             ON CONFLICT(venue,ref) DO UPDATE SET
               asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
               quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
               usd_value=excluded.usd_value,buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,
               tx_hash=excluded.tx_hash,external_tx_hash=excluded.external_tx_hash,sale_class=excluded.sale_class`,
          )
          .bind(
            row.venue,
            row.ref,
            row.asset,
            row.block_time,
            row.block_index,
            row.quantity,
            row.currency,
            row.total,
            row.usd_value,
            row.buyer,
            row.seller,
            canonicalHash,
            canonicalHash == null ? hash : null,
            row.sale_class,
          );
      }),
    );
    return;
  }

  const addresses = [
    ...new Set(
      rows
        .flatMap((row) => [row.contract, row.token_addr, row.buyer, row.seller])
        .map(nullableString)
        .filter((address) => address != null),
    ),
  ];
  if (addresses.length > 0) {
    await db.batch(
      addresses.map((address) =>
        db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address),
      ),
    );
  }
  await db.batch(
    rows.map((row) =>
      db
        .prepare(
          `INSERT INTO emblem_sales(
             tx_hash,log_index,contract_id,token_id,price_raw,token_address_id,marketplace,
             buyer_id,seller_id,block_number
           ) VALUES(
             ?,?,(SELECT address_id FROM address_dictionary WHERE address=?),?,?,
             (SELECT address_id FROM address_dictionary WHERE address=?),?,
             (SELECT address_id FROM address_dictionary WHERE address=?),
             (SELECT address_id FROM address_dictionary WHERE address=?),?
           )
           ON CONFLICT(tx_hash,log_index) DO UPDATE SET
             contract_id=excluded.contract_id,token_id=excluded.token_id,price_raw=excluded.price_raw,
             token_address_id=excluded.token_address_id,marketplace=excluded.marketplace,
             buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,block_number=excluded.block_number`,
        )
        .bind(
          row.tx_hash,
          row.log_index,
          row.contract,
          row.token_id,
          row.price_raw,
          row.token_addr,
          row.marketplace,
          row.buyer,
          row.seller,
          row.block_number,
        ),
    ),
  );
}

/** Reconcile one immutable-high-water page. Source rows are never deleted; mutable keys converge through UPSERT. */
export async function reconcileCoreProjection(
  env: Pick<Env, "DB" | "CORE_DB">,
  requestedTable: string,
  rowsPerPage = 250,
) {
  if (!isProjection(requestedTable)) throw new Error(`unsupported incremental projection: ${requestedTable}`);
  const table = requestedTable;
  const [buildComplete, importComplete] = await Promise.all([
    state(env.CORE_DB, "build_complete"),
    state(env.CORE_DB, "import_complete"),
  ]);
  if (buildComplete !== "1" || importComplete !== "1") return { table, skipped: "compact import is incomplete" };

  const prefix = `projection_reconcile:${table}`;
  let cursor = Number.parseInt((await state(env.CORE_DB, `${prefix}:cursor`)) ?? "0", 10);
  let highWater = Number.parseInt((await state(env.CORE_DB, `${prefix}:high_water`)) ?? "0", 10);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(highWater) || highWater < 0) {
    throw new Error(`invalid reconciliation state for ${table}`);
  }
  let generation: number | null = null;
  if (table === "emblem_listings") {
    const previouslyComplete = (await state(env.CORE_DB, `${prefix}:complete`)) === "1";
    if (previouslyComplete) {
      cursor = 0;
      highWater = 0;
    }
    const savedGeneration = previouslyComplete ? null : await state(env.CORE_DB, `${prefix}:generation`);
    generation =
      savedGeneration == null
        ? Number.parseInt((await state(env.CORE_DB, "emblem_listings_generation")) ?? "0", 10) + 1
        : Number.parseInt(savedGeneration, 10);
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("invalid listing generation");
    if (savedGeneration == null)
      await env.CORE_DB.batch([
        setState(env.CORE_DB, `${prefix}:generation`, generation),
        setState(env.CORE_DB, `${prefix}:cursor`, 0),
        setState(env.CORE_DB, `${prefix}:high_water`, 0),
        setState(env.CORE_DB, `${prefix}:complete`, 0),
      ]);
  }
  if (highWater === 0 || cursor >= highWater) {
    highWater = Number(
      (
        await env.DB.prepare(`SELECT coalesce(max(rowid),0) high_water FROM "${table}"`).first<{
          high_water: number;
        }>()
      )?.high_water ?? 0,
    );
    if (cursor >= highWater) {
      const completed = [
        setState(env.CORE_DB, `${prefix}:high_water`, highWater),
        setState(env.CORE_DB, `${prefix}:complete`, 1),
      ];
      if (generation != null) completed.push(setState(env.CORE_DB, "emblem_listings_generation", generation));
      await env.CORE_DB.batch(completed);
      return { table, processed: 0, cursor, high_water: highWater, caught_up: true };
    }
    await env.CORE_DB.batch([
      setState(env.CORE_DB, `${prefix}:high_water`, highWater),
      setState(env.CORE_DB, `${prefix}:complete`, 0),
    ]);
  }

  const page = await env.DB.prepare(`SELECT rowid,* FROM "${table}" WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`)
    .bind(cursor, highWater, Math.max(1, Math.min(rowsPerPage, 500)))
    .all<SourceRow>();
  await writeRows(env.CORE_DB, table, page.results, generation);
  cursor = page.results.length > 0 ? Number(page.results.at(-1)?.rowid ?? cursor) : highWater;
  const caughtUp = cursor >= highWater;
  const progress = [
    setState(env.CORE_DB, `${prefix}:cursor`, cursor),
    setState(env.CORE_DB, `${prefix}:complete`, caughtUp ? 1 : 0),
  ];
  if (caughtUp && generation != null) progress.push(setState(env.CORE_DB, "emblem_listings_generation", generation));
  await env.CORE_DB.batch(progress);
  return { table, processed: page.results.length, cursor, high_water: highWater, caught_up: caughtUp };
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

/** Reconcile the bounded post-seed mutable set rather than rescanning hundreds of thousands of stable signals. */
export async function reconcileRecentCoreProjections(env: Pick<Env, "DB" | "CORE_DB">) {
  const seedBlock = Number.parseInt((await state(env.CORE_DB, "seed_block_index")) ?? "0", 10);
  if (!Number.isSafeInteger(seedBlock) || seedBlock <= 0) throw new Error("compact seed block is missing");
  const [addresses, assets, exchange] = await Promise.all([
    env.DB.prepare(`SELECT * FROM address_signals WHERE last_block>? ORDER BY address`)
      .bind(seedBlock)
      .all<SourceRow>(),
    env.DB.prepare(
      `SELECT s.* FROM asset_signals s JOIN assets a ON a.asset=s.asset
        WHERE a.first_issuance_block_index>? ORDER BY s.asset`,
    )
      .bind(seedBlock)
      .all<SourceRow>(),
    env.DB.prepare(
      `SELECT generation,asset,depositors FROM exchange_top_assets ORDER BY generation,asset`,
    ).all<SourceRow>(),
  ]);
  const assetNames = assets.results.map((row) => String(row.asset));
  const feeds =
    assetNames.length === 0
      ? { results: [] as SourceRow[] }
      : await env.DB.prepare(
          `SELECT * FROM asset_feed_counts WHERE asset IN (${assetNames.map(() => "?").join(",")}) ORDER BY asset`,
        )
          .bind(...assetNames)
          .all<SourceRow>();

  const addressNames = new Set<string>();
  for (const row of addresses.results) addressNames.add(String(row.address));
  for (const row of assets.results) if (nullableString(row.issuer)) addressNames.add(String(row.issuer));
  const allAssets = new Set<string>([...assetNames, ...exchange.results.map((row) => String(row.asset))]);
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
            ...ADDRESS_SIGNAL_COLUMNS.map((column) => row[column] ?? null),
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
            ...ASSET_SIGNAL_COLUMNS.map((column) => row[column] ?? null),
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
        .map((row) =>
          env.CORE_DB.prepare(feedSql).bind(row.asset, ...FEED_COLUMNS.map((column) => row[column] ?? null)),
        ),
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
    seed_block: seedBlock,
    address_signals: addresses.results.length,
    asset_signals: assets.results.length,
    asset_feed_counts: feeds.results.length,
    exchange_top_assets: exchange.results.length,
  };
}
