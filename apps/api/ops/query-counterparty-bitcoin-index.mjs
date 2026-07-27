#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const HELP = `Usage: node apps/api/ops/query-counterparty-bitcoin-index.mjs [command] [options]

Commands: summary, checkpoint, source, benchmark, address, transaction, fee, coverage, block, blocks, month, balance, neighbors, external, recovery, utxo, utxos
Common option: --database=PATH
Run a command without its required option to see the exact requirement.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

function integerOption(name, fallback) {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid --${name}`);
  return value;
}

function timed(query) {
  const started = performance.now();
  const result = query();
  return { elapsed_ms: Number((performance.now() - started).toFixed(3)), result };
}

function hex(value) {
  return value === null || value === undefined ? null : Buffer.from(value).toString("hex");
}

const databasePath = resolve(option("database", "D:\\Bitcoin\\counterparty-index\\counterparty-bitcoin.sqlite"));
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "summary";
const db = new DatabaseSync(databasePath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-65536;");

let output;
if (command === "benchmark") {
  const limit = Math.min(100, Math.max(1, integerOption("limit", 20)));
  output = timed(() =>
    db
      .prepare(
        `SELECT *,
      CASE WHEN elapsed_ms>0 THEN 1000.0*blocks/elapsed_ms END AS blocks_per_second,
      CASE WHEN blocks>0 THEN 1.0*transactions/blocks END AS transactions_per_block,
      CASE WHEN blocks>0 THEN 1.0*(database_bytes-lag(database_bytes) OVER(ORDER BY started_at,start_height))/blocks END AS bytes_per_block_delta
    FROM scan_benchmark ORDER BY started_at DESC,start_height DESC LIMIT ?`,
      )
      .all(limit),
  );
} else if (command === "checkpoint") {
  output = timed(() => {
    const scan =
      db
        .prepare(
          `SELECT block_height,lower(hex(block_hash)) AS block_hash,policy_version,completed_at
      FROM scan_state WHERE singleton=1`,
        )
        .get() ?? null;
    const metadata = Object.fromEntries(
      db
        .prepare(
          `SELECT key,value FROM index_metadata
      WHERE key IN (
        'scan_start_height','scan_target_height','scan_target_hash','policy_version',
        'watched_source_sha256','watched_source_count','counterparty_source_sha256','counterparty_source_count',
        'counterparty_utxo_source_sha256','counterparty_utxo_source_count','counterparty_source_remote_utxos',
        'counterparty_source_remote_max_utxo_id',
        'counterparty_source_remote_height','counterparty_source_chain_height','counterparty_source_remote_transactions',
        'counterparty_source_remote_addresses','counterparty_source_refreshed_at'
      )`,
        )
        .all()
        .map((row) => [row.key, row.value]),
    );
    return { scan, metadata };
  });
} else if (command === "summary") {
  output = timed(() => {
    const counts = {};
    for (const table of [
      "watched_address",
      "counterparty_tx_watch",
      "counterparty_utxo_watch",
      "btc_counterparty_utxo",
      "btc_block_metrics",
      "btc_tx",
      "btc_address_io",
      "btc_address_monthly_stats",
      "btc_external_address",
      "btc_external_io",
      "btc_external_summary",
      "btc_unknown_script_io",
      "btc_recovery_output",
      "btc_direct_flow",
      "counterparty_tx_fee",
    ]) {
      counts[table] = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
    }
    const scan =
      db
        .prepare(
          "SELECT block_height,lower(hex(block_hash)) AS block_hash,policy_version,completed_at FROM scan_state WHERE singleton=1",
        )
        .get() ?? null;
    const pages = db.prepare("SELECT page_count*page_size AS bytes FROM pragma_page_count(),pragma_page_size()").get();
    return { database: databasePath, bytes: Number(pages.bytes), counts, scan };
  });
} else if (command === "source") {
  output = timed(() => {
    const structural = db
      .prepare(
        `SELECT
      count(*) AS transactions,
      sum(CASE WHEN length(tx_hash)<>32 THEN 1 ELSE 0 END) AS malformed_hashes,
      sum(CASE WHEN tx_index IS NULL OR tx_index<0 THEN 1 ELSE 0 END) AS invalid_tx_indices,
      sum(CASE WHEN expected_block_height IS NULL OR expected_block_height<0 THEN 1 ELSE 0 END) AS invalid_block_heights,
      min(tx_index) AS min_tx_index,max(tx_index) AS max_tx_index,
      min(expected_block_height) AS min_block_height,max(expected_block_height) AS max_block_height
      FROM counterparty_tx_watch`,
      )
      .get();
    const duplicateTxIndices = Number(
      db
        .prepare(
          `SELECT count(*) AS n FROM (
      SELECT tx_index FROM counterparty_tx_watch WHERE tx_index IS NOT NULL
      GROUP BY tx_index HAVING count(*)<>1
    )`,
        )
        .get().n,
    );
    return { ...structural, duplicate_tx_indices: duplicateTxIndices };
  });
} else if (command === "address") {
  const address = option("address");
  if (!address) throw new Error("address requires --address=...");
  const limit = Math.min(1000, Math.max(1, integerOption("limit", 100)));
  output = timed(() =>
    db
      .prepare(
        `
    SELECT lower(hex(t.tx_hash)) AS tx_hash,t.block_height,t.tx_position,t.block_time,t.fee_sats,
           io.direction,io.io_index,io.value_sats
    FROM watched_address a
    JOIN btc_address_io io ON io.address_id=a.address_id
    JOIN btc_tx t ON t.tx_id=io.tx_id
    WHERE a.address=?
    ORDER BY t.block_height DESC,t.tx_position DESC,io.direction,io.io_index
    LIMIT ?
  `,
      )
      .all(address, limit),
  );
} else if (command === "transaction") {
  const txid = option("txid").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error("transaction requires a 64-character --txid=...");
  output = timed(() => {
    const transaction = db
      .prepare(
        `SELECT tx_id,lower(hex(tx_hash)) AS tx_hash,block_height,tx_position,block_time,fee_sats,flags FROM btc_tx WHERE tx_hash=?`,
      )
      .get(Buffer.from(txid, "hex"));
    if (!transaction) return null;
    const io = db
      .prepare(
        `
      SELECT a.address,io.direction,io.io_index,io.value_sats
      FROM btc_address_io io JOIN watched_address a ON a.address_id=io.address_id
      WHERE io.tx_id=? ORDER BY io.direction,io.io_index,a.address_id
    `,
      )
      .all(transaction.tx_id);
    const external_io = db
      .prepare(
        `
      SELECT a.address,io.direction,io.io_index,io.value_sats
      FROM btc_external_io io JOIN btc_external_address a ON a.external_address_id=io.external_address_id
      WHERE io.tx_id=? ORDER BY io.direction,io.io_index,a.external_address_id
    `,
      )
      .all(transaction.tx_id);
    const unknown_script_io = db
      .prepare(
        `
      SELECT direction,io_index,script_type,lower(hex(script_hash)) AS script_hash,value_sats
      FROM btc_unknown_script_io WHERE tx_id=? ORDER BY direction,io_index
    `,
      )
      .all(transaction.tx_id);
    const direct_flows = db
      .prepare(
        `
      SELECT payer.address AS payer,payee.address AS payee,flow.value_sats,
        flow.payer_input_count,flow.payee_output_count,flow.attribution_flags
      FROM btc_direct_flow flow
      JOIN watched_address payer ON payer.address_id=flow.payer_id
      JOIN watched_address payee ON payee.address_id=flow.payee_id
      WHERE flow.tx_id=? ORDER BY flow.payer_id,flow.payee_id
    `,
      )
      .all(transaction.tx_id);
    return { ...transaction, io, external_io, unknown_script_io, direct_flows };
  });
} else if (command === "utxo") {
  const outpoint = option("outpoint").toLowerCase();
  const match = /^([0-9a-f]{64}):([0-9]+)$/.exec(outpoint);
  if (!match) throw new Error("utxo requires --outpoint=<txid>:<vout>");
  output = timed(
    () =>
      db
        .prepare(
          `SELECT watch.entity_id,watch.entity,watch.owner_address_id,watch.owner,
      state.value_sats,state.script_type,lower(hex(state.script_hash)) script_hash,state.resolved_owner,
      lower(hex(created.tx_hash)) created_tx_hash,created.block_height created_height,
      lower(hex(spent.tx_hash)) spent_by_tx_hash,state.spend_input_index,state.spent_height
    FROM counterparty_utxo_watch watch
    LEFT JOIN btc_counterparty_utxo state ON state.entity_id=watch.entity_id
    LEFT JOIN btc_tx created ON created.tx_id=state.created_tx_id
    LEFT JOIN btc_tx spent ON spent.tx_id=state.spent_by_tx_id
    WHERE watch.tx_hash=? AND watch.vout=?`,
        )
        .get(Buffer.from(match[1], "hex"), Number(match[2])) ?? null,
  );
} else if (command === "utxos") {
  output = timed(() =>
    db
      .prepare(
        `SELECT
    (SELECT count(*) FROM counterparty_utxo_watch) source_entities,
    (SELECT count(*) FROM btc_counterparty_utxo) observed_entities,
    (SELECT count(*) FROM btc_counterparty_utxo WHERE created_tx_id IS NOT NULL) observed_creations,
    (SELECT count(*) FROM btc_counterparty_utxo WHERE spent_by_tx_id IS NOT NULL) observed_spends,
    (SELECT count(*) FROM btc_counterparty_utxo WHERE created_tx_id IS NULL AND spent_by_tx_id IS NOT NULL) spends_with_creation_before_scan,
    (SELECT count(*) FROM counterparty_utxo_watch w JOIN btc_counterparty_utxo s USING(entity_id)
      WHERE w.owner<>'unknown' AND w.owner<>s.resolved_owner) owner_mismatches,
    (SELECT count(*) FROM btc_tx WHERE (flags&4)<>0) relevant_utxo_transactions,
    (SELECT count(*) FROM btc_tx WHERE (flags&4)<>0 AND (flags&2)=0) utxo_transactions_not_in_counterparty_source,
    (SELECT min(t.block_height) FROM btc_counterparty_utxo s JOIN btc_tx t ON t.tx_id=s.created_tx_id) first_creation_height,
    (SELECT max(t.block_height) FROM btc_counterparty_utxo s JOIN btc_tx t ON t.tx_id=s.created_tx_id) last_creation_height,
    (SELECT min(t.block_height) FROM btc_counterparty_utxo s JOIN btc_tx t ON t.tx_id=s.spent_by_tx_id) first_spend_height,
    (SELECT max(t.block_height) FROM btc_counterparty_utxo s JOIN btc_tx t ON t.tx_id=s.spent_by_tx_id) last_spend_height
  `,
      )
      .get(),
  );
} else if (command === "fee") {
  const txid = option("txid").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error("fee requires a 64-character --txid=...");
  output = timed(
    () =>
      db
        .prepare(
          `SELECT lower(hex(tx_hash)) AS tx_hash,block_height,fee_sats,published_at FROM counterparty_tx_fee WHERE tx_hash=?`,
        )
        .get(Buffer.from(txid, "hex")) ?? null,
  );
} else if (command === "coverage") {
  output = timed(() =>
    db
      .prepare(
        `
    SELECT
      (SELECT count(*) FROM counterparty_tx_watch) AS expected_transactions,
      (SELECT count(*) FROM counterparty_tx_fee) AS resolved_transactions,
      (SELECT count(*) FROM counterparty_tx_watch w LEFT JOIN counterparty_tx_fee f ON f.tx_hash=w.tx_hash WHERE f.tx_hash IS NULL) AS missing_transactions,
      (SELECT block_height FROM scan_state WHERE singleton=1) AS source_height,
      (SELECT expected_transactions FROM fee_coverage WHERE singleton=1) AS persisted_expected_transactions,
      (SELECT resolved_transactions FROM fee_coverage WHERE singleton=1) AS persisted_resolved_transactions,
      (SELECT missing_transactions FROM fee_coverage WHERE singleton=1) AS persisted_missing_transactions,
      (SELECT source_height FROM fee_coverage WHERE singleton=1) AS persisted_source_height,
      (SELECT checked_at FROM fee_coverage WHERE singleton=1) AS persisted_checked_at
  `,
      )
      .get(),
  );
} else if (command === "block") {
  const height = integerOption("height", -1);
  if (height < 0) throw new Error("block requires --height=...");
  output = timed(
    () =>
      db
        .prepare(
          `
    SELECT block_height,lower(hex(block_hash)) AS block_hash,block_time,
      block_size_bytes,block_weight,transaction_count,subsidy_sats,
      total_fee_sats,coinbase_output_sats,counterparty_transaction_count,
      counterparty_size_bytes,counterparty_weight,counterparty_fee_sats,
      CASE WHEN transaction_count>0 THEN 100.0*counterparty_transaction_count/transaction_count END AS counterparty_transaction_pct,
      CASE WHEN block_size_bytes>0 THEN 100.0*counterparty_size_bytes/block_size_bytes END AS counterparty_size_pct,
      CASE WHEN block_weight>0 THEN 100.0*counterparty_weight/block_weight END AS counterparty_weight_pct,
      CASE WHEN total_fee_sats>0 THEN 100.0*counterparty_fee_sats/total_fee_sats END AS counterparty_fee_pct,
      CASE WHEN coinbase_output_sats>0 THEN 100.0*counterparty_fee_sats/coinbase_output_sats END AS counterparty_miner_reward_pct
    FROM btc_block_metrics WHERE block_height=?
  `,
        )
        .get(height) ?? null,
  );
} else if (command === "blocks") {
  const from = integerOption("from", 0);
  const to = integerOption("to", 2_147_483_647);
  if (from < 0 || to < from) throw new Error("blocks requires 0 <= --from <= --to");
  output = timed(() =>
    db
      .prepare(
        `
    WITH totals AS (
      SELECT min(block_height) AS first_height,max(block_height) AS last_height,
        count(*) AS block_count,sum(transaction_count) AS transaction_count,
        sum(block_size_bytes) AS block_size_bytes,sum(block_weight) AS block_weight,
        sum(subsidy_sats) AS subsidy_sats,sum(total_fee_sats) AS total_fee_sats,
        sum(coinbase_output_sats) AS coinbase_output_sats,
        sum(counterparty_transaction_count) AS counterparty_transaction_count,
        sum(counterparty_size_bytes) AS counterparty_size_bytes,
        sum(counterparty_weight) AS counterparty_weight,
        sum(counterparty_fee_sats) AS counterparty_fee_sats
      FROM btc_block_metrics WHERE block_height BETWEEN ? AND ?
    )
    SELECT *,
      CASE WHEN transaction_count>0 THEN 100.0*counterparty_transaction_count/transaction_count END AS counterparty_transaction_pct,
      CASE WHEN block_size_bytes>0 THEN 100.0*counterparty_size_bytes/block_size_bytes END AS counterparty_size_pct,
      CASE WHEN block_weight>0 THEN 100.0*counterparty_weight/block_weight END AS counterparty_weight_pct,
      CASE WHEN total_fee_sats>0 THEN 100.0*counterparty_fee_sats/total_fee_sats END AS counterparty_fee_pct,
      CASE WHEN coinbase_output_sats>0 THEN 100.0*counterparty_fee_sats/coinbase_output_sats END AS counterparty_miner_reward_pct
    FROM totals
  `,
      )
      .get(from, to),
  );
} else if (command === "month") {
  const month = option("month");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month requires --month=YYYY-MM");
  const start = Math.floor(Date.parse(`${month}-01T00:00:00Z`) / 1000);
  const nextDate = new Date(start * 1000);
  nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
  const end = Math.floor(nextDate.getTime() / 1000);
  output = timed(() =>
    db
      .prepare(
        `
    WITH totals AS (
      SELECT min(block_height) AS first_height,max(block_height) AS last_height,
        count(*) AS block_count,sum(transaction_count) AS transaction_count,
        sum(block_size_bytes) AS block_size_bytes,sum(block_weight) AS block_weight,
        sum(subsidy_sats) AS subsidy_sats,sum(total_fee_sats) AS total_fee_sats,
        sum(coinbase_output_sats) AS coinbase_output_sats,
        sum(counterparty_transaction_count) AS counterparty_transaction_count,
        sum(counterparty_size_bytes) AS counterparty_size_bytes,
        sum(counterparty_weight) AS counterparty_weight,
        sum(counterparty_fee_sats) AS counterparty_fee_sats
      FROM btc_block_metrics WHERE block_time>=?1 AND block_time<?2
    )
    SELECT ?3 AS month,* ,
      CASE WHEN transaction_count>0 THEN 100.0*counterparty_transaction_count/transaction_count END AS counterparty_transaction_pct,
      CASE WHEN block_size_bytes>0 THEN 100.0*counterparty_size_bytes/block_size_bytes END AS counterparty_size_pct,
      CASE WHEN block_weight>0 THEN 100.0*counterparty_weight/block_weight END AS counterparty_weight_pct,
      CASE WHEN total_fee_sats>0 THEN 100.0*counterparty_fee_sats/total_fee_sats END AS counterparty_fee_pct,
      CASE WHEN coinbase_output_sats>0 THEN 100.0*counterparty_fee_sats/coinbase_output_sats END AS counterparty_miner_reward_pct
    FROM totals
  `,
      )
      .get(start, end, month),
  );
} else if (command === "balance") {
  const address = option("address");
  if (!address) throw new Error("balance requires --address=...");
  output = timed(
    () =>
      db
        .prepare(
          `
    SELECT a.address,s.first_block,s.last_block,s.input_txs,s.output_txs,
      s.sats_in,s.sats_out,
      coalesce((SELECT sum(value_sats) FROM watched_utxo WHERE address_id=a.address_id),0) AS balance_sats,
      (SELECT block_height FROM scan_state WHERE singleton=1) AS indexed_height,
      coalesce((SELECT value='0' FROM index_metadata WHERE key='scan_start_height'),0) AS complete_from_genesis
    FROM watched_address a
    LEFT JOIN btc_address_stats s ON s.address_id=a.address_id
    WHERE a.address=?
  `,
        )
        .get(address) ?? null,
  );
} else if (command === "neighbors") {
  const address = option("address");
  if (!address) throw new Error("neighbors requires --address=...");
  const limit = Math.min(1000, Math.max(1, integerOption("limit", 100)));
  output = timed(() =>
    db
      .prepare(
        `
    WITH selected AS (SELECT address_id FROM watched_address WHERE address=?1), edges AS (
      SELECT payee_id AS peer_id,value_sats AS sent_sats,0 AS received_sats,attribution_flags
      FROM btc_direct_flow WHERE payer_id=(SELECT address_id FROM selected)
      UNION ALL
      SELECT payer_id AS peer_id,0 AS sent_sats,value_sats AS received_sats,attribution_flags
      FROM btc_direct_flow WHERE payee_id=(SELECT address_id FROM selected)
    )
    SELECT peer.address AS peer_address,count(*) AS flow_rows,
      sum(sent_sats) AS candidate_sent_sats,sum(received_sats) AS candidate_received_sats,
      sum(CASE WHEN attribution_flags=0 THEN sent_sats ELSE 0 END) AS clean_sent_sats,
      sum(CASE WHEN attribution_flags=0 THEN received_sats ELSE 0 END) AS clean_received_sats,
      sum(CASE WHEN attribution_flags<>0 THEN 1 ELSE 0 END) AS ambiguous_rows
    FROM edges JOIN watched_address peer ON peer.address_id=edges.peer_id
    GROUP BY edges.peer_id
    ORDER BY candidate_sent_sats+candidate_received_sats DESC,edges.peer_id LIMIT ?2
  `,
      )
      .all(address, limit),
  );
} else if (command === "external") {
  const address = option("address");
  if (!address) throw new Error("external requires --address=...");
  const limit = Math.min(1000, Math.max(1, integerOption("limit", 100)));
  output = timed(() => ({
    coverage: "counterparty-adjacent-transactions-only",
    summary:
      db
        .prepare(
          `SELECT transaction_count,input_rows,output_rows,input_sats,output_sats,
            lower(hex(first_tx.tx_hash)) first_tx_hash,first_tx.block_height first_block,
            lower(hex(last_tx.tx_hash)) last_tx_hash,last_tx.block_height last_block
           FROM btc_external_summary summary
           JOIN btc_tx first_tx ON first_tx.tx_id=summary.first_tx_id
           JOIN btc_tx last_tx ON last_tx.tx_id=summary.last_tx_id
           WHERE summary.address=?`,
        )
        .get(address) ?? null,
    event_detail: "selected-transactions-only",
    rows: db
      .prepare(
        `
    SELECT lower(hex(t.tx_hash)) AS tx_hash,t.block_height,t.tx_position,t.block_time,t.fee_sats,
      io.direction,io.io_index,io.value_sats
    FROM btc_external_address a
    JOIN btc_external_io io ON io.external_address_id=a.external_address_id
    JOIN btc_tx t ON t.tx_id=io.tx_id
    WHERE a.address=?
    ORDER BY t.block_height DESC,t.tx_position DESC,io.direction,io.io_index
    LIMIT ?
  `,
      )
      .all(address, limit),
  }));
} else if (command === "recovery") {
  const address = option("address");
  if (!address) throw new Error("recovery requires --address=...");
  const limit = Math.min(1000, Math.max(1, integerOption("limit", 100)));
  output = timed(() =>
    db
      .prepare(
        `
    SELECT lower(hex(tx_hash)) AS tx_hash,vout,value_sats,script_pubkey_hex,layout,recovery_key_hex,
      recovery_key_position,recovery_address,classification,reason,block_height,block_time,
      lower(hex(spent_by_tx_hash)) AS spent_by_tx_hash,spent_height,classifier_version
    FROM btc_recovery_output WHERE recovery_address=?
    ORDER BY block_height DESC,tx_hash,vout LIMIT ?
  `,
      )
      .all(address, limit),
  );
} else {
  throw new Error(`Unknown command ${command}`);
}

console.log(
  JSON.stringify({ command, ...output }, (_key, value) => (typeof value === "bigint" ? Number(value) : value), 2),
);
db.close();
