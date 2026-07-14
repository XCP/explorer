/** Compact-owned polymorphic sales ledger across Counterparty and external venues. */
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

export function compactDexTradesSql(): string {
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
      buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash`;
}

export const COMPACT_DISPENSE_TRADES_SQL = `INSERT INTO trades(
    venue,ref,asset_id,block_time,block_index,quantity,currency,total,buyer_id,seller_id,tx_hash
  )
  SELECT 'dispense',CAST(dispense.event_index AS TEXT),dispense.asset_id,dispense.block_time,
    dispense.block_index,CAST(dispense.dispense_quantity_normalized AS REAL),'BTC',
    CAST(dispense.btc_amount AS REAL)/1e8,dispense.destination_id,dispense.source_id,dispense.tx_hash
  FROM dispenses dispense
  WHERE CAST(dispense.btc_amount AS REAL)>0 AND dispense.block_index>? AND dispense.block_index<=?
  ON CONFLICT(venue,ref) DO UPDATE SET
    asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
    quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
    buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash`;

export function compactEmblemTradesSql(rowFilter: string): string {
  const acceptedTokens = ETH_TOKENS.map((token) => `'${token}'`).join(",");
  const isUsdc = `payment.address='${USDC}'`;
  const saleTime = `(CASE WHEN sale.block_number>=15537394
    THEN 1663224162+(sale.block_number-15537394)*12
    ELSE CAST(1438269973+sale.block_number*13.15 AS INTEGER) END)`;
  const isReal = `vault.vault_kind='single' AND (vault.cracked_at IS NULL OR ${saleTime}<vault.cracked_at)`;
  return `INSERT INTO trades(
      venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,
      buyer_id,seller_id,external_tx_hash,sale_class
    )
    SELECT 'emblem',sale.tx_hash || '_' || sale.log_index || '_' || contract.address || '_' || sale.token_id,
      CASE WHEN ${isReal} THEN vault.contents_asset_id END,${saleTime},sale.block_number,
      CASE WHEN ${isReal} THEN COALESCE(vault.contents_qty,1.0) ELSE 1.0 END,
      CASE WHEN ${isUsdc} THEN 'USDC' ELSE 'ETH' END,
      CAST(sale.price_raw AS REAL)/CASE WHEN ${isUsdc} THEN 1e6 ELSE 1e18 END,
      CASE WHEN ${isUsdc} THEN CAST(sale.price_raw AS REAL)/1e6 END,
      sale.buyer_id,sale.seller_id,sale.tx_hash,
      CASE WHEN ${isReal} THEN 'real'
           WHEN vault.vault_kind='multi' THEN 'bundle'
           WHEN vault.vault_kind='single' THEN 'scam_cracked'
           WHEN vault.is_scam_shell=1 THEN 'scam_empty'
           ELSE 'non_counterparty' END
    FROM emblem_sales sale
    JOIN address_dictionary contract ON contract.address_id=sale.contract_id
    JOIN address_dictionary payment ON payment.address_id=sale.token_address_id
    JOIN emblem_vaults vault ON vault.token_id=sale.token_id AND vault.contract_id=sale.contract_id
    WHERE vault.btc_address_id IS NOT NULL AND CAST(sale.price_raw AS REAL)>0
      AND payment.address IN (${acceptedTokens},'${USDC}') ${rowFilter}
    ON CONFLICT(venue,ref) DO UPDATE SET
      asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
      quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
      usd_value=CASE WHEN excluded.currency='USDC' THEN excluded.usd_value ELSE trades.usd_value END,
      buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,
      external_tx_hash=excluded.external_tx_hash,sale_class=excluded.sale_class`;
}

export const COMPACT_SCARCE_TRADES_SQL = `INSERT INTO trades(
    venue,ref,asset_id,block_time,block_index,quantity,currency,total
  )
  SELECT 'scarce.city',asset.asset || '_' || sale.sold_at,sale.asset_id,sale.sold_at,0,1.0,'BTC',sale.price_btc
  FROM scarce_city_sales sale JOIN asset_dictionary asset ON asset.asset_id=sale.asset_id
  ON CONFLICT(venue,ref) DO UPDATE SET
    asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
    quantity=excluded.quantity,currency=excluded.currency,total=excluded.total`;

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

/** Advance every venue from canonical compact inputs using bounded, replay-safe upserts. */
export async function buildTrades(env: Env): Promise<TradesBuildProgress> {
  const tip = Number(
    (await env.CORE_DB.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip ?? 0,
  );
  const writes: Record<string, number> = {};
  const dex = await advanceBlockVenue(env.CORE_DB, "trades_cur_dex", tip, compactDexTradesSql());
  const dispense = await advanceBlockVenue(env.CORE_DB, "trades_cur_dispense", tip, COMPACT_DISPENSE_TRADES_SQL);
  writes.dex = dex.written;
  writes.dispense = dispense.written;

  let dexReconcileCursor = await getCoreStateInt(env.CORE_DB, "trades_dex_reconcile_block");
  if (dexReconcileCursor >= tip) dexReconcileCursor = 0;
  if (tip > 0) {
    const high = Math.min(dexReconcileCursor + BLOCK_WINDOW, tip);
    const result = await env.CORE_DB.prepare(compactDexTradesSql()).bind(dexReconcileCursor, high).run();
    writes.dex_reconcile = result.meta.rows_written ?? 0;
    await setCoreState(env.CORE_DB, "trades_dex_reconcile_block", high);
  }

  const emblemTip = Number(
    (await env.CORE_DB.prepare(`SELECT COALESCE(MAX(rowid),0) tip FROM emblem_sales`).first<{ tip: number }>())?.tip ??
      0,
  );
  const emblemCursor = await getCoreStateInt(env.CORE_DB, "trades_cur_emblem");
  if (emblemCursor < emblemTip) {
    const high = Math.min(emblemCursor + EMBLEM_WINDOW, emblemTip);
    const result = await env.CORE_DB.prepare(compactEmblemTradesSql(`AND sale.rowid>? AND sale.rowid<=?`))
      .bind(emblemCursor, high)
      .run();
    writes.emblem_new = result.meta.rows_written ?? 0;
    await setCoreState(env.CORE_DB, "trades_cur_emblem", high);
  }

  let reconcileCursor = await getCoreStateInt(env.CORE_DB, "trades_emblem_reconcile_cursor");
  if (reconcileCursor >= emblemTip) reconcileCursor = 0;
  if (emblemTip > 0) {
    const high = Math.min(reconcileCursor + EMBLEM_WINDOW, emblemTip);
    const result = await env.CORE_DB.prepare(compactEmblemTradesSql(`AND sale.rowid>? AND sale.rowid<=?`))
      .bind(reconcileCursor, high)
      .run();
    writes.emblem_reconcile = result.meta.rows_written ?? 0;
    await setCoreState(env.CORE_DB, "trades_emblem_reconcile_cursor", high);
  }

  const scarce = await env.CORE_DB.prepare(COMPACT_SCARCE_TRADES_SQL).run();
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
