#!/usr/bin/env node

/** Read-only XCP/PEPECASH bilateral-exchange census. Produces candidates, never canonical trades. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const WINDOW_BLOCKS = Number(process.env.LEDGER_OTC_TOKEN_WINDOW_BLOCKS || 12);
const OUTPUT = resolve(
  process.env.LEDGER_OTC_TOKEN_OUTPUT || "../../docs/data/ledger-otc-counterparty-2026-07-19.json",
);

const cte = `WITH money AS (
  SELECT asset_id,asset FROM asset_dictionary WHERE asset IN ('XCP','PEPECASH')
), eligible AS (
  SELECT payment.event_index payment_event,payment.tx_hash payment_hash,
    payment.block_index payment_block,payment.block_time,
    payment.source_id buyer,payment.destination_id seller,payment.asset_id money_asset,
    CAST(payment.quantity_normalized AS REAL) money_qty,
    output.event_index output_event,output.tx_hash output_hash,output.block_index output_block,
    output.asset_id sold_asset,CAST(output.quantity_normalized AS REAL) sold_qty,
    COUNT(*) OVER(PARTITION BY output.event_index) possible_payments,
    COUNT(*) OVER(PARTITION BY payment.event_index) possible_outputs
  FROM sends payment JOIN money ON money.asset_id=payment.asset_id
  JOIN sends output ON output.source_id=payment.destination_id
    AND output.destination_id=payment.source_id AND output.asset_id<>payment.asset_id
    AND output.block_index BETWEEN payment.block_index AND payment.block_index+${WINDOW_BLOCKS}
  LEFT JOIN address_signals buyer_signal ON buyer_signal.address_id=payment.source_id
  LEFT JOIN address_signals seller_signal ON seller_signal.address_id=payment.destination_id
  LEFT JOIN address_dictionary seller_address ON seller_address.address_id=payment.destination_id
  LEFT JOIN tokenly_swapbots bot ON bot.address=seller_address.address
  WHERE CAST(payment.quantity_normalized AS REAL)>0 AND CAST(output.quantity_normalized AS REAL)>0
    AND COALESCE(buyer_signal.is_exchange,0)=0 AND COALESCE(seller_signal.is_exchange,0)=0
    AND COALESCE(buyer_signal.is_burn,0)=0 AND COALESCE(seller_signal.is_burn,0)=0
    AND COALESCE(buyer_signal.is_emblem_vault,0)=0 AND COALESCE(seller_signal.is_emblem_vault,0)=0
    AND bot.address IS NULL
), clean AS (
  SELECT eligible.*,
    EXISTS(SELECT 1 FROM trade_legs leg WHERE leg.leg_index=eligible.output_event) known_delivery
  FROM eligible WHERE possible_payments=1 AND possible_outputs=1
), seller_stats AS (
  SELECT seller,COUNT(*) matches,COUNT(DISTINCT buyer) buyers,
    COUNT(DISTINCT sold_asset) sold_assets
  FROM clean WHERE known_delivery=0 GROUP BY seller
), classified AS (
  SELECT clean.*,
    CASE WHEN stats.buyers>=10 OR stats.matches>=25 OR stats.sold_assets>=10 THEN 'mechanical_vendor'
      WHEN stats.matches<=5 AND stats.buyers<=3 THEN 'peer_like'
      ELSE 'repeat_or_mixed' END cohort
  FROM clean LEFT JOIN seller_stats stats USING(seller)
)`;

const summary = executeRemoteD1(`${cte}
  SELECT money.asset currency,CASE WHEN known_delivery=1 THEN 'known_trade' ELSE cohort END cohort,
    COUNT(*) matches,COUNT(DISTINCT seller) sellers,COUNT(DISTINCT buyer) buyers,
    COUNT(DISTINCT sold_asset) assets,date(MIN(block_time),'unixepoch') first_date,
    date(MAX(block_time),'unixepoch') last_date
  FROM classified JOIN money ON money.asset_id=classified.money_asset
  GROUP BY currency,CASE WHEN known_delivery=1 THEN 'known_trade' ELSE cohort END
  ORDER BY currency,matches DESC`).rows;

const assets = executeRemoteD1(`${cte}
  SELECT sold.asset,money.asset currency,cohort,COUNT(*) matches,
    COUNT(DISTINCT seller) sellers,COUNT(DISTINCT buyer) buyers,
    SUM(money_qty) quote_total,
    SUM(CASE WHEN price.usd>0 THEN money_qty*price.usd ELSE 0 END) usd_known,
    SUM(CASE WHEN price.usd>0 THEN 1 ELSE 0 END) usd_priced
  FROM classified JOIN asset_dictionary sold ON sold.asset_id=classified.sold_asset
  JOIN money ON money.asset_id=classified.money_asset
  LEFT JOIN prices price ON price.currency=money.asset AND price.day=date(classified.block_time,'unixepoch')
  WHERE known_delivery=0 GROUP BY sold.asset,money.asset,cohort
  ORDER BY matches DESC LIMIT 250`).rows;

const delay = executeRemoteD1(`${cte}
  SELECT money.asset currency,output_block-payment_block delay_blocks,COUNT(*) matches
  FROM classified JOIN money ON money.asset_id=classified.money_asset
  WHERE known_delivery=0 GROUP BY currency,delay_blocks ORDER BY currency,delay_blocks`).rows;

const candidates = executeRemoteD1(`${cte}
  SELECT date(classified.block_time,'unixepoch') day,buyer_address.address buyer,
    seller_address.address seller,sold.asset,money.asset currency,
    sold_qty quantity,money_qty total,
    CASE WHEN price.usd>0 THEN ROUND(money_qty*price.usd,2) END usd_value,
    output_block-payment_block delay_blocks,lower(hex(payment_hash)) payment_tx,
    lower(hex(output_hash)) delivery_tx,cohort
  FROM classified
  JOIN address_dictionary buyer_address ON buyer_address.address_id=classified.buyer
  JOIN address_dictionary seller_address ON seller_address.address_id=classified.seller
  JOIN asset_dictionary sold ON sold.asset_id=classified.sold_asset
  JOIN money ON money.asset_id=classified.money_asset
  LEFT JOIN prices price ON price.currency=money.asset AND price.day=date(classified.block_time,'unixepoch')
  WHERE known_delivery=0 AND cohort<>'mechanical_vendor'
  ORDER BY classified.block_time,classified.payment_event`).rows;

const report = {
  generated_at: new Date().toISOString(),
  status: "research candidates only; not canonical trades",
  policy: {
    evidence: "Counterparty ledger only; no Telegram or other off-chain attribution",
    quote_assets: ["XCP", "PEPECASH"],
    payment_before_delivery_blocks: [0, WINDOW_BLOCKS],
    ambiguity: "exactly one possible payment and one possible delivery",
    known_trade_deliveries: "reported separately and excluded from novel candidates",
  },
  summary,
  delay,
  assets,
  candidates,
};
writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, summary, novel_candidates: candidates.length }, null, 2));
