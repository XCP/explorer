#!/usr/bin/env node

/** Merge the reviewed one-off shadow set into the exportable local OTC authority. */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const option = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const finalPath = resolve(option("database", "C:/BitcoinIndex/otc-final.sqlite"));
const shadowPath = resolve(option("shadow-database", "C:/BitcoinIndex/otc-oneoff-shadow.sqlite"));
const outputPath = resolve(option("output", ".codex-tmp/otc-oneoff-promotion.json"));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const db = new DatabaseSync(finalPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;
  ATTACH DATABASE ${quote(shadowPath)} AS shadow;`);

const finalThrough = Number(db.prepare("SELECT max(indexed_through_block) height FROM final_admitted").get().height);
const shadowThrough = Number(
  db.prepare("SELECT max(indexed_through_block) height FROM shadow.oneoff_promoted").get().height,
);
if (!finalThrough || finalThrough !== shadowThrough)
  throw new Error(`Watermark mismatch: final=${finalThrough}, one-off=${shadowThrough}`);

const conflicts = db
  .prepare(
    `SELECT
      sum(EXISTS(SELECT 1 FROM final_admitted accepted
        WHERE accepted.event_index=promoted.event_index)) event_overlaps,
      sum(EXISTS(SELECT 1 FROM final_admitted accepted
        WHERE accepted.primary_tx_id=promoted.tx_id)) payment_overlaps
    FROM shadow.oneoff_promoted promoted`,
  )
  .get();
if (Number(conflicts.event_overlaps) || Number(conflicts.payment_overlaps))
  throw new Error(`Promotion conflicts: ${JSON.stringify(conflicts)}`);

db.exec(`INSERT INTO final_admitted(
    event_index,asset_tx_hash,asset_block,asset_time,seller_id,buyer_id,asset_id,quantity,
    primary_tx_id,primary_btc_tx_hash,btc_block,btc_time,payment_sats,payer_input_count,
    payee_output_count,attribution_flags,relative_blocks,method,method_version,
    indexed_through_block,lane_candidates,lane_buyers,price_ratio,evidence_note,payment_json
  )
  SELECT promoted.event_index,promoted.asset_tx_hash,promoted.asset_block,promoted.asset_time,
    promoted.seller_id,promoted.buyer_id,promoted.asset_id,promoted.quantity,promoted.tx_id,
    promoted.btc_tx_hash,promoted.btc_block,promoted.btc_time,promoted.payment_sats,
    promoted.payer_input_count,promoted.payee_output_count,promoted.attribution_flags,
    promoted.relative_blocks,promoted.method,3,promoted.indexed_through_block,1,1,
    coalesce(promoted.ratio_30d,promoted.ratio_180d,1),
    promoted.evidence_note || CASE
      WHEN promoted.relative_blocks=0 AND promoted.payment_position>promoted.delivery_position
        THEN '; asset delivery preceded payment within the same block'
      WHEN promoted.relative_blocks=0 THEN '; payment preceded asset delivery within the same block'
      ELSE '; payment preceded asset delivery by 1-3 blocks' END,
    json_array(json_object('tx_hash',lower(hex(promoted.btc_tx_hash)),
      'block',promoted.btc_block,'time',promoted.btc_time,'sats',promoted.payment_sats))
  FROM shadow.oneoff_promoted promoted;`);

const report = {
  generated_at: Math.floor(Date.now() / 1000),
  indexed_through: finalThrough,
  promoted: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
      count(DISTINCT seller_id) sellers,round(sum(payment_sats)/1e8,8) btc
      FROM final_admitted WHERE method_version=3`,
    )
    .get(),
  final: db
    .prepare(
      `SELECT count(*) trades,count(DISTINCT asset_id) assets,count(DISTINCT buyer_id) buyers,
      count(DISTINCT seller_id) sellers,round(sum(payment_sats)/1e8,8) btc
      FROM final_admitted`,
    )
    .get(),
  conflicts,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
db.close();
