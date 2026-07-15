/** Polymorphic sales ledger across Counterparty and external venues. */
import type { Env } from "#api/env";
import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

const ETH_TOKENS = [
  "eth",
  "0x0000000000000000000000000000000000000000",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  "0x0000000000a39bb272e79075ade125fd351887ac",
  "0x223e16c52436cab2ca9fe37087c79986a288fffa",
];
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const BLOCK_WINDOW = 250_000;
const EMBLEM_WINDOW = 5_000;
const DEX_RECONCILE_INTERVAL_BLOCKS = 6;

export function coreDexTradesSql(): string {
  const forwardMoney = `forward_asset.asset IN ('XCP','BTC')`;
  return `INSERT INTO trades(
      venue,ref,asset_id,block_time,block_index,quantity,currency,total,buyer_id,seller_id,tx_hash
    )
    SELECT 'dex',lower(hex(match.tx0_hash)) || lower(hex(match.tx1_hash)),
      CASE WHEN ${forwardMoney} THEN match.backward_asset_id ELSE match.forward_asset_id END,
      match.block_time,match.block_index,
      CAST(CASE WHEN ${forwardMoney} THEN match.backward_quantity ELSE match.forward_quantity END AS REAL)
        / CASE WHEN sold_asset.divisible=1 THEN 1e8 ELSE 1 END,
      CASE WHEN ${forwardMoney} THEN forward_asset.asset ELSE backward_asset.asset END,
      CAST(CASE WHEN ${forwardMoney} THEN match.forward_quantity ELSE match.backward_quantity END AS REAL) / 1e8,
      CASE WHEN ${forwardMoney} THEN match.tx0_address_id ELSE match.tx1_address_id END,
      CASE WHEN ${forwardMoney} THEN match.tx1_address_id ELSE match.tx0_address_id END,
      match.tx1_hash
    FROM order_matches match
    JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
    JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
    LEFT JOIN assets sold_asset ON sold_asset.asset_id=
      CASE WHEN ${forwardMoney} THEN match.backward_asset_id ELSE match.forward_asset_id END
    WHERE match.status='completed'
      AND (forward_asset.asset IN ('XCP','BTC') OR backward_asset.asset IN ('XCP','BTC'))
      AND match.block_index>? AND match.block_index<=?
    ON CONFLICT(venue,ref) DO UPDATE SET
      asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
      quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
      buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash
    WHERE trades.asset_id IS NOT excluded.asset_id OR trades.block_time IS NOT excluded.block_time
      OR trades.block_index IS NOT excluded.block_index OR trades.quantity IS NOT excluded.quantity
      OR trades.currency IS NOT excluded.currency OR trades.total IS NOT excluded.total
      OR trades.buyer_id IS NOT excluded.buyer_id OR trades.seller_id IS NOT excluded.seller_id
      OR trades.tx_hash IS NOT excluded.tx_hash`;
}

const DISPENSE_PAYMENTS = `WITH output_payment AS (
    SELECT output.tx_index,output.destination_id seller_id,
      (SELECT MIN(d.destination_id) FROM dispenses d
       WHERE d.tx_index=output.tx_index AND d.source_id=output.destination_id
         AND d.btc_amount=output.btc_amount) buyer_id,
      output.btc_amount,
      MIN(output.out_index) first_out,MAX(output.out_index) last_out,COUNT(*) output_count,
      SUM(CAST(output.btc_amount AS REAL)) total_sats,MIN(output.block_index) block_index,
      lower(hex(tx.tx_hash)) || ':' || MIN(output.out_index) ||
        CASE WHEN COUNT(*)>1 THEN '+' || COUNT(*) ELSE '' END trade_ref,
      tx.tx_hash
    FROM transaction_outputs output
    JOIN transactions tx ON tx.tx_index=output.tx_index
    WHERE output.block_index>?1 AND output.block_index<=?2
    GROUP BY output.tx_index,output.destination_id,output.btc_amount
  ), event_payment AS (
    SELECT dispense.tx_index,dispense.source_id seller_id,dispense.destination_id buyer_id,
      dispense.btc_amount,MIN(dispense.event_index) first_out,MAX(dispense.event_index) last_out,
      1 output_count,CAST(dispense.btc_amount AS REAL) total_sats,MIN(dispense.block_index) block_index,
      lower(hex(tx.tx_hash)) || ':e' || MIN(dispense.event_index) trade_ref,tx.tx_hash
    FROM dispenses dispense
    JOIN transactions tx ON tx.tx_index=dispense.tx_index
    WHERE dispense.block_index>?1 AND dispense.block_index<=?2
      AND NOT EXISTS (SELECT 1 FROM transaction_outputs output WHERE output.tx_index=dispense.tx_index)
    GROUP BY dispense.tx_index,dispense.source_id,dispense.destination_id,dispense.btc_amount
  ), payment AS (
    SELECT * FROM output_payment
    UNION ALL
    SELECT * FROM event_payment
  )`;

export const DISPENSE_TRADES_SQL = `${DISPENSE_PAYMENTS}
  INSERT INTO trades(
    venue,ref,asset_id,block_time,block_index,quantity,currency,total,buyer_id,seller_id,tx_hash,sale_class
  )
  SELECT 'dispense',payment.trade_ref,
    CASE WHEN payment.output_count=1 AND COUNT(*)=1 THEN MIN(dispense.asset_id) END,
    MIN(dispense.block_time),payment.block_index,
    CASE WHEN payment.output_count=1 AND COUNT(*)=1
      THEN MIN(CAST(dispense.dispense_quantity_normalized AS REAL)) END,
    'BTC',payment.total_sats/1e8,MIN(dispense.destination_id),payment.seller_id,payment.tx_hash,
    CASE WHEN payment.output_count=1 AND COUNT(*)=1 THEN 'single' ELSE 'bundle' END
  FROM payment
  JOIN dispenses dispense ON dispense.tx_index=payment.tx_index
    AND dispense.source_id=payment.seller_id AND dispense.destination_id=payment.buyer_id
    AND dispense.btc_amount=payment.btc_amount
  GROUP BY payment.tx_index,payment.trade_ref,payment.output_count,payment.block_index,
    payment.total_sats,payment.seller_id,payment.tx_hash
  ON CONFLICT(venue,ref) DO UPDATE SET
    asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
    quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
    buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash,
    sale_class=excluded.sale_class
  WHERE trades.asset_id IS NOT excluded.asset_id OR trades.block_time IS NOT excluded.block_time
    OR trades.block_index IS NOT excluded.block_index OR trades.quantity IS NOT excluded.quantity
    OR trades.currency IS NOT excluded.currency OR trades.total IS NOT excluded.total
    OR trades.buyer_id IS NOT excluded.buyer_id OR trades.seller_id IS NOT excluded.seller_id
    OR trades.tx_hash IS NOT excluded.tx_hash OR trades.sale_class IS NOT excluded.sale_class`;

export const DISPENSE_TRADE_LEGS_SQL = `${DISPENSE_PAYMENTS}
  INSERT INTO trade_legs(venue,trade_ref,leg_index,asset_id,quantity)
  SELECT 'dispense',payment.trade_ref,dispense.dispense_index,dispense.asset_id,
    CAST(dispense.dispense_quantity_normalized AS REAL)
  FROM payment
  JOIN dispenses dispense ON dispense.tx_index=payment.tx_index
    AND dispense.source_id=payment.seller_id AND dispense.destination_id=payment.buyer_id
    AND dispense.btc_amount=payment.btc_amount
  ON CONFLICT(venue,trade_ref,leg_index) DO UPDATE SET
    asset_id=excluded.asset_id,quantity=excluded.quantity
  WHERE trade_legs.asset_id IS NOT excluded.asset_id OR trade_legs.quantity IS NOT excluded.quantity`;

export function emblemTradesSql(rowFilter: string): string {
  const acceptedTokens = ETH_TOKENS.map((token) => `'${token}'`).join(",");
  const isUsdc = `payment.address='${USDC}'`;
  const saleTime = `(CASE WHEN sale.block_number>=15537394
    THEN 1663224162+(sale.block_number-15537394)*12
    ELSE CAST(1438269973+sale.block_number*13.15 AS INTEGER) END)`;
  const isReal = `vault.vault_kind='single' AND (vault.cracked_at IS NULL OR ${saleTime}<vault.cracked_at)`;
  return `WITH desired AS (
    SELECT sale.tx_hash || '_' || sale.log_index || '_' || contract.address || '_' || sale.token_id ref,
      CASE WHEN ${isReal} THEN vault.contents_asset_id END asset_id,${saleTime} block_time,
      sale.block_number block_index,
      CASE WHEN ${isReal} THEN COALESCE(vault.contents_qty,1.0) ELSE 1.0 END quantity,
      CASE WHEN ${isUsdc} THEN 'USDC' ELSE 'ETH' END currency,
      CAST(sale.price_raw AS REAL)/CASE WHEN ${isUsdc} THEN 1e6 ELSE 1e18 END total,
      CASE WHEN ${isUsdc} THEN CAST(sale.price_raw AS REAL)/1e6 END usd_value,
      sale.buyer_id,sale.seller_id,sale.tx_hash external_tx_hash,
      CASE WHEN ${isReal} THEN 'real'
           WHEN vault.vault_kind='multi' THEN 'bundle'
           WHEN vault.vault_kind='single' THEN 'scam_cracked'
           WHEN vault.is_scam_shell=1 THEN 'scam_empty'
           ELSE 'non_counterparty' END sale_class
    FROM emblem_sales sale
    JOIN address_dictionary contract ON contract.address_id=sale.contract_id
    JOIN address_dictionary payment ON payment.address_id=sale.token_address_id
    JOIN emblem_vaults vault ON vault.token_id=sale.token_id AND vault.contract_id=sale.contract_id
    WHERE vault.btc_address_id IS NOT NULL AND CAST(sale.price_raw AS REAL)>0
      AND payment.address IN (${acceptedTokens},'${USDC}') ${rowFilter}
  )
    INSERT INTO trades(
      venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,
      buyer_id,seller_id,external_tx_hash,sale_class
    )
    SELECT 'emblem',desired.ref,desired.asset_id,desired.block_time,desired.block_index,desired.quantity,
      desired.currency,desired.total,desired.usd_value,desired.buyer_id,desired.seller_id,
      desired.external_tx_hash,desired.sale_class
    FROM desired LEFT JOIN trades existing ON existing.venue='emblem' AND existing.ref=desired.ref
    WHERE existing.ref IS NULL OR existing.asset_id IS NOT desired.asset_id
      OR existing.block_time IS NOT desired.block_time OR existing.block_index IS NOT desired.block_index
      OR existing.quantity IS NOT desired.quantity OR existing.currency IS NOT desired.currency
      OR existing.total IS NOT desired.total
      OR (desired.currency='USDC' AND existing.usd_value IS NOT desired.usd_value)
      OR existing.buyer_id IS NOT desired.buyer_id OR existing.seller_id IS NOT desired.seller_id
      OR existing.external_tx_hash IS NOT desired.external_tx_hash
      OR existing.sale_class IS NOT desired.sale_class
    ON CONFLICT(venue,ref) DO UPDATE SET
      asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
      quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
      usd_value=CASE WHEN excluded.currency='USDC' THEN excluded.usd_value ELSE trades.usd_value END,
      buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,
      external_tx_hash=excluded.external_tx_hash,sale_class=excluded.sale_class
    WHERE trades.asset_id IS NOT excluded.asset_id OR trades.block_time IS NOT excluded.block_time
      OR trades.block_index IS NOT excluded.block_index OR trades.quantity IS NOT excluded.quantity
      OR trades.currency IS NOT excluded.currency OR trades.total IS NOT excluded.total
      OR (excluded.currency='USDC' AND trades.usd_value IS NOT excluded.usd_value)
      OR trades.buyer_id IS NOT excluded.buyer_id OR trades.seller_id IS NOT excluded.seller_id
      OR trades.external_tx_hash IS NOT excluded.external_tx_hash
      OR trades.sale_class IS NOT excluded.sale_class`;
}

export const SCARCE_TRADES_SQL = `INSERT INTO trades(
    venue,ref,asset_id,block_time,block_index,quantity,currency,total
  )
  SELECT 'scarce.city',asset.asset || '_' || sale.sold_at,sale.asset_id,sale.sold_at,0,1.0,'BTC',sale.price_btc
  FROM scarce_city_sales sale JOIN asset_dictionary asset ON asset.asset_id=sale.asset_id
  ON CONFLICT(venue,ref) DO UPDATE SET
    asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
    quantity=excluded.quantity,currency=excluded.currency,total=excluded.total
  WHERE trades.asset_id IS NOT excluded.asset_id OR trades.block_time IS NOT excluded.block_time
    OR trades.block_index IS NOT excluded.block_index OR trades.quantity IS NOT excluded.quantity
    OR trades.currency IS NOT excluded.currency OR trades.total IS NOT excluded.total`;

export interface TradesBuildProgress {
  tip: number;
  dex?: { from: number; to: number };
  dex_done: boolean;
  dispense?: { from: number; to: number };
  dispense_done: boolean;
  writes: Record<string, number>;
  done: boolean;
}

async function advanceBlockVenue(
  db: D1Database,
  stateKey: string,
  tip: number,
  sql: string,
): Promise<{ range?: { from: number; to: number }; written: number; done: boolean }> {
  const cursor = await getCoreStateInt(db, stateKey);
  if (cursor >= tip) return { written: 0, done: true };
  const high = Math.min(cursor + BLOCK_WINDOW, tip);
  const result = await db.prepare(sql).bind(cursor, high).run();
  await setCoreState(db, stateKey, high);
  return { range: { from: cursor, to: high }, written: result.meta.rows_written ?? 0, done: high >= tip };
}

async function advanceDispenseVenue(
  db: D1Database,
  tip: number,
): Promise<{ range?: { from: number; to: number }; written: number; done: boolean }> {
  const cursor = await getCoreStateInt(db, "trades_cur_dispense_payments");
  if (cursor >= tip) return { written: 0, done: true };
  const high = Math.min(cursor + BLOCK_WINDOW, tip);
  const results = await db.batch([
    db.prepare(DISPENSE_TRADES_SQL).bind(cursor, high),
    db.prepare(DISPENSE_TRADE_LEGS_SQL).bind(cursor, high),
  ]);
  await setCoreState(db, "trades_cur_dispense_payments", high);
  return {
    range: { from: cursor, to: high },
    written: results.reduce((sum, result) => sum + (result.meta.rows_written ?? 0), 0),
    done: high >= tip,
  };
}

/** Advance every venue from canonical inputs using bounded, replay-safe upserts. */
export async function buildTrades(env: Env): Promise<TradesBuildProgress> {
  const tip = Number(
    (await env.CORE_DB.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip ?? 0,
  );
  const writes: Record<string, number> = {};
  const dex = await advanceBlockVenue(env.CORE_DB, "trades_cur_dex", tip, coreDexTradesSql());
  const dispense = await advanceDispenseVenue(env.CORE_DB, tip);
  writes.dex = dex.written;
  writes.dispense = dispense.written;

  const lastDexReconcileRun = await getCoreStateInt(env.CORE_DB, "trades_dex_reconcile_run_block");
  if (tip > 0 && tip - lastDexReconcileRun >= DEX_RECONCILE_INTERVAL_BLOCKS) {
    let dexReconcileCursor = await getCoreStateInt(env.CORE_DB, "trades_dex_reconcile_block");
    if (dexReconcileCursor >= tip) dexReconcileCursor = 0;
    const high = Math.min(dexReconcileCursor + BLOCK_WINDOW, tip);
    const result = await env.CORE_DB.prepare(coreDexTradesSql()).bind(dexReconcileCursor, high).run();
    writes.dex_reconcile = result.meta.rows_written ?? 0;
    await setCoreState(env.CORE_DB, "trades_dex_reconcile_block", high);
    await setCoreState(env.CORE_DB, "trades_dex_reconcile_run_block", tip);
  }

  const emblemTip = Number(
    (await env.CORE_DB.prepare(`SELECT COALESCE(MAX(rowid),0) tip FROM emblem_sales`).first<{ tip: number }>())?.tip ??
      0,
  );
  const emblemCursor = await getCoreStateInt(env.CORE_DB, "trades_cur_emblem");
  if (emblemCursor < emblemTip) {
    const high = Math.min(emblemCursor + EMBLEM_WINDOW, emblemTip);
    const result = await env.CORE_DB.prepare(emblemTradesSql(`AND sale.rowid>? AND sale.rowid<=?`))
      .bind(emblemCursor, high)
      .run();
    writes.emblem_new = result.meta.rows_written ?? 0;
    await setCoreState(env.CORE_DB, "trades_cur_emblem", high);
  }

  let reconcileCursor = await getCoreStateInt(env.CORE_DB, "trades_emblem_reconcile_cursor");
  if (reconcileCursor >= emblemTip) reconcileCursor = 0;
  if (emblemTip > 0) {
    const high = Math.min(reconcileCursor + EMBLEM_WINDOW, emblemTip);
    const result = await env.CORE_DB.prepare(emblemTradesSql(`AND sale.rowid>? AND sale.rowid<=?`))
      .bind(reconcileCursor, high)
      .run();
    writes.emblem_reconcile = result.meta.rows_written ?? 0;
    await setCoreState(env.CORE_DB, "trades_emblem_reconcile_cursor", high);
  }

  const scarce = await env.CORE_DB.prepare(SCARCE_TRADES_SQL).run();
  writes.scarce = scarce.meta.rows_written ?? 0;
  return {
    tip,
    dex: dex.range,
    dex_done: dex.done,
    dispense: dispense.range,
    dispense_done: dispense.done,
    writes,
    done: dex.done && dispense.done,
  };
}
