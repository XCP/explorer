import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

const FULL_REPAIR_INTERVAL = 1_008;

const UPSERT = `INSERT INTO asset_signals(
  asset_id,issuer_id,divisible,locked,holders,top1_pct,burned_pct,holder_breadth,
  pct_creator_holders,avg_holder_dex,trades,self_trade_pct,low_quality,
  first_trade_blk,last_trade_blk,dispenses,dispense_btc,distinct_traders,distinct_dispensers,
  age_blocks,recent_events,recency_blocks,max_dispense_btc,max_trade_xcp,supply,
  max_realized_usd,distinct_dispense_buyers,max_dispense_btc_clean,emblem_trades,
  active_trade_months,last_trade_time,clean_realized_usd,distinct_paid_buyers,
  clean_active_trade_months,market_venue_count
)
WITH identity AS (SELECT asset_id FROM asset_dictionary WHERE asset=?1),
  tip AS (SELECT block_index FROM blocks ORDER BY block_index DESC LIMIT 1),
  holding AS (
    SELECT count(CASE WHEN coalesce(signal.is_burn,0)=0 THEN 1 END) holders,
      coalesce(max(CASE WHEN coalesce(signal.is_burn,0)=0 THEN CAST(balance.quantity AS REAL) END)
        *100.0/nullif(sum(CASE WHEN coalesce(signal.is_burn,0)=0 THEN CAST(balance.quantity AS REAL) END),0),0) top1_pct,
      coalesce(sum(CASE WHEN signal.is_burn=1 THEN CAST(balance.quantity AS REAL) ELSE 0 END)
        *100.0/nullif(sum(CAST(balance.quantity AS REAL)),0),0) burned_pct,
      CASE WHEN count(*)>=3 THEN avg(coalesce(signal.assets_held,0)) ELSE 0 END holder_breadth,
      CASE WHEN count(*)>=3 THEN avg(CASE WHEN signal.survived_assets>0 THEN 1.0 ELSE 0 END)*100 ELSE 0 END pct_creator_holders,
      CASE WHEN count(*)>=3 THEN avg(coalesce(signal.dex_trades,0)) ELSE 0 END avg_holder_dex
    FROM balances balance LEFT JOIN address_signals signal ON signal.address_id=balance.address_id
    WHERE balance.asset_id=(SELECT asset_id FROM identity) AND balance.address_id IS NOT NULL
      AND CAST(balance.quantity AS INTEGER)>0
  ),
  matches AS (
    SELECT tx0_address_id a0,tx1_address_id a1,block_index,
      CASE WHEN backward_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
           THEN CAST(backward_quantity AS REAL) END xcp
    FROM order_matches WHERE forward_asset_id=(SELECT asset_id FROM identity)
    UNION ALL
    SELECT tx0_address_id,tx1_address_id,block_index,
      CASE WHEN forward_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='XCP')
           THEN CAST(forward_quantity AS REAL) END
    FROM order_matches WHERE backward_asset_id=(SELECT asset_id FROM identity)
  ),
  market AS (
    SELECT count(*) trades,
      coalesce(sum(CASE WHEN a0=a1 THEN 1.0 ELSE 0 END)*100.0/nullif(count(*),0),0) self_trade_pct,
      coalesce(min(block_index),0) first_trade_blk,coalesce(max(block_index),0) last_trade_blk,
      (SELECT count(DISTINCT address_id) FROM (
        SELECT a0 address_id FROM matches UNION ALL SELECT a1 FROM matches
      )) distinct_traders,
      coalesce(max(xcp)/1e8,0) max_trade_xcp
    FROM matches
  ),
  dispense AS (
    SELECT count(*) dispenses,coalesce(sum(CAST(item.btc_amount AS REAL))/1e8,0) dispense_btc,
      coalesce(max(CAST(item.btc_amount AS REAL))/1e8,0) max_dispense_btc,
      count(DISTINCT CASE WHEN item.destination_id<>item.source_id
        AND item.destination_id<>coalesce(dispenser.origin_id,item.source_id) THEN item.destination_id END)
        distinct_dispense_buyers,
      coalesce(max(CASE WHEN item.destination_id<>item.source_id
        AND item.destination_id<>coalesce(dispenser.origin_id,item.source_id)
        THEN CAST(item.btc_amount AS REAL) END)/1e8,0) max_dispense_btc_clean
    FROM dispenses item LEFT JOIN dispensers dispenser ON dispenser.tx_index=item.dispenser_tx_index
    WHERE item.asset_id=(SELECT asset_id FROM identity)
  ),
  recent AS (
    SELECT count(*) recent_events FROM (
      SELECT block_index FROM matches WHERE block_index>=(SELECT block_index-52560 FROM tip)
      UNION ALL SELECT block_index FROM dispenses
        WHERE asset_id=(SELECT asset_id FROM identity) AND block_index>=(SELECT block_index-52560 FROM tip)
    )
  ),
  sales AS (
    SELECT coalesce(max(CASE WHEN buyer_id IS NULL OR seller_id IS NULL OR buyer_id<>seller_id
        THEN usd_value END),0) max_realized_usd,
      coalesce(sum(CASE WHEN venue='emblem' THEN 1 ELSE 0 END),0) emblem_trades,
      count(DISTINCT strftime('%Y-%m',block_time,'unixepoch')) active_trade_months,
      max(block_time) last_trade_time
    FROM trades WHERE asset_id=(SELECT asset_id FROM identity)
  ),
  clean_sales AS (
    SELECT coalesce(sum(CASE WHEN usd_value>0 THEN usd_value ELSE 0 END),0) clean_realized_usd,
      count(DISTINCT buyer_id) distinct_paid_buyers,
      count(DISTINCT strftime('%Y-%m',block_time,'unixepoch')) clean_active_trade_months,
      count(DISTINCT venue) market_venue_count
    FROM trades
    WHERE asset_id=(SELECT asset_id FROM identity) AND block_time>0 AND total>0
      AND buyer_id IS NOT NULL AND seller_id IS NOT NULL AND buyer_id<>seller_id
      AND (venue='dex' OR (venue='dispense' AND sale_class='single')
        OR (venue='tokenly_swapbot' AND sale_class='single')
        OR (venue='otc' AND sale_class IN ('likely','corroborated'))
        OR (venue='emblem' AND sale_class='real'))
  )
SELECT identity.asset_id,asset.issuer_id,asset.divisible,asset.locked,
  holding.holders,holding.top1_pct,holding.burned_pct,holding.holder_breadth,
  holding.pct_creator_holders,holding.avg_holder_dex,
  market.trades,market.self_trade_pct,
  CASE WHEN (market.self_trade_pct>=50 AND market.trades>=30) OR EXISTS(
    SELECT 1 FROM curated item WHERE item.kind='lowq'
      AND item.key=(SELECT asset FROM asset_dictionary WHERE asset_id=identity.asset_id)
  ) THEN 1 ELSE 0 END,
  market.first_trade_blk,market.last_trade_blk,
  dispense.dispenses,dispense.dispense_btc,market.distinct_traders,
  (SELECT count(DISTINCT coalesce(origin_id,source_id)) FROM dispensers
    WHERE asset_id=identity.asset_id),
  coalesce((SELECT block_index FROM tip)-asset.first_issuance_block_index,0),recent.recent_events,
  coalesce((SELECT block_index FROM tip)-market.last_trade_blk,0),dispense.max_dispense_btc,
  market.max_trade_xcp,coalesce(CAST(asset.supply_normalized AS REAL),0),sales.max_realized_usd,
  dispense.distinct_dispense_buyers,dispense.max_dispense_btc_clean,sales.emblem_trades,
  sales.active_trade_months,sales.last_trade_time,clean_sales.clean_realized_usd,
  clean_sales.distinct_paid_buyers,clean_sales.clean_active_trade_months,clean_sales.market_venue_count
FROM identity LEFT JOIN assets asset ON asset.asset_id=identity.asset_id
CROSS JOIN holding CROSS JOIN market CROSS JOIN dispense CROSS JOIN recent CROSS JOIN sales CROSS JOIN clean_sales
WHERE 1
ON CONFLICT(asset_id) DO UPDATE SET
  issuer_id=excluded.issuer_id,divisible=excluded.divisible,locked=excluded.locked,
  holders=excluded.holders,top1_pct=excluded.top1_pct,burned_pct=excluded.burned_pct,
  holder_breadth=excluded.holder_breadth,pct_creator_holders=excluded.pct_creator_holders,
  avg_holder_dex=excluded.avg_holder_dex,low_quality=excluded.low_quality,
  trades=excluded.trades,self_trade_pct=excluded.self_trade_pct,
  first_trade_blk=excluded.first_trade_blk,last_trade_blk=excluded.last_trade_blk,
  dispenses=excluded.dispenses,dispense_btc=excluded.dispense_btc,
  distinct_traders=excluded.distinct_traders,distinct_dispensers=excluded.distinct_dispensers,
  age_blocks=excluded.age_blocks,recent_events=excluded.recent_events,
  recency_blocks=excluded.recency_blocks,max_dispense_btc=excluded.max_dispense_btc,
  max_trade_xcp=excluded.max_trade_xcp,supply=excluded.supply,
  max_realized_usd=excluded.max_realized_usd,
  distinct_dispense_buyers=excluded.distinct_dispense_buyers,
  max_dispense_btc_clean=excluded.max_dispense_btc_clean,emblem_trades=excluded.emblem_trades,
  active_trade_months=excluded.active_trade_months,last_trade_time=excluded.last_trade_time,
  clean_realized_usd=excluded.clean_realized_usd,distinct_paid_buyers=excluded.distinct_paid_buyers,
  clean_active_trade_months=excluded.clean_active_trade_months,market_venue_count=excluded.market_venue_count`;

/** Refresh volatile asset features from canonical relations for identities touched by an event batch. */
export async function rebuildCoreAssetSignals(db: D1Database, assets: Iterable<string>): Promise<number> {
  const unique = [...new Set(assets)];
  for (let index = 0; index < unique.length; index += 40) {
    await db.batch(unique.slice(index, index + 40).map((asset) => db.prepare(UPSERT).bind(asset)));
  }
  return unique.length;
}

/** Bounded full-population repair cycle using the same convergent per-identity writer as event maintenance. */
export async function runCoreAssetSignalsStep(
  db: D1Database,
  limit = 400,
  force = false,
): Promise<{ processed: number; cursor: number; cycleComplete: boolean }> {
  const cursor = await getCoreStateInt(db, "asset_signals_cursor");
  const dirty = await db
    .prepare(
      `SELECT dirty.asset_id,dictionary.asset FROM asset_signal_dirty dirty
       JOIN asset_dictionary dictionary ON dictionary.asset_id=dirty.asset_id
       ORDER BY dirty.asset_id LIMIT ?`,
    )
    .bind(limit)
    .all<{ asset_id: number; asset: string }>();
  if (dirty.results.length > 0) {
    await rebuildCoreAssetSignals(
      db,
      dirty.results.map((row) => row.asset),
    );
    for (let index = 0; index < dirty.results.length; index += 90) {
      const ids = dirty.results.slice(index, index + 90).map((row) => row.asset_id);
      await db
        .prepare(`DELETE FROM asset_signal_dirty WHERE asset_id IN (${ids.map(() => "?").join(",")})`)
        .bind(...ids)
        .run();
    }
    return { processed: dirty.results.length, cursor, cycleComplete: false };
  }
  if (cursor === 0 && !force && (await getCoreStateInt(db, "asset_signals_cycles")) > 0) {
    const tip =
      Number((await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
    const completed = await getCoreStateInt(db, "asset_signals_completed_block");
    if (tip - completed < FULL_REPAIR_INTERVAL) return { processed: 0, cursor: 0, cycleComplete: true };
  }
  const rows = await db
    .prepare(
      `SELECT dictionary.asset_id,dictionary.asset FROM asset_dictionary dictionary
       JOIN assets asset ON asset.asset_id=dictionary.asset_id
       WHERE dictionary.asset_id>? ORDER BY dictionary.asset_id LIMIT ?`,
    )
    .bind(cursor, limit)
    .all<{ asset_id: number; asset: string }>();
  if (rows.results.length === 0) {
    const lowQualityIssuers = await db
      .prepare(
        `SELECT issuer_id FROM asset_signals WHERE issuer_id IS NOT NULL
         GROUP BY issuer_id HAVING sum(low_quality)>=4
           AND sum(low_quality)*1.0/count(*)>=0.5`,
      )
      .all<{ issuer_id: number }>();
    for (let index = 0; index < lowQualityIssuers.results.length; index += 50) {
      await db.batch(
        lowQualityIssuers.results
          .slice(index, index + 50)
          .map(({ issuer_id }) =>
            db.prepare(`UPDATE asset_signals SET low_quality=1 WHERE low_quality=0 AND issuer_id=?`).bind(issuer_id),
          ),
      );
    }
    await setCoreState(db, "asset_signals_cursor", 0);
    await setCoreState(db, "asset_signals_cycles", (await getCoreStateInt(db, "asset_signals_cycles")) + 1);
    const tip =
      Number((await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
    await setCoreState(db, "asset_signals_completed_block", tip);
    return { processed: 0, cursor: 0, cycleComplete: true };
  }
  await rebuildCoreAssetSignals(
    db,
    rows.results.map((row) => row.asset),
  );
  const next = rows.results.at(-1)?.asset_id ?? cursor;
  await setCoreState(db, "asset_signals_cursor", next);
  return { processed: rows.results.length, cursor: next, cycleComplete: false };
}
