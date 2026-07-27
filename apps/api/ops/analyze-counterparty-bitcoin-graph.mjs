#!/usr/bin/env node

/**
 * Read-only first-pass reports for the compact Counterparty-adjacent Bitcoin index.
 * Run only against a stable checkpoint (or a filesystem copy), not a live writer.
 */
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2] ?? "C:/BitcoinIndex/counterparty-bitcoin.sqlite";
const db = new DatabaseSync(`file:${path.replaceAll("\\", "/")}?mode=ro`);

const run = (name, sql) => {
  try {
    return { name, rows: db.prepare(sql).all() };
  } catch (error) {
    return { name, error: String(error?.message ?? error) };
  }
};

const reports = [
  run(
    "coverage",
    `
    SELECT s.block_height AS indexed_through,
           (SELECT count(*) FROM btc_block_metrics) AS block_rows,
           (SELECT min(block_height) FROM btc_block_metrics) AS first_block,
           (SELECT count(*) FROM btc_tx) AS relevant_transactions,
           (SELECT count(*) FROM btc_address_stats) AS watched_addresses
    FROM scan_state s
  `,
  ),
  run(
    "block_economics",
    `
    SELECT sum(transaction_count) AS bitcoin_transactions,
           sum(counterparty_transaction_count) AS counterparty_transactions,
           sum(total_fee_sats) AS bitcoin_fees_sats,
           sum(counterparty_fee_sats) AS counterparty_fees_sats,
           sum(block_size_bytes) AS bitcoin_bytes,
           sum(counterparty_size_bytes) AS counterparty_bytes
    FROM btc_block_metrics
  `,
  ),
  run(
    "top_observed_inflows",
    `
    SELECT address_id, sats_in, sats_out, input_txs, output_txs,
           first_block, last_block
    FROM btc_address_stats
    ORDER BY sats_in DESC
    LIMIT 50
  `,
  ),
  run(
    "strongest_direct_relationships",
    `
    SELECT payer_id, payee_id, count(*) AS transactions,
           sum(value_sats) AS sats, min(tx_id) AS first_tx_id,
           max(tx_id) AS last_tx_id
    FROM btc_direct_flow
    GROUP BY payer_id, payee_id
    ORDER BY sats DESC
    LIMIT 100
  `,
  ),
  run(
    "yearly_block_metrics",
    `
    SELECT strftime('%Y', block_time, 'unixepoch') AS year,
           sum(transaction_count) AS bitcoin_transactions,
           sum(counterparty_transaction_count) AS counterparty_transactions,
           sum(total_fee_sats) AS bitcoin_fees_sats,
           sum(counterparty_fee_sats) AS counterparty_fees_sats
    FROM btc_block_metrics
    GROUP BY year
    ORDER BY year
  `,
  ),
];

console.log(JSON.stringify({ generated_at: new Date().toISOString(), path, reports }, null, 2));
