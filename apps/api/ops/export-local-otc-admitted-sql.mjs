#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const censusPath = resolve(option("database", "C:/BitcoinIndex/otc-final.sqlite"));
const ledgerPath = resolve(option("ledger-database", "C:/BitcoinIndex/otc-ledger.sqlite"));
const outputPath = resolve(option("output", ".codex-tmp/import-automated-otc.sql"));
const batchSize = Math.max(10, Math.min(200, Number(option("batch-size", "100"))));
const sqlText = (value) => (value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const sqlNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Non-finite SQL number: ${value}`);
  return String(number);
};
const sqlBlob = (value) => `X'${Buffer.from(value).toString("hex")}'`;

const db = new DatabaseSync(censusPath, { readOnly: true });
db.exec(`ATTACH DATABASE ${sqlText(ledgerPath)} AS ledger`);
const rows = db
  .prepare(
    `SELECT candidate.*,asset.asset,seller.address seller,buyer.address buyer,
    price.usd btc_usd,candidate.payment_sats/1e8*price.usd usd_value
  FROM final_admitted candidate JOIN ledger.asset_dictionary asset USING(asset_id)
  JOIN ledger.address_dictionary seller ON seller.address_id=candidate.seller_id
  JOIN ledger.address_dictionary buyer ON buyer.address_id=candidate.buyer_id
  LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(candidate.btc_time,'unixepoch')
  ORDER BY candidate.event_index,candidate.primary_tx_id`,
  )
  .all()
  .map((row) => {
    const btcTx = Buffer.from(row.primary_btc_tx_hash).toString("hex");
    return { ...row, btcTx, ref: `${row.event_index}:${btcTx}`, payments: JSON.parse(row.payment_json) };
  });
if (!rows.length) throw new Error("The final census has no admitted OTC rows");
const indexedThroughBlock = Math.max(...rows.map((row) => Number(row.indexed_through_block)));
const methodVersion = Math.max(...rows.map((row) => Number(row.method_version)));

const statements = [
  "-- Generated from the validated versioned Bitcoin/Counterparty OTC census.",
  "DELETE FROM otc_import_refs;",
];
for (let offset = 0; offset < rows.length; offset += batchSize) {
  const batch = rows.slice(offset, offset + batchSize);
  statements.push(
    `INSERT INTO otc_import_refs(ref) VALUES ${batch.map((row) => `(${sqlText(row.ref)})`).join(",")} ON CONFLICT(ref) DO NOTHING;`,
  );
  statements.push(`INSERT INTO otc_trade_evidence(
    ref,asset_event_index,asset_tx_hash,btc_tx_hash,btc_payment_block,asset_delivery_block,
    relative_blocks,payment_sats,payer_input_count,payee_output_count,attribution_flags,
    competing_payments,competing_deliveries,confidence,method,method_version,indexed_through_block,
    evidence_note,reviewed_at
  ) VALUES
${batch
  .map(
    (row) =>
      `(${sqlText(row.ref)},${row.event_index},${sqlBlob(row.asset_tx_hash)},${sqlText(row.btcTx)},${row.btc_block},${row.asset_block},${row.relative_blocks},${row.payment_sats},${row.payer_input_count},${row.payee_output_count},${row.attribution_flags},0,0,'likely',${sqlText(row.method)},${row.method_version},${row.indexed_through_block},${sqlText(row.evidence_note)},NULL)`,
  )
  .join(",\n")}
  ON CONFLICT(ref) DO UPDATE SET
    asset_event_index=excluded.asset_event_index,asset_tx_hash=excluded.asset_tx_hash,
    btc_tx_hash=excluded.btc_tx_hash,btc_payment_block=excluded.btc_payment_block,
    asset_delivery_block=excluded.asset_delivery_block,relative_blocks=excluded.relative_blocks,
    payment_sats=excluded.payment_sats,payer_input_count=excluded.payer_input_count,
    payee_output_count=excluded.payee_output_count,attribution_flags=excluded.attribution_flags,
    confidence=excluded.confidence,method=excluded.method,method_version=excluded.method_version,
    indexed_through_block=excluded.indexed_through_block,evidence_note=excluded.evidence_note;`);

  statements.push(`INSERT INTO trades(
    venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,
    buyer_id,seller_id,tx_hash,sale_class
  ) VALUES
${batch
  .map(
    (row) =>
      `('otc',${sqlText(row.ref)},${row.asset_id},${row.asset_time},${row.asset_block},${sqlNumber(row.quantity)},'BTC',${sqlNumber(row.payment_sats / 1e8)},${row.usd_value == null ? "NULL" : sqlNumber(row.usd_value)},${row.buyer_id},${row.seller_id},${sqlBlob(row.asset_tx_hash)},'likely')`,
  )
  .join(",\n")}
  ON CONFLICT(venue,ref) DO UPDATE SET
    asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
    quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,usd_value=excluded.usd_value,
    buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash,
    sale_class=excluded.sale_class;`);

  statements.push(
    `DELETE FROM otc_trade_payments WHERE evidence_ref IN (${batch.map((row) => sqlText(row.ref)).join(",")});`,
  );
  const payments = batch.flatMap((row) => row.payments.map((payment) => ({ ref: row.ref, ...payment })));
  statements.push(`INSERT INTO otc_trade_payments(
    evidence_ref,btc_tx_hash,btc_payment_block,btc_payment_time,payment_sats
  ) VALUES
${payments
  .map(
    (payment) =>
      `(${sqlText(payment.ref)},${sqlText(payment.tx_hash)},${payment.block},${payment.time},${payment.sats})`,
  )
  .join(",\n")};`);
}

statements.push(`INSERT OR IGNORE INTO otc_trade_payments(
  evidence_ref,btc_tx_hash,btc_payment_block,btc_payment_time,payment_sats
)
SELECT evidence.ref,evidence.btc_tx_hash,evidence.btc_payment_block,block.block_time,evidence.payment_sats
FROM otc_trade_evidence evidence JOIN blocks block ON block.block_index=evidence.btc_payment_block
WHERE NOT EXISTS(SELECT 1 FROM otc_trade_payments payment WHERE payment.evidence_ref=evidence.ref);`);

statements.push(`INSERT OR IGNORE INTO asset_signal_dirty(asset_id)
  SELECT DISTINCT trade.asset_id FROM trades trade JOIN otc_trade_evidence evidence ON evidence.ref=trade.ref
  WHERE trade.venue='otc' AND evidence.reviewed_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM otc_import_refs keep WHERE keep.ref=trade.ref);`);
statements.push(`DELETE FROM trades WHERE venue='otc' AND ref IN (
  SELECT evidence.ref FROM otc_trade_evidence evidence WHERE evidence.reviewed_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM otc_import_refs keep WHERE keep.ref=evidence.ref)
);`);
statements.push(`DELETE FROM otc_trade_evidence WHERE reviewed_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM otc_import_refs keep WHERE keep.ref=otc_trade_evidence.ref);`);
statements.push(`INSERT OR IGNORE INTO asset_signal_dirty(asset_id)
  SELECT DISTINCT asset_id FROM trades WHERE venue='otc';`);
statements.push("DELETE FROM otc_import_refs;");

writeFileSync(outputPath, `${statements.join("\n\n")}\n`);
console.log(
  JSON.stringify(
    {
      event: "complete",
      rows: rows.length,
      assets: new Set(rows.map((row) => Number(row.asset_id))).size,
      btc: rows.reduce((sum, row) => sum + Number(row.payment_sats) / 1e8, 0),
      usd_known: rows.filter((row) => row.usd_value != null).length,
      usd: rows.reduce((sum, row) => sum + Number(row.usd_value ?? 0), 0),
      payment_legs: rows.reduce((sum, row) => sum + row.payments.length, 0),
      method_version: methodVersion,
      indexed_through_block: indexedThroughBlock,
      outputPath,
    },
    null,
    2,
  ),
);
db.close();
