#!/usr/bin/env node

/**
 * Read-only, ledger-only OTC survey.
 *
 * Starts with Counterparty asset sends carrying a recent clean realized-value mark,
 * then asks Electrs whether the asset recipient paid BTC directly to the sender near
 * the asset delivery. This produces candidates, never canonical trades.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const COUNTERPARTY_API = process.env.COUNTERPARTY_API_BASE || "https://api.counterparty.io:4000";
const ELECTRS = process.env.ELECTRS_API_BASE || "https://api.counterparty.io:3000";
const LIMIT = Number(process.env.LEDGER_OTC_LIMIT || 500);
const MIN_USD = Number(process.env.LEDGER_OTC_MIN_USD || 100);
const VALUABLE_ASSET_LIMIT = Number(process.env.LEDGER_OTC_VALUABLE_ASSET_LIMIT || 250);
const MAX_ADDRESS_TXS = Number(process.env.LEDGER_OTC_MAX_ADDRESS_TXS || 0);
const MAX_PAGES = Number(process.env.LEDGER_OTC_MAX_PAGES || 500);
const WINDOW_BLOCKS = Number(process.env.LEDGER_OTC_WINDOW_BLOCKS || 1008);
const MIN_BTC_SATS = Number(process.env.LEDGER_OTC_MIN_BTC_SATS || 10_000);
const MIN_BLOCK = Number(process.env.LEDGER_OTC_MIN_BLOCK || 0);
const MAX_BLOCK = Number(process.env.LEDGER_OTC_MAX_BLOCK || 1_000_000);
const SENDS_PER_ASSET = Number(process.env.LEDGER_OTC_SENDS_PER_ASSET || 5);
const SEND_OFFSET = Number(process.env.LEDGER_OTC_SEND_OFFSET || 0);
const ASSET_QUEUE_OFFSET = Number(process.env.LEDGER_OTC_ASSET_QUEUE_OFFSET || 0);
const ASSET_QUEUE_LIMIT = Number(process.env.LEDGER_OTC_ASSET_QUEUE_LIMIT || Math.ceil(LIMIT / SENDS_PER_ASSET));
const OUTPUT = resolve(process.env.LEDGER_OTC_OUTPUT || "../../docs/data/ledger-otc-bitcoin-2026-07-19.json");

const valuableAssets = executeRemoteD1(`SELECT signal.asset_id,dictionary.asset,
    signal.max_realized_usd,signal.trades,signal.holders
  FROM asset_signals signal JOIN asset_dictionary dictionary USING(asset_id)
  WHERE signal.low_quality=0
    AND dictionary.asset<>'BTC'
    AND (signal.max_realized_usd>=${MIN_USD} OR dictionary.asset IN ('XCP','PEPECASH'))
  ORDER BY signal.trades DESC,signal.max_realized_usd DESC LIMIT ${VALUABLE_ASSET_LIMIT}`)
  .rows.map((row) => ({
    ...row,
    evidence_score:
      Math.log1p(Number(row.trades)) *
      Math.log1p(Number(row.max_realized_usd)) *
      (1 + Math.log1p(Number(row.holders || 0)) / 20),
  }))
  .sort((a, b) => {
    const aCore = a.asset === "XCP" ? 2 : a.asset === "PEPECASH" ? 1 : 0;
    const bCore = b.asset === "XCP" ? 2 : b.asset === "PEPECASH" ? 1 : 0;
    return bCore - aCore || b.evidence_score - a.evidence_score;
  });
if (!valuableAssets.length) throw new Error("No valuable assets matched the survey threshold");
const assetValues = new Map(
  valuableAssets.map((row) => [
    Number(row.asset_id),
    {
      asset: row.asset,
      maxRealizedUsd: Number(row.max_realized_usd),
      trades: Number(row.trades),
      holders: Number(row.holders || 0),
      evidenceScore: row.evidence_score,
    },
  ]),
);
const xcpId = valuableAssets.find((row) => row.asset === "XCP")?.asset_id;
const pepecashId = valuableAssets.find((row) => row.asset === "PEPECASH")?.asset_id;
if (xcpId == null || pepecashId == null) throw new Error("XCP and PEPECASH must exist in asset signals");
const roundPriority = (assetExpression, quantityExpression) => `CASE
  WHEN ${assetExpression}=${xcpId} AND ${quantityExpression}>=100
    AND abs(${quantityExpression}-round(${quantityExpression}))<0.00000001
    AND CAST(round(${quantityExpression}) AS INTEGER)%100=0 THEN 4
  WHEN ${assetExpression}=${xcpId} AND ${quantityExpression}>=10
    AND abs(${quantityExpression}-round(${quantityExpression}))<0.00000001
    AND CAST(round(${quantityExpression}) AS INTEGER)%10=0 THEN 3
  WHEN ${assetExpression}=${pepecashId} AND ${quantityExpression}>=100000
    AND abs(${quantityExpression}-round(${quantityExpression}))<0.00000001
    AND CAST(round(${quantityExpression}) AS INTEGER)%100000=0 THEN 4
  WHEN ${assetExpression}=${pepecashId} AND ${quantityExpression}>=10000
    AND abs(${quantityExpression}-round(${quantityExpression}))<0.00000001
    AND CAST(round(${quantityExpression}) AS INTEGER)%10000=0 THEN 3
  WHEN ${assetExpression} IN (${xcpId},${pepecashId})
    AND abs(${quantityExpression}-round(${quantityExpression}))<0.00000001 THEN 1
  ELSE 0 END`;
const assetQueues = valuableAssets
  .slice(ASSET_QUEUE_OFFSET, ASSET_QUEUE_OFFSET + ASSET_QUEUE_LIMIT)
  .map((asset, assetRank) => {
    const assetId = Number(asset.asset_id);
    const rows = executeRemoteD1(`WITH raw AS MATERIALIZED (
      SELECT send.event_index,send.tx_hash asset_tx_hash,send.block_index,send.block_time,
        send.source_id,send.destination_id,send.asset_id,
        CAST(send.quantity_normalized AS REAL) quantity,
        ${roundPriority("send.asset_id", "CAST(send.quantity_normalized AS REAL)")} round_priority
      FROM sends send WHERE send.asset_id=${assetId}
        AND send.block_index BETWEEN ${MIN_BLOCK} AND ${MAX_BLOCK}
        AND send.source_id IS NOT NULL AND send.destination_id IS NOT NULL
        AND send.source_id<>send.destination_id AND CAST(send.quantity_normalized AS REAL)>0
      ORDER BY round_priority DESC,send.block_index DESC,send.event_index DESC
      LIMIT ${(SEND_OFFSET + SENDS_PER_ASSET) * 5}
    ) SELECT raw.event_index,lower(hex(raw.asset_tx_hash)) asset_tx,
      raw.block_index,raw.block_time,source.address asset_sender,
      destination.address asset_recipient,dictionary.asset,raw.asset_id,raw.quantity,raw.round_priority
    FROM raw
    LEFT JOIN address_signals source_signal ON source_signal.address_id=raw.source_id
    LEFT JOIN address_signals destination_signal ON destination_signal.address_id=raw.destination_id
    JOIN address_dictionary source ON source.address_id=raw.source_id
    JOIN address_dictionary destination ON destination.address_id=raw.destination_id
    JOIN asset_dictionary dictionary ON dictionary.asset_id=raw.asset_id
    WHERE COALESCE(source_signal.is_exchange,0)=0 AND COALESCE(destination_signal.is_exchange,0)=0
      AND COALESCE(source_signal.is_burn,0)=0 AND COALESCE(destination_signal.is_burn,0)=0
      AND COALESCE(source_signal.is_emblem_vault,0)=0 AND COALESCE(destination_signal.is_emblem_vault,0)=0
      AND NOT EXISTS(SELECT 1 FROM trade_legs leg WHERE leg.leg_index=raw.event_index)
      AND (source.address LIKE '1%' OR source.address LIKE '3%' OR source.address LIKE 'bc1%')
      AND (destination.address LIKE '1%' OR destination.address LIKE '3%' OR destination.address LIKE 'bc1%')
    ORDER BY raw.round_priority DESC,raw.block_index DESC,raw.event_index DESC
    LIMIT ${SENDS_PER_ASSET} OFFSET ${SEND_OFFSET}`).rows;
    return rows.map((row, withinAssetRank) => ({
      ...row,
      asset_rank: ASSET_QUEUE_OFFSET + assetRank + 1,
      within_asset_rank: SEND_OFFSET + withinAssetRank + 1,
      asset_max_realized_usd: assetValues.get(assetId)?.maxRealizedUsd,
      asset_trade_history: assetValues.get(assetId)?.trades,
      asset_holders: assetValues.get(assetId)?.holders,
      asset_evidence_score: assetValues.get(assetId)?.evidenceScore,
    }));
  });
const candidates = [];
for (let withinAsset = 0; candidates.length < LIMIT; withinAsset++) {
  let added = false;
  for (const queue of assetQueues) {
    if (queue[withinAsset]) {
      candidates.push(queue[withinAsset]);
      added = true;
      if (candidates.length >= LIMIT) break;
    }
  }
  if (!added) break;
}
const addressInfo = new Map();
const history = new Map();
const counterpartyHistory = new Map();
let requests = 0;
let counterpartyRequests = 0;
let electrsRequests = 0;

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function getJson(base, path, provider) {
  let last;
  const attempts = provider === "counterparty" ? 3 : 8;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
      requests++;
      if (provider === "counterparty") counterpartyRequests++;
      else electrsRequests++;
      if (response.ok) {
        await pause(40);
        return await response.json();
      }
      last = new Error(`${response.status} ${response.statusText}`);
      if (response.status !== 429 && response.status < 500) break;
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      if (retryAfter > 0) await pause(retryAfter * 1000);
    } catch (error) {
      last = error;
    }
    await pause(300 * 2 ** attempt);
  }
  throw last;
}

async function info(address) {
  if (!addressInfo.has(address)) addressInfo.set(address, getJson(ELECTRS, `/address/${address}`, "electrs"));
  return addressInfo.get(address);
}

async function fastCounterpartyHistory(address) {
  if (!counterpartyHistory.has(address)) {
    counterpartyHistory.set(
      address,
      getJson(
        COUNTERPARTY_API,
        `/v2/bitcoin/addresses/${encodeURIComponent(address)}/transactions`,
        "counterparty",
      ).then((payload) => payload.result || []),
    );
  }
  return counterpartyHistory.get(address);
}

async function transactionsAround(address, block) {
  const cacheKey = `${address}:${block}`;
  if (history.has(cacheKey)) return history.get(cacheKey);
  const promise = (async () => {
    const lower = block - WINDOW_BLOCKS;
    const upper = block + WINDOW_BLOCKS;
    let fastRows = null;
    try {
      fastRows = await fastCounterpartyHistory(address);
    } catch {
      // The fast endpoint is optional; paginated Electrs remains authoritative fallback.
    }
    const fastOldest = fastRows?.length
      ? Math.min(...fastRows.map((tx) => Number(tx.status?.block_height || Number.MAX_SAFE_INTEGER)))
      : Number.MAX_SAFE_INTEGER;
    if (fastRows && (fastRows.length < 50 || fastOldest <= lower)) {
      return {
        txCount: fastRows.length,
        skipped: null,
        provider: "counterparty_v2",
        txs: fastRows.filter((tx) => {
          const height = Number(tx.status?.block_height || 0);
          return height >= lower && height <= upper;
        }),
      };
    }
    const stats = await info(address);
    const txCount = Number(stats.chain_stats?.tx_count || 0) + Number(stats.mempool_stats?.tx_count || 0);
    if (MAX_ADDRESS_TXS > 0 && txCount > MAX_ADDRESS_TXS)
      return { txCount, skipped: "high_activity_address", provider: "counterparty_v2_then_electrs", txs: [] };
    const found = [];
    let lastSeen = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const suffix = lastSeen ? `/chain/${lastSeen}` : "/chain";
      const rows = await getJson(ELECTRS, `/address/${address}/txs${suffix}`, "electrs");
      if (!Array.isArray(rows) || !rows.length) break;
      for (const tx of rows) {
        const height = Number(tx.status?.block_height || 0);
        if (height >= lower && height <= upper) found.push(tx);
      }
      const oldest = Math.min(...rows.map((tx) => Number(tx.status?.block_height || Number.MAX_SAFE_INTEGER)));
      if (oldest < lower) break;
      lastSeen = rows.at(-1)?.txid;
      if (!lastSeen || rows.length < 25) break;
      await pause(35);
    }
    return { txCount, skipped: null, provider: "counterparty_v2_then_electrs", txs: found };
  })();
  history.set(cacheKey, promise);
  return promise;
}

function directPayments(txs, payer, payee) {
  const matches = [];
  for (const tx of txs) {
    const spendsPayer = (tx.vin || []).some((input) => input.prevout?.scriptpubkey_address === payer);
    if (!spendsPayer) continue;
    const sats = (tx.vout || [])
      .filter((output) => output.scriptpubkey_address === payee)
      .reduce((sum, output) => sum + Number(output.value || 0), 0);
    if (sats >= MIN_BTC_SATS) {
      matches.push({
        txid: tx.txid,
        block_index: Number(tx.status?.block_height || 0),
        block_time: Number(tx.status?.block_time || 0),
        sats,
        btc: sats / 1e8,
      });
    }
  }
  return matches;
}

const results = [];
for (let offset = 0; offset < candidates.length; offset += 2) {
  const batch = candidates.slice(offset, offset + 2);
  results.push(
    ...(await Promise.all(
      batch.map(async (candidate) => {
        let recipientHistory;
        try {
          recipientHistory = await transactionsAround(candidate.asset_recipient, Number(candidate.block_index));
        } catch (error) {
          return {
            ...candidate,
            recipient_bitcoin_txs: null,
            bitcoin_history_provider: null,
            skipped: "bitcoin_provider_error",
            provider_error: error instanceof Error ? error.message : String(error),
            direct_btc_payments: [],
            unique_direct_payment: false,
          };
        }
        const payments = directPayments(recipientHistory.txs, candidate.asset_recipient, candidate.asset_sender)
          .map((payment) => ({
            ...payment,
            relative_blocks: payment.block_index - Number(candidate.block_index),
            direction:
              payment.block_index < Number(candidate.block_index)
                ? "btc_before_asset"
                : payment.block_index > Number(candidate.block_index)
                  ? "btc_after_asset"
                  : "same_block_order_unknown",
          }))
          .sort((a, b) => Math.abs(a.relative_blocks) - Math.abs(b.relative_blocks));
        return {
          ...candidate,
          recipient_bitcoin_txs: recipientHistory.txCount,
          bitcoin_history_provider: recipientHistory.provider,
          skipped: recipientHistory.skipped,
          direct_btc_payments: payments,
          unique_direct_payment: payments.length === 1,
        };
      }),
    )),
  );
  if (offset + batch.length >= 25 && (offset + batch.length) % 25 === 0)
    process.stderr.write(`surveyed ${offset + batch.length}/${candidates.length}\n`);
  if ((offset + batch.length) % 10 === 0)
    writeFileSync(
      OUTPUT,
      `${JSON.stringify({ generated_at: new Date().toISOString(), status: "partial", rows: results }, null, 2)}\n`,
    );
  await pause(20);
}

const matched = results.filter((row) => row.direct_btc_payments.length);
const unique = matched.filter((row) => row.unique_direct_payment);
const report = {
  generated_at: new Date().toISOString(),
  policy: {
    valuable_asset_basis: "clean asset with a historical realized trade at or above the threshold",
    search_priority:
      "asset-first queues ranked by combined trade history, realized value, and holder breadth; round XCP/PEPECASH quantities first within their queues",
    sends_per_asset: SENDS_PER_ASSET,
    send_offset: SEND_OFFSET,
    asset_queue_offset: ASSET_QUEUE_OFFSET,
    asset_queue_limit: ASSET_QUEUE_LIMIT,
    round_amounts_are_evidence: false,
    telegram_evidence_used: false,
    minimum_historical_realized_usd: MIN_USD,
    valuable_asset_limit: VALUABLE_ASSET_LIMIT,
    block_range: [MIN_BLOCK, MAX_BLOCK],
    bitcoin_window_blocks: WINDOW_BLOCKS,
    minimum_btc_sats: MIN_BTC_SATS,
    maximum_address_transactions: MAX_ADDRESS_TXS,
    status: "research candidates only; not canonical trades",
  },
  summary: {
    candidate_asset_sends: candidates.length,
    skipped_rows: results.filter((row) => row.skipped).length,
    addresses_skipped_high_activity: results.filter((row) => row.skipped === "high_activity_address").length,
    bitcoin_provider_errors: results.filter((row) => row.skipped === "bitcoin_provider_error").length,
    sends_with_direct_btc_payment: matched.length,
    sends_with_unique_direct_btc_payment: unique.length,
    unique_btc: unique.reduce((sum, row) => sum + row.direct_btc_payments[0].btc, 0),
    total_bitcoin_api_requests: requests,
    electrs_requests: electrsRequests,
    counterparty_api_requests: counterpartyRequests,
    electrs_fallback_requests: electrsRequests,
  },
  rows: results,
};
writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...report.summary }, null, 2));
