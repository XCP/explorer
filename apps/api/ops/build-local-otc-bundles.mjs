#!/usr/bin/env node

/**
 * Bundle OTC admission, version 4: one BTC payment for several asset deliveries between the same
 * buyer and seller. Consideration attaches to the bundle (sale_class='bundle' plus trade_legs);
 * no per-asset price is ever invented, and bundle trades carry no asset_id, so they never touch
 * per-asset volume, unit-price lanes, or reference prices.
 *
 * One process: materialize bundles from the census, classify with the case-validated screens,
 * write the audited verdict table locally, and emit idempotent D1 upserts for the admitted set.
 *
 * Screens (each justified by a reviewed case):
 *  - infrastructure endpoints (exchange/deposit/burn/vault/service) are excluded outright;
 *  - repeated reciprocal BTC flow between the pair rejects custodial shuttles and service orbits
 *    (91 BTC "payment" between wallets with 5,500 mutual transfers), ignoring legacy Counterparty
 *    send-dust below 10,000 sats;
 *  - a payment/expected-value ratio above 100x rejects provable mispairs (0.5 BTC "for" 420
 *    PEPECASH at 5,900x); expected value is the sum of 180-day market medians over priceable legs,
 *    and real premium lots (2x-40x over thin medians) are deliberately NOT rejected;
 *  - buyer forwarding a bundle asset into a registered Emblem vault shortly after delivery
 *    upgrades confidence to corroborated (the GODANUBIS/GODDESSISIS 7.3055 BTC pair).
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const option = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const censusPath = resolve(option("census", "C:/BitcoinIndex/otc-census-authoritative-20260726.sqlite"));
const ledgerPath = resolve(option("ledger", "C:/BitcoinIndex/otc-ledger.sqlite"));
const oneoffPath = resolve(option("oneoff", "C:/BitcoinIndex/otc-oneoff-authoritative-20260726.sqlite"));
const bitcoinPath = resolve(option("bitcoin", "C:/BitcoinIndex/counterparty-bitcoin.sqlite"));
const priorPath = resolve(option("prior", "C:/BitcoinIndex/otc-authoritative-20260726.sqlite"));
const outputDbPath = resolve(option("output-database", "C:/BitcoinIndex/otc-bundles-20260727.sqlite"));
const outputSqlPath = resolve(option("output-sql", ".codex-tmp/import-otc-bundles.sql"));
const summaryPath = resolve(option("summary", ".codex-tmp/otc-bundle-summary.json"));

const DUST_SATS = 10_000;
const RECIPROCAL_MIN_EACH_WAY = 3;
const SHUTTLE_FLOW_COUNT = 50;
const MISPAIR_RATIO = 100;
const MISPAIR_MIN_EXPECTED_USD = 1;
const MEDIAN_WINDOW_SECONDS = 180 * 86_400;
const MEDIAN_MIN_OBSERVATIONS = 3;
const VAULT_FORWARD_WINDOW_BLOCKS = 1_000;
const METHOD = "bundle_btc_payment";
const METHOD_VERSION = 4;

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const db = new DatabaseSync(outputDbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;
  ATTACH DATABASE ${quote(censusPath)} AS census;
  ATTACH DATABASE ${quote(ledgerPath)} AS ledger;
  ATTACH DATABASE ${quote(oneoffPath)} AS oneoff;
  ATTACH DATABASE ${quote(bitcoinPath)} AS bitcoin;
  ATTACH DATABASE ${quote(priorPath)} AS prior;`);

const indexedThroughBlock = Number(
  db.prepare("SELECT max(indexed_through_block) height FROM census.otc_candidate").get().height,
);

// --emit-only regenerates the D1 SQL from an existing classification without recomputing it.
const emitOnly = process.argv.includes("--emit-only");
if (!emitOnly) {
  db.exec(`DROP TABLE IF EXISTS main.bundle_classified;
CREATE TABLE main.bundle_classified(
  btc_tx_hash BLOB NOT NULL,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  btc_block INTEGER NOT NULL,
  btc_time INTEGER NOT NULL,
  payment_sats INTEGER NOT NULL,
  legs INTEGER NOT NULL,
  first_event_index INTEGER NOT NULL,
  delivery_block INTEGER NOT NULL,
  delivery_time INTEGER NOT NULL,
  priced_legs INTEGER NOT NULL,
  expected_usd REAL NOT NULL,
  payment_usd REAL,
  flows_buyer_to_seller INTEGER NOT NULL,
  flows_seller_to_buyer INTEGER NOT NULL,
  vault_forward_legs INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  confidence TEXT,
  evidence_note TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  indexed_through_block INTEGER NOT NULL,
  PRIMARY KEY(btc_tx_hash,buyer_id,seller_id)
) WITHOUT ROWID;
DROP TABLE IF EXISTS main.bundle_leg;
CREATE TABLE main.bundle_leg(
  btc_tx_hash BLOB NOT NULL,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  leg_index INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  asset_tx_hash BLOB NOT NULL,
  asset_block INTEGER NOT NULL,
  PRIMARY KEY(btc_tx_hash,buyer_id,seller_id,leg_index)
) WITHOUT ROWID;

CREATE TEMP TABLE market_unit AS
  SELECT asset_id,block_time,usd_value/quantity unit_usd
  FROM oneoff.market_trade WHERE quantity>0 AND usd_value>0;
CREATE INDEX temp.market_unit_asset ON market_unit(asset_id,block_time);`);

  const bundles = db
    .prepare(
      `WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id,seller_id) deliveries FROM census.raw_match match
  )
  SELECT tx_id,buyer_id,seller_id,min(btc_tx_hash) btc_tx_hash,min(btc_block) btc_block,
    min(btc_time) btc_time,max(payment_sats) payment_sats,count(*) legs,
    min(event_index) first_event_index,min(asset_block) delivery_block,min(asset_time) delivery_time
  FROM ranked WHERE payments=1 AND deliveries>1 GROUP BY tx_id,buyer_id,seller_id`,
    )
    .all();

  const legStmt = db.prepare(`WITH ranked AS (
    SELECT match.*,count(*) OVER(PARTITION BY event_index) payments,
      count(*) OVER(PARTITION BY tx_id,buyer_id,seller_id) deliveries FROM census.raw_match match
  )
  SELECT event_index,asset_id,quantity,asset_tx_hash,asset_block FROM ranked
  WHERE payments=1 AND deliveries>1 AND tx_id=? AND buyer_id=? AND seller_id=?
  ORDER BY event_index`);
  const signalStmt = db.prepare(`SELECT coalesce(is_exchange,0)+coalesce(is_deposit,0)+coalesce(is_burn,0)+
    coalesce(is_emblem_vault,0)+coalesce(likely_service,0) flags
  FROM ledger.address_signals WHERE address_id=?`);
  const addressStmt = db.prepare("SELECT address FROM ledger.address_dictionary WHERE address_id=?");
  const priceStmt = db.prepare("SELECT usd FROM ledger.prices WHERE currency='BTC' AND day=date(?,'unixepoch')");
  const medianStmt = db.prepare(`WITH obs AS (
    SELECT unit_usd,row_number() OVER(ORDER BY unit_usd) rn,count(*) OVER() n
    FROM market_unit WHERE asset_id=? AND block_time BETWEEN ?-${MEDIAN_WINDOW_SECONDS} AND ?+${MEDIAN_WINDOW_SECONDS}
  ) SELECT avg(unit_usd) median_usd,max(n) observations FROM obs WHERE rn IN ((n+1)/2,(n+2)/2)`);
  const watchedStmt = db.prepare("SELECT address_id FROM bitcoin.watched_address WHERE address=?");
  const flowStmt = db.prepare(
    `SELECT count(*) n FROM bitcoin.btc_direct_flow WHERE payer_id=? AND payee_id=? AND value_sats>${DUST_SATS}`,
  );
  // The ledger export populates source_id/destination_id; the *_address_id columns are null for
  // most rows. Coalesce so vault forwarding is visible for every send era.
  const vaultForwardStmt = db.prepare(`SELECT count(DISTINCT send.asset_id) n
  FROM ledger.sends send JOIN ledger.address_signals vault
    ON vault.address_id=coalesce(send.destination_address_id,send.destination_id) AND vault.is_emblem_vault=1
  WHERE coalesce(send.source_address_id,send.source_id)=? AND send.asset_id IN (SELECT value FROM json_each(?))
    AND send.block_index BETWEEN ? AND ?+${VAULT_FORWARD_WINDOW_BLOCKS}`);
  const priorPaymentStmt = db.prepare("SELECT 1 x FROM prior.final_admitted WHERE primary_btc_tx_hash=? LIMIT 1");
  const priorEventStmt = db.prepare("SELECT 1 x FROM prior.final_admitted WHERE event_index=? LIMIT 1");

  const insertClassified = db.prepare(`INSERT INTO bundle_classified VALUES
  (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertLeg = db.prepare("INSERT INTO bundle_leg VALUES (?,?,?,?,?,?,?,?,?)");

  // Repeat-price bundle lanes mirror direct_btc_two_match_lane: the same seller shipping the same
  // asset composition to several independent buyers at a stable price is admissible even when thin
  // market medians disagree (five buyers paid ~$490 each for NEWPEPEDESU bundles the median called
  // $2). Lane membership overrides the mispair rejection, never the infrastructure screens.
  const laneKey = (sellerId, legs) =>
    `${sellerId}|${legs
      .map((leg) => leg.asset_id)
      .sort((a, b) => a - b)
      .join(",")}`;
  const lanes = new Map();
  const bundleLegs = new Map();
  for (const bundle of bundles) {
    const legs = legStmt.all(bundle.tx_id, bundle.buyer_id, bundle.seller_id);
    bundleLegs.set(`${bundle.tx_id}|${bundle.buyer_id}|${bundle.seller_id}`, legs);
    const key = laneKey(bundle.seller_id, legs);
    const lane = lanes.get(key) ?? { bundles: 0, buyers: new Set(), minSats: Infinity, maxSats: 0 };
    lane.bundles += 1;
    lane.buyers.add(bundle.buyer_id);
    lane.minSats = Math.min(lane.minSats, bundle.payment_sats);
    lane.maxSats = Math.max(lane.maxSats, bundle.payment_sats);
    lanes.set(key, lane);
  }

  const tally = {};
  db.exec("BEGIN");
  for (const bundle of bundles) {
    const legs = bundleLegs.get(`${bundle.tx_id}|${bundle.buyer_id}|${bundle.seller_id}`);
    const paymentUsd = (() => {
      const usd = priceStmt.get(bundle.btc_time)?.usd;
      return usd ? (bundle.payment_sats / 1e8) * usd : null;
    })();
    const buyerFlags = Number(signalStmt.get(bundle.buyer_id)?.flags ?? 0);
    const sellerFlags = Number(signalStmt.get(bundle.seller_id)?.flags ?? 0);
    const buyerAddress = addressStmt.get(bundle.buyer_id)?.address;
    const sellerAddress = addressStmt.get(bundle.seller_id)?.address;
    const buyerBtc = buyerAddress ? watchedStmt.get(buyerAddress)?.address_id : null;
    const sellerBtc = sellerAddress ? watchedStmt.get(sellerAddress)?.address_id : null;
    const ab = buyerBtc && sellerBtc ? Number(flowStmt.get(buyerBtc, sellerBtc).n) : 0;
    const ba = buyerBtc && sellerBtc ? Number(flowStmt.get(sellerBtc, buyerBtc).n) : 0;

    let pricedLegs = 0;
    let expectedUsd = 0;
    for (const leg of legs) {
      const median = medianStmt.get(leg.asset_id, bundle.btc_time, bundle.btc_time);
      if (median?.median_usd != null && Number(median.observations) >= MEDIAN_MIN_OBSERVATIONS) {
        pricedLegs += 1;
        expectedUsd += leg.quantity * median.median_usd;
      }
    }
    const vaultForwardLegs = Number(
      vaultForwardStmt.get(
        bundle.buyer_id,
        JSON.stringify(legs.map((leg) => leg.asset_id)),
        bundle.delivery_block,
        bundle.delivery_block,
      ).n,
    );

    let verdict;
    let confidence = null;
    let note;
    if (buyerFlags > 0 || sellerFlags > 0) {
      verdict = "reject_infrastructure";
      note = "Buyer or seller carries an exchange, deposit, burn, vault, or service classification";
    } else if (Math.min(ab, ba) >= RECIPROCAL_MIN_EACH_WAY || Math.max(ab, ba) >= SHUTTLE_FLOW_COUNT) {
      verdict = "reject_reciprocal";
      note = `Repeated reciprocal BTC flow between the pair (${ab} buyer->seller, ${ba} seller->buyer non-dust); custodial shuttle or ongoing service relationship`;
    } else if (priorPaymentStmt.get(bundle.btc_tx_hash) || legs.some((leg) => priorEventStmt.get(leg.event_index))) {
      verdict = "reject_already_admitted";
      note = "The payment or a delivery already belongs to an admitted OTC trade";
    } else if (
      paymentUsd != null &&
      expectedUsd >= MISPAIR_MIN_EXPECTED_USD &&
      paymentUsd / expectedUsd > MISPAIR_RATIO &&
      !(() => {
        const lane = lanes.get(laneKey(bundle.seller_id, legs));
        return lane.bundles >= 3 && lane.buyers.size >= 2 && lane.maxSats / lane.minSats <= 1.25;
      })()
    ) {
      verdict = "reject_mispair";
      note = `Payment is ${Math.round(paymentUsd / expectedUsd)}x the summed 180-day market value of the priceable legs; treated as a coincidental payment, not consideration`;
    } else {
      verdict = "admit";
      confidence = vaultForwardLegs > 0 ? "corroborated" : "likely";
      const priced =
        pricedLegs > 0
          ? `${pricedLegs}/${legs.length} legs priceable, payment ${expectedUsd > 0 && paymentUsd != null ? (paymentUsd / expectedUsd).toFixed(2) : "n/a"}x their summed 180-day medians`
          : `${legs.length} legs without market medians; admission rests on unique pairing and one-way flow`;
      const vault =
        vaultForwardLegs > 0
          ? `; buyer forwarded ${vaultForwardLegs} bundle asset(s) into registered Emblem vaults within ${VAULT_FORWARD_WINDOW_BLOCKS} blocks of delivery`
          : "";
      const lane = lanes.get(laneKey(bundle.seller_id, legs));
      const laneNote =
        paymentUsd != null && expectedUsd >= MISPAIR_MIN_EXPECTED_USD && paymentUsd / expectedUsd > MISPAIR_RATIO
          ? `; admitted via repeat-price bundle lane (${lane.bundles} bundles, ${lane.buyers.size} independent buyers, stable payments)`
          : "";
      note = `One BTC payment for ${legs.length} asset deliveries between one buyer and one seller; ${priced}${vault}${laneNote}`;
    }

    insertClassified.run(
      bundle.btc_tx_hash,
      bundle.buyer_id,
      bundle.seller_id,
      bundle.btc_block,
      bundle.btc_time,
      bundle.payment_sats,
      legs.length,
      bundle.first_event_index,
      bundle.delivery_block,
      bundle.delivery_time,
      pricedLegs,
      expectedUsd,
      paymentUsd,
      ab,
      ba,
      vaultForwardLegs,
      verdict,
      confidence,
      note,
      METHOD_VERSION,
      indexedThroughBlock,
    );
    legs.forEach((leg, legIndex) =>
      insertLeg.run(
        bundle.btc_tx_hash,
        bundle.buyer_id,
        bundle.seller_id,
        legIndex,
        leg.event_index,
        leg.asset_id,
        leg.quantity,
        leg.asset_tx_hash,
        leg.asset_block,
      ),
    );
    const key = confidence ? `${verdict}_${confidence}` : verdict;
    tally[key] ??= { n: 0, usd: 0 };
    tally[key].n += 1;
    tally[key].usd += paymentUsd ?? 0;
  }
  db.exec("COMMIT");
}

const sqlText = (value) => (value == null ? "NULL" : quote(value));
const sqlBlob = (value) => `X'${Buffer.from(value).toString("hex")}'`;
const admitted = db
  .prepare(
    `SELECT classified.*,price.usd btc_usd FROM bundle_classified classified
   LEFT JOIN ledger.prices price ON price.currency='BTC' AND price.day=date(classified.btc_time,'unixepoch')
   WHERE verdict='admit' ORDER BY classified.btc_block`,
  )
  .all();
const admittedLegs = db.prepare(
  "SELECT * FROM bundle_leg WHERE btc_tx_hash=? AND buyer_id=? AND seller_id=? ORDER BY leg_index",
);

// One Bitcoin transaction can batch payments to several sellers, so the first delivery's event
// index joins the payment hash in the ref. The preamble removes every prior bundle projection:
// this method's rows are wholly regenerated on each run, so stale refs never linger.
const statements = [
  "-- Generated by build-local-otc-bundles.mjs (bundle OTC admission, method version 4).",
  `DELETE FROM otc_trade_payments WHERE evidence_ref IN (SELECT ref FROM otc_trade_evidence WHERE method='${METHOD}');`,
  "DELETE FROM trade_legs WHERE venue='otc' AND trade_ref LIKE 'bundle:%';",
  "DELETE FROM trades WHERE venue='otc' AND sale_class='bundle';",
  `DELETE FROM otc_trade_evidence WHERE method='${METHOD}';`,
];
for (const row of admitted) {
  const btcTx = Buffer.from(row.btc_tx_hash).toString("hex");
  const ref = `bundle:${btcTx}:${row.first_event_index}`;
  const legs = admittedLegs.all(row.btc_tx_hash, row.buyer_id, row.seller_id);
  const usdValue = row.btc_usd ? (row.payment_sats / 1e8) * row.btc_usd : null;
  statements.push(`INSERT INTO otc_import_refs(ref) VALUES (${sqlText(ref)}) ON CONFLICT(ref) DO NOTHING;`);
  statements.push(`INSERT INTO trades(venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,buyer_id,seller_id,tx_hash,external_tx_hash,sale_class)
VALUES('otc',${sqlText(ref)},NULL,${row.delivery_time},${row.delivery_block},NULL,'BTC',${row.payment_sats / 1e8},${usdValue == null ? "NULL" : usdValue},${row.buyer_id},${row.seller_id},${sqlBlob(row.btc_tx_hash)},NULL,'bundle')
ON CONFLICT(venue,ref) DO UPDATE SET block_time=excluded.block_time,block_index=excluded.block_index,
  total=excluded.total,usd_value=excluded.usd_value,buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,
  tx_hash=excluded.tx_hash,sale_class=excluded.sale_class;`);
  statements.push(`DELETE FROM trade_legs WHERE venue='otc' AND trade_ref=${sqlText(ref)};
INSERT INTO trade_legs(venue,trade_ref,leg_index,asset_id,quantity) VALUES
${legs.map((leg) => `('otc',${sqlText(ref)},${leg.leg_index},${leg.asset_id},${leg.quantity})`).join(",\n")};`);
  statements.push(`INSERT INTO otc_trade_evidence(
  ref,asset_event_index,asset_tx_hash,btc_tx_hash,btc_payment_block,asset_delivery_block,
  relative_blocks,payment_sats,payer_input_count,payee_output_count,attribution_flags,
  competing_payments,competing_deliveries,confidence,method,method_version,indexed_through_block,
  evidence_note,reviewed_at)
VALUES(${sqlText(ref)},${row.first_event_index},${sqlBlob(legs[0].asset_tx_hash)},${sqlText(btcTx)},${row.btc_block},${row.delivery_block},${row.btc_block - row.delivery_block},${row.payment_sats},1,1,0,0,${row.legs},${sqlText(row.confidence)},${sqlText(METHOD)},${METHOD_VERSION},${row.indexed_through_block},${sqlText(row.evidence_note)},NULL)
ON CONFLICT(ref) DO UPDATE SET confidence=excluded.confidence,method=excluded.method,
  method_version=excluded.method_version,indexed_through_block=excluded.indexed_through_block,
  evidence_note=excluded.evidence_note;`);
  statements.push(`INSERT INTO otc_trade_payments(evidence_ref,btc_tx_hash,btc_payment_block,btc_payment_time,payment_sats)
VALUES(${sqlText(ref)},${sqlText(btcTx)},${row.btc_block},${row.btc_time},${row.payment_sats})
ON CONFLICT(evidence_ref,btc_tx_hash) DO UPDATE SET btc_payment_block=excluded.btc_payment_block,
  btc_payment_time=excluded.btc_payment_time,payment_sats=excluded.payment_sats;`);
}
writeFileSync(outputSqlPath, `${statements.join("\n")}\n`);

const verdictTally = Object.fromEntries(
  db
    .prepare(
      `SELECT verdict||coalesce('_'||confidence,'') key,count(*) n,round(coalesce(sum(payment_usd),0)) usd
       FROM bundle_classified GROUP BY 1 ORDER BY n DESC`,
    )
    .all()
    .map((row) => [row.key, { n: row.n, usd: row.usd }]),
);
const summary = {
  generated_at: Math.floor(Date.now() / 1000),
  indexed_through: indexedThroughBlock,
  bundles: Number(db.prepare("SELECT count(*) n FROM bundle_classified").get().n),
  verdicts: verdictTally,
  admitted_sql: outputSqlPath,
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
db.close();
